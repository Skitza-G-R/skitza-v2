import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { currentVerifiedEmailHashes } from "~/server/auth/verified-email";
import { sendPrivateOfferNotificationEmail } from "~/server/email/send";
import {
  acceptPrivateOffer,
  cancelPrivateOffer,
  createPrivateOffer,
  getArtistPrivateOffer,
  listArtistPrivateOffers,
  listPrivateOfferProjectOptions,
  listPrivateOfferRecipients,
  listProducerPrivateOffers,
  notifyProducerOfPrivateOfferAcceptance,
  PrivateOfferPersistenceError,
  rejectPrivateOffer,
  updatePrivateOffer,
} from "~/server/domain/private-offers/db";
import { PrivateOfferDomainError } from "~/server/domain/private-offers/service";
import { artistProcedure } from "../artist-procedure";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

const paymentPlanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }).strict(),
  z.object({ kind: z.literal("split_50_50") }).strict(),
  z.object({ kind: z.literal("monthly"), installments: z.number().int().min(2).max(12) }).strict(),
]);

const masterRoyaltySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({ mode: z.literal("agreement") }).strict(),
  z.object({ mode: z.literal("percentage"), bps: z.number().int().min(1).max(10_000) }).strict(),
]);

const compositionRoyaltySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({ mode: z.literal("agreement") }).strict(),
  z
    .object({
      mode: z.literal("percentage"),
      bps: z.number().int().min(1).max(10_000),
      role: z.enum(["composer", "lyricist", "arranger", "publisher", "other"]).optional(),
      collectingSociety: z.string().max(200).optional(),
    })
    .strict(),
]);

const limitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), count: z.number().int().min(1).max(1_000) }).strict(),
  z.object({ kind: z.literal("unlimited") }).strict(),
]);

const revisionRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), count: z.number().int().min(0).max(1_000) }).strict(),
  z.object({ kind: z.literal("unlimited") }).strict(),
]);

export const privateOfferTermsSchema = z
  .object({
    name: z.string().min(1).max(200),
    tagline: z.string().max(300).nullable().optional(),
    service: z.string().min(1).max(200),
    deliverables: z.array(z.string().min(1).max(500)).min(1).max(20),
    cashPriceCents: z.number().int().min(0).max(2_147_483_647),
    currency: z.string().min(3).max(3),
    taxMode: z.enum(["tax_free", "tax_included", "tax_added"]),
    taxRatePct: z.number().int().min(0).max(100),
    includedSongSpaces: z.number().int().min(0).max(1_000),
    session: z
      .object({
        limit: limitSchema,
        durationMin: z
          .number()
          .int()
          .min(1)
          .max(24 * 60),
        locationType: z.string().min(1).max(100),
        bufferMinutes: z
          .number()
          .int()
          .min(0)
          .max(24 * 60),
        minLeadHours: z
          .number()
          .int()
          .min(0)
          .max(365 * 24),
      })
      .strict()
      .nullable(),
    revisionRule: revisionRuleSchema.nullable(),
    royaltyTerms: z
      .object({
        master: masterRoyaltySchema,
        composition: compositionRoyaltySchema,
        notes: z.string().max(4_000).optional(),
      })
      .strict()
      .nullable(),
    rights: z.array(z.string().min(1).max(1_000)).min(1).max(20),
    enabledPaymentPlans: z.array(paymentPlanSchema).max(3),
    agreementText: z.string().min(1).max(50_000),
  })
  .strict();

const recipientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), clientContactId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal("new"),
      name: z.string().trim().min(1).max(160),
      email: z.string().trim().email().max(320),
    })
    .strict(),
]);

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }).strict(),
  z.object({ kind: z.literal("existing"), projectId: z.string().uuid() }).strict(),
]);

function mapOfferError(error: unknown): never {
  if (error instanceof PrivateOfferPersistenceError) {
    if (error.code === "NOT_FOUND" || error.code === "UNAVAILABLE") {
      throw new TRPCError({ code: "NOT_FOUND", message: "This offer is unavailable." });
    }
    if (error.code === "STALE") {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    if (error.code === "ACTIVE_PURCHASE") {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "This offer is unavailable.",
    });
  }
  if (error instanceof PrivateOfferDomainError) {
    if (error.code === "EXPIRED" || error.code === "INVALID_STATUS") {
      throw new TRPCError({ code: "NOT_FOUND", message: "This offer is unavailable." });
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  console.error("[private-offers] unexpected failure", {
    error: error instanceof Error ? error.name : "unknown",
  });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "This offer is unavailable.",
  });
}

async function requireVerifiedArtistEmailHashes(clerkUserId: string): Promise<string[]> {
  const verifiedEmailHashes = await currentVerifiedEmailHashes(clerkUserId);
  if (verifiedEmailHashes.length === 0) {
    throw new PrivateOfferPersistenceError("UNAVAILABLE");
  }
  return verifiedEmailHashes;
}

export const privateOffersRouter = router({
  recipients: producerProcedure.query(({ ctx }) =>
    listPrivateOfferRecipients(ctx.db, ctx.producerId),
  ),

  projectOptions: producerProcedure
    .input(z.object({ clientContactId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return {
          projects: await listPrivateOfferProjectOptions(ctx.db, {
            producerId: ctx.producerId,
            clientContactId: input.clientContactId,
          }),
        };
      } catch (error) {
        mapOfferError(error);
      }
    }),

  producerList: producerProcedure.query(async ({ ctx }) => {
    try {
      return {
        offers: await listProducerPrivateOffers(ctx.db, {
          producerId: ctx.producerId,
          now: new Date(),
        }),
      };
    } catch (error) {
      mapOfferError(error);
    }
  }),

  send: producerProcedure
    .input(
      z
        .object({
          offerId: z.string().uuid(),
          sourceProductId: z.string().uuid().optional(),
          recipient: recipientSchema,
          target: targetSchema,
          terms: privateOfferTermsSchema,
          expiresAt: z.date().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await createPrivateOffer(ctx.db, {
          offerId: input.offerId,
          ...(input.sourceProductId ? { sourceProductId: input.sourceProductId } : {}),
          producerId: ctx.producerId,
          recipient: input.recipient,
          target: input.target,
          terms: input.terms,
          now: new Date(),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        });
        let emailDelivered: boolean | null = null;
        if (result.created) {
          emailDelivered = true;
          try {
            await sendPrivateOfferNotificationEmail(result.recipient.email, {
              recipientName: result.recipient.name,
              producerName: result.producer.displayName ?? "Your producer",
              producerSlug: result.producer.slug,
            });
          } catch (emailError) {
            emailDelivered = false;
            console.warn("[private-offers] notification email failed", {
              offerId: result.offer.id,
              error: emailError instanceof Error ? emailError.name : "unknown",
            });
          }
        }
        return { offerId: result.offer.id, emailDelivered };
      } catch (error) {
        mapOfferError(error);
      }
    }),

  update: producerProcedure
    .input(
      z
        .object({
          offerId: z.string().uuid(),
          expectedUpdatedAt: z.date(),
          target: targetSchema,
          terms: privateOfferTermsSchema,
          expiresAt: z.date(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const offer = await updatePrivateOffer(ctx.db, {
          producerId: ctx.producerId,
          ...input,
          now: new Date(),
        });
        return { offerId: offer.id, updatedAt: offer.updatedAt };
      } catch (error) {
        mapOfferError(error);
      }
    }),

  cancel: producerProcedure
    .input(z.object({ offerId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelPrivateOffer(ctx.db, {
          producerId: ctx.producerId,
          offerId: input.offerId,
          now: new Date(),
        });
      } catch (error) {
        mapOfferError(error);
      }
    }),

  artistList: artistProcedure
    .input(z.object({ producerId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const verifiedEmailHashes = await currentVerifiedEmailHashes(ctx.clerkUserId);
        if (verifiedEmailHashes.length === 0) return { offers: [] };

        return {
          offers: await listArtistPrivateOffers(ctx.db, {
            clerkUserId: ctx.clerkUserId,
            verifiedEmailHashes,
            ...(input?.producerId ? { producerId: input.producerId } : {}),
            now: new Date(),
          }),
        };
      } catch (error) {
        mapOfferError(error);
      }
    }),

  artistGet: artistProcedure
    .input(z.object({ offerId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await getArtistPrivateOffer(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          verifiedEmailHashes: await requireVerifiedArtistEmailHashes(ctx.clerkUserId),
          offerId: input.offerId,
          now: new Date(),
        });
      } catch (error) {
        mapOfferError(error);
      }
    }),

  reject: artistProcedure
    .input(z.object({ offerId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await rejectPrivateOffer(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          verifiedEmailHashes: await requireVerifiedArtistEmailHashes(ctx.clerkUserId),
          offerId: input.offerId,
          now: new Date(),
        });
      } catch (error) {
        mapOfferError(error);
      }
    }),

  accept: artistProcedure
    .input(
      z
        .object({
          offerId: z.string().uuid(),
          expectedUpdatedAt: z.date(),
          expectedTargetProjectTitle: z.string().max(500).nullable(),
          selectedPaymentPlan: paymentPlanSchema.nullable(),
          agreementAccepted: z.literal(true),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await acceptPrivateOffer(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          verifiedEmailHashes: await requireVerifiedArtistEmailHashes(ctx.clerkUserId),
          ...input,
          now: new Date(),
        });
        if (result.created) {
          try {
            await notifyProducerOfPrivateOfferAcceptance(ctx.db, {
              producerId: result.producerId,
              purchaseId: result.purchaseId,
              artistName: result.artistName,
              offerName: result.commercialSnapshot.productOrOfferName,
            });
          } catch (notificationError) {
            console.warn("[private-offers] producer notification failed", {
              purchaseId: result.purchaseId,
              error: notificationError instanceof Error ? notificationError.name : "unknown",
            });
          }
        }
        return {
          purchaseId: result.purchaseId,
          projectId: result.projectId,
          lifecycleStatus: result.lifecycleStatus,
          created: result.created,
        };
      } catch (error) {
        mapOfferError(error);
      }
    }),
});
