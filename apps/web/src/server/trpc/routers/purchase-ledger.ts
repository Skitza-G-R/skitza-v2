import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { SITE_URL, sendPaymentReminderEmail } from "~/server/email/send";
import { purchaseLedgerRepository } from "~/server/domain/purchase-ledger/db";
import { PurchaseLedgerDomainError } from "~/server/domain/purchase-ledger/policy";
import {
  paymentReminderRepository,
  sendManualPurchaseReminder,
} from "~/server/domain/purchase-ledger/reminders";
import {
  correctPurchasePayment,
  pauseProjectForOverdueInstallment,
  reconcilePurchaseLedger,
  recordConfirmedPurchasePayment,
  resumePaymentPausedProject,
  setInstallmentRemindersEnabled,
  waiveInstallmentDebt,
} from "~/server/domain/purchase-ledger/service";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

const operationKeySchema = z.string().trim().min(1).max(200);
const centsSchema = z.number().int().positive().max(2_147_483_647);
const currencySchema = z.string().trim().min(3).max(12);

function mapLedgerError(error: unknown): never {
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

export const purchaseLedgerRouter = router({
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

  recordManualPayment: producerProcedure
    .input(
      z
        .object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          operationKey: operationKeySchema,
          amountCents: centsSchema,
          currency: currencySchema,
          paidAt: z.date(),
          note: z.string().trim().max(4_000).nullable().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await recordConfirmedPurchasePayment(purchaseLedgerRepository(ctx.db), {
          producerId: ctx.producerId,
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
          operationKey: input.operationKey,
          source: "manual",
          amountCents: input.amountCents,
          currency: input.currency,
          paidAt: input.paidAt,
          actorId: requireActor(ctx.userId),
          note: input.note ?? null,
          occurredAt: new Date(),
        });
      } catch (error) {
        mapLedgerError(error);
      }
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
            requestedAt: new Date(),
          },
        );
      } catch (error) {
        mapLedgerError(error);
      }
    }),
});
