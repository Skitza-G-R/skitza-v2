import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";

import { emitArtistProofDecisionNotification } from "~/server/artist/notification-emitters";
import { getArtistProfile } from "~/server/artist/profile";
import {
  cancelProducerReceiptUpload,
  prepareProducerReceiptUpload,
  recordProducerManualPayment,
} from "~/server/domain/payment-proofs/producer-manual-payment";
import { MAX_PROOF_BYTES, PROOF_CONTENT_TYPES } from "~/server/domain/payment-proofs/policy";
import { PaymentProofDomainError } from "~/server/domain/payment-proofs/service";
import { SITE_URL, sendPaymentReminderEmail, sendProofVerifiedEmail } from "~/server/email/send";
import { purchaseLedgerRepository } from "~/server/domain/purchase-ledger/db";
import { PurchaseLedgerDomainError } from "~/server/domain/purchase-ledger/policy";
import { paymentLedgerReadRepository } from "~/server/domain/purchase-ledger/read-db";
import { loadProducerPaymentReadModel } from "~/server/domain/purchase-ledger/read-model";
import {
  paymentReminderRepository,
  sendManualPurchaseReminder,
} from "~/server/domain/purchase-ledger/reminders";
import {
  correctPurchasePayment,
  pauseProjectForOverdueInstallment,
  reconcilePurchaseLedger,
  resumePaymentPausedProject,
  setInstallmentRemindersEnabled,
  waiveInstallmentDebt,
} from "~/server/domain/purchase-ledger/service";
import { deliverPushToProjectArtist } from "~/server/push/delivery";
import { configuredCapabilitySecrets } from "~/server/security/capability-secrets";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

const operationKeySchema = z.string().trim().min(1).max(200);
const centsSchema = z.number().int().positive().max(2_147_483_647);

function mapLedgerError(error: unknown): never {
  if (error instanceof PaymentProofDomainError) {
    if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
    if (error.code === "INVALID_INPUT") {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    if (error.code === "CONFLICT") {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }
  if (error instanceof PurchaseLedgerDomainError) {
    if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
    if (error.code === "INVALID_INPUT") {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    if (error.code === "CONFLICT" || error.code === "OPERATION_KEY_CONFLICT") {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }
  console.error("[purchase-ledger] unexpected failure", {
    error: error instanceof Error ? error.name : "unknown",
  });
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
}

function requireActor(userId: string | null): string {
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

function proofServerSecret(): string {
  try {
    return configuredCapabilitySecrets().active;
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Private receipt storage is not configured",
    });
  }
}

function proofVerificationSecrets(): readonly string[] {
  try {
    return configuredCapabilitySecrets().verification;
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Private receipt storage is not configured",
    });
  }
}

export const purchaseLedgerRouter = router({
  overview: producerProcedure.query(async ({ ctx }) =>
    loadProducerPaymentReadModel(paymentLedgerReadRepository(ctx.db), {
      producerId: ctx.producerId,
      asOf: new Date(),
    }),
  ),

  project: producerProcedure
    .input(z.object({ projectId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) =>
      loadProducerPaymentReadModel(paymentLedgerReadRepository(ctx.db), {
        producerId: ctx.producerId,
        projectId: input.projectId,
        asOf: new Date(),
      }),
    ),

  client: producerProcedure
    .input(z.object({ clientContactId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) =>
      loadProducerPaymentReadModel(paymentLedgerReadRepository(ctx.db), {
        producerId: ctx.producerId,
        clientContactId: input.clientContactId,
        asOf: new Date(),
      }),
    ),

  state: producerProcedure
    .input(z.object({ purchaseId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await reconcilePurchaseLedger(purchaseLedgerRepository(ctx.db), {
          producerId: ctx.producerId,
          purchaseId: input.purchaseId,
          asOf: new Date(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  presignManualReceipt: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          operationKey: z.string().uuid(),
          fileName: z.string().min(1).max(200),
          contentType: z.enum(PROOF_CONTENT_TYPES),
          sizeBytes: z.number().int().positive().max(MAX_PROOF_BYTES),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await prepareProducerReceiptUpload(ctx.db, {
          producerId: ctx.producerId,
          clerkUserId: requireActor(ctx.userId),
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
          operationKey: input.operationKey,
          originalFileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          serverSecret: proofServerSecret(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  cancelManualReceipt: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          uploadToken: z.string().min(1).max(4096),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelProducerReceiptUpload({
          clerkUserId: requireActor(ctx.userId),
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
          uploadToken: input.uploadToken,
          serverSecret: proofVerificationSecrets(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  // SK-260 — the producer records money received outside Skitza. An optional
  // receipt (already uploaded through presignManualReceipt) is finalized and
  // stored as an already-confirmed proof next to the payment.
  recordManualPayment: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          operationKey: z.string().uuid(),
          amountCents: centsSchema,
          paidAt: z.date(),
          note: z.string().trim().max(2_000).optional(),
          uploadToken: z.string().min(1).max(4096).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const clerkUserId = requireActor(ctx.userId);
      let result;
      try {
        result = await recordProducerManualPayment(ctx.db, {
          producerId: ctx.producerId,
          clerkUserId,
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
          operationKey: input.operationKey,
          amountCents: input.amountCents,
          paidAt: input.paidAt,
          note: input.note,
          uploadToken: input.uploadToken,
          serverSecret: proofVerificationSecrets(),
        });
      } catch (error) {
        mapLedgerError(error);
      }

      const email = result.email;
      if (result.created && email) {
        // SK-271 — is there anyone on the other end of this email? A client the
        // producer imported by hand may never have joined Skitza, and with no
        // receipt attached there is no proof row either. Telling that person to
        // "review your schedule from your home screen" points at a screen they
        // cannot open, and they already hold the receipt the producer handed
        // over when they paid in person. So Skitza stays silent here: inviting
        // them is the producer's call, from Clients & Projects.
        const artistCanBeEmailed = Boolean(result.proofId) || Boolean(result.artistClerkUserId);
        let artistEmailEnabled = true;
        try {
          if (result.proofId) {
            const channels = await emitArtistProofDecisionNotification(ctx.db, {
              recipientClerkUserId: result.artistClerkUserId,
              producerId: ctx.producerId,
              purchaseId: result.purchaseId,
              proofId: result.proofId,
              producerName: email.producerName,
              productName: email.productName,
              decision: "verified",
            });
            artistEmailEnabled = channels.emailEnabled;
          } else if (result.artistClerkUserId) {
            // No receipt means no proof row to hang an in-app notification
            // on; the artist still gets the "payment confirmed" email unless
            // they turned proof emails off.
            const preference = (await getArtistProfile(ctx.db, result.artistClerkUserId))
              .notificationPreferences.proof;
            artistEmailEnabled = preference.transactionalEmail || preference.activityEmail;
          }
        } catch {
          console.error("[notify] artist manual-payment failed");
        }
        const projectId = result.projectId;
        const purchaseId = result.purchaseId;
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, projectId, {
              category: "payment",
              url: `/artist/payments/${purchaseId}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
        if (artistCanBeEmailed && artistEmailEnabled) {
          after(async () => {
            try {
              await sendProofVerifiedEmail(email.artistEmail, email);
            } catch {
              console.error("[email] manual-payment confirmed failed");
            }
          });
        }
      }

      return {
        paymentId: result.paymentId,
        proofId: result.proofId,
        purchaseId: result.purchaseId,
        installmentId: result.installmentId,
        installmentPosition: result.installmentPosition,
        projectId: result.projectId,
        installmentStatus: result.installmentStatus,
        paidInFull: result.paidInFull,
        created: result.created,
      };
    }),

  correctPayment: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          paymentId: z.string().uuid(),
          operationKey: operationKeySchema,
          newAmountCents: z.number().int().nonnegative().max(2_147_483_647),
          reason: z.string().trim().min(1).max(4_000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await correctPurchasePayment(purchaseLedgerRepository(ctx.db), {
          producerId: ctx.producerId,
          purchaseId: input.purchaseId,
          paymentId: input.paymentId,
          operationKey: input.operationKey,
          newAmountCents: input.newAmountCents,
          reason: input.reason,
          actorId: requireActor(ctx.userId),
          correctedAt: new Date(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  waiveDebt: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          operationKey: operationKeySchema,
          amountCents: centsSchema,
          reason: z.string().trim().min(1).max(4_000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await waiveInstallmentDebt(purchaseLedgerRepository(ctx.db), {
          producerId: ctx.producerId,
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
          operationKey: input.operationKey,
          amountCents: input.amountCents,
          reason: input.reason,
          actorId: requireActor(ctx.userId),
          waivedAt: new Date(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  setAutomaticReminders: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          enabled: z.boolean(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await setInstallmentRemindersEnabled(purchaseLedgerRepository(ctx.db), {
          producerId: ctx.producerId,
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
          enabled: input.enabled,
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  pauseProject: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          operationKey: operationKeySchema,
          reason: z.string().trim().min(1).max(4_000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await pauseProjectForOverdueInstallment(purchaseLedgerRepository(ctx.db), {
          producerId: ctx.producerId,
          purchaseId: input.purchaseId,
          operationKey: input.operationKey,
          reason: input.reason,
          actorId: requireActor(ctx.userId),
          changedAt: new Date(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  resumeProject: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          operationKey: operationKeySchema,
          reason: z.string().trim().min(1).max(4_000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await resumePaymentPausedProject(purchaseLedgerRepository(ctx.db), {
          producerId: ctx.producerId,
          purchaseId: input.purchaseId,
          operationKey: input.operationKey,
          reason: input.reason,
          actorId: requireActor(ctx.userId),
          changedAt: new Date(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
    }),

  sendReminder: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          operationKey: operationKeySchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await sendManualPurchaseReminder(
          paymentReminderRepository(ctx.db),
          ({ to, props, idempotencyKey }) => sendPaymentReminderEmail(to, props, idempotencyKey),
          {
            producerId: ctx.producerId,
            purchaseId: input.purchaseId,
            installmentId: input.installmentId,
            operationKey: input.operationKey,
            actorId: requireActor(ctx.userId),
            paymentUrl: `${SITE_URL}/artist/payments/${encodeURIComponent(input.purchaseId)}`,
            joinUrlForProducer: (producerSlug) =>
              `${SITE_URL}/join/${encodeURIComponent(producerSlug)}`,
            requestedAt: new Date(),
          },
        );
      } catch (error) {
        mapLedgerError(error);
      }
    }),
});
