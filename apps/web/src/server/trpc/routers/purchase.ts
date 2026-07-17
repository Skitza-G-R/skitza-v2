import {
  and,
  clientContacts,
  desc,
  eq,
  inArray,
  isNull,
  products,
  producers,
  projects,
  purchaseRequests,
} from "@skitza/db";
import type { Db, PaymentPlan, Product, PurchaseRequest } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";

import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { safeAgreementUrl } from "~/lib/agreement-url";
import { computeProjectSessionCount } from "~/lib/pricing";
import { snapshotProductPrice } from "~/lib/purchase/price-snapshot";
import { generateRefNumber } from "~/lib/purchase/request-helpers";
import {
  assertPurchaseRequestOperationReplay,
  preparePurchaseRequestOperation,
  purchaseRequestApprovalUndoDeadline,
  PurchaseRequestDomainError,
  transitionPurchaseRequest,
  type PurchaseRequestTransitionAction,
} from "~/server/domain/purchase-requests/service";
import { sendPurchaseApprovedEmail, sendPurchaseDeclinedEmail } from "~/server/email/send";
import {
  emitPurchaseApproved,
  emitPurchaseDeclined,
  emitPurchaseRequested,
} from "~/server/notifications/emit";
import { buildPlanOptions, type PlanOption } from "~/server/payments/plan-preview";
import { artistProcedure } from "../artist-procedure";
import { producerProcedure } from "../producer-procedure";
import { router } from "../init";

const PAYMENT_PLAN_INPUT = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("split_50_50") }),
  z.object({
    kind: z.literal("monthly"),
    installments: z.number().int().min(2).max(12),
  }),
]);

const PURCHASE_REQUEST_STATUS_INPUT = z.enum([
  "pending",
  "approved",
  "declined",
  "canceled",
  "converted",
]);

const PROOF_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;
const MAX_PROOF_BYTES = 15 * 1024 * 1024;

type CompatibilityPurchaseStatus = PurchaseRequest["status"] | "verifying" | "paid";

type ArtistCurrentCompatibility = {
  id: string;
  producerId: string;
  refNumber: string;
  productId: string | null;
  projectId: string | null;
  status: "pending" | "approved" | "verifying" | "paid" | "declined";
  productNameSnapshot: string;
  priceCents: number;
  currency: string;
  statusChangedAt: Date | null;
  createdAt: Date;
  paidCents: number;
  pendingProofCents: number;
  remainingCents: number;
  paidInFull: boolean;
};

type ArtistPaymentInstructionsOutput = {
  refNumber: string;
  productId: string | null;
  productName: string;
  planKind: PaymentPlan["kind"];
  planInstallments: number | null;
  currency: string;
  totalCents: number;
  paidCents: number;
  pendingProofCents: number;
  remainingCents: number;
  amountDueNowCents: number | null;
  availableToSubmitCents: number;
  producerName: string | null;
  proofUploadsAvailable: boolean;
  hasDetails: boolean;
  bankTransfer: string | null;
  bitPhone: string | null;
  note: string | null;
};

type ArtistProofStateOutput = {
  purchaseRequestId: string;
  producerId: string;
  productId: string | null;
  projectId: string | null;
  productName: string;
  producerName: string;
  proofUploadsAvailable: boolean;
  requestStatus: "pending" | "approved" | "verifying" | "paid" | "declined";
  planChosenAt: Date | null;
  currency: string;
  totalCents: number;
  paidCents: number;
  pendingProofCents: number;
  remainingCents: number;
  amountDueNowCents: number;
  availableToSubmitCents: number;
  paidInFull: boolean;
  proofs: Array<{
    id: string;
    amountCents: number;
    status: "pending" | "confirmed" | "rejected";
    rejectionNote: string | null;
    createdAt: Date;
  }>;
};

type ProducerPendingProof = {
  proofId: string;
  purchaseRequestId: string;
  refNumber: string;
  artistName: string;
  productNameSnapshot: string;
  amountCents: number;
  totalCents: number;
  currency: string;
  originalFileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  proofNote: string | null;
  createdAt: Date;
};

type ProducerProofHistory = ProducerPendingProof & {
  status: "pending" | "confirmed" | "rejected";
  rejectionNote: string | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
};

type ProducerProofConfirmOutput = {
  ok: true;
  purchaseRequestId: string;
  projectId: string | null;
  proofStatus: "confirmed";
  invoiceStatus: "paid";
  depositPaid: boolean;
  finalPaid: boolean;
};

type ProducerProofRejectOutput = {
  ok: true;
  purchaseRequestId: string;
  proofStatus: "rejected";
};

function notImplemented(slice: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${slice} requires an accepted purchase and is unavailable until that flow is wired`,
  });
}

function mapRequestDomainError(error: unknown): never {
  if (!(error instanceof PurchaseRequestDomainError)) throw error;
  if (error.code === "OPERATION_KEY_CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
}

function effectiveAgreementText(
  product: Pick<Product, "agreementText" | "description">,
): string | null {
  if (product.agreementText !== null) {
    return product.agreementText.trim().length > 0 ? product.agreementText : null;
  }
  return decodeDescription(product.description).contractText || null;
}

function requestPrice(
  request: Pick<PurchaseRequest, "requestedSongQty">,
  product: Pick<Product, "pricingModel" | "priceCents" | "hourlyRateCents" | "volumeTiers">,
) {
  return snapshotProductPrice(product, {
    ...(request.requestedSongQty === null ? {} : { songQty: request.requestedSongQty }),
  });
}

function proposalPlan(
  product: Pick<Product, "paymentPlans">,
  totalCents: number,
): PaymentPlan | null {
  return totalCents === 0 ? null : (product.paymentPlans[0] ?? null);
}

async function loadArtistRequest(
  db: Pick<Db, "select">,
  clerkUserId: string,
  purchaseRequestId: string,
) {
  const [row] = await db
    .select({
      request: purchaseRequests,
      product: products,
      producerName: producers.displayName,
    })
    .from(purchaseRequests)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchaseRequests.clientContactId),
        eq(clientContacts.producerId, purchaseRequests.producerId),
      ),
    )
    .innerJoin(
      products,
      and(
        eq(products.id, purchaseRequests.productId),
        eq(products.producerId, purchaseRequests.producerId),
      ),
    )
    .innerJoin(producers, eq(producers.id, purchaseRequests.producerId))
    .where(
      and(
        eq(purchaseRequests.id, purchaseRequestId),
        eq(clientContacts.clerkUserId, clerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row;
}

async function loadProducerRequest(
  db: Pick<Db, "select">,
  producerId: string,
  purchaseRequestId: string,
) {
  const [row] = await db
    .select({
      request: purchaseRequests,
      product: products,
      producerName: producers.displayName,
    })
    .from(purchaseRequests)
    .innerJoin(
      products,
      and(
        eq(products.id, purchaseRequests.productId),
        eq(products.producerId, purchaseRequests.producerId),
      ),
    )
    .innerJoin(producers, eq(producers.id, purchaseRequests.producerId))
    .where(
      and(eq(purchaseRequests.id, purchaseRequestId), eq(purchaseRequests.producerId, producerId)),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row;
}

async function applyProducerRequestTransition(
  db: Db,
  producerId: string,
  purchaseRequestId: string,
  action: PurchaseRequestTransitionAction,
) {
  return db.transaction(async (tx) => {
    const loaded = await loadProducerRequest(tx, producerId, purchaseRequestId);
    let transition;
    try {
      transition = transitionPurchaseRequest(loaded.request, action, new Date());
    } catch (error) {
      mapRequestDomainError(error);
    }
    if (!transition.changed) return { ...loaded, transition };

    const [updated] = await tx
      .update(purchaseRequests)
      .set({
        status: transition.status,
        approvedAt: transition.approvedAt,
        declinedAt: transition.declinedAt,
        statusChangedAt: transition.statusChangedAt,
        updatedAt: transition.statusChangedAt,
      })
      .where(
        and(
          eq(purchaseRequests.id, loaded.request.id),
          eq(purchaseRequests.producerId, producerId),
          eq(purchaseRequests.status, loaded.request.status),
        ),
      )
      .returning({ id: purchaseRequests.id });
    if (!updated) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request changed in another tab. Refresh and try again.",
      });
    }
    return { ...loaded, transition };
  });
}

export const artistPurchaseRouter = router({
  request: artistProcedure
    .input(
      z
        .object({
          productId: z.string().uuid(),
          songQty: z.number().int().min(1).max(1000).optional(),
          projectId: z.string().uuid().optional(),
          brief: z.string().trim().max(5000).optional(),
          operationKey: z.string().trim().min(1).max(200),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const [product] = await ctx.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const [contact] = await ctx.db
        .select({ id: clientContacts.id, name: clientContacts.name, email: clientContacts.email })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.producerId, product.producerId),
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.projectId) {
        const [ownedProject] = await ctx.db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.producerId, product.producerId),
              eq(projects.clientContactId, contact.id),
            ),
          )
          .limit(1);
        if (!ownedProject) throw new TRPCError({ code: "NOT_FOUND" });
      }

      const brief = input.brief?.trim() || null;
      let operation;
      try {
        operation = preparePurchaseRequestOperation(input.operationKey, {
          productId: product.id,
          projectId: input.projectId ?? null,
          requestedSongQty: input.songQty ?? null,
          brief,
        });
      } catch (error) {
        mapRequestDomainError(error);
      }

      const result = await ctx.db.transaction(async (tx) => {
        const findExisting = async () => {
          const [existing] = await tx
            .select()
            .from(purchaseRequests)
            .where(
              and(
                eq(purchaseRequests.producerId, product.producerId),
                eq(purchaseRequests.clientContactId, contact.id),
                eq(purchaseRequests.operationKey, operation.operationKey),
              ),
            )
            .limit(1);
          return existing ?? null;
        };

        const existing = await findExisting();
        if (existing) {
          try {
            assertPurchaseRequestOperationReplay(existing, operation);
          } catch (error) {
            mapRequestDomainError(error);
          }
          return { request: existing, created: false };
        }

        const now = new Date();
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const [inserted] = await tx
            .insert(purchaseRequests)
            .values({
              producerId: product.producerId,
              clientContactId: contact.id,
              productId: product.id,
              projectId: input.projectId ?? null,
              operationKey: operation.operationKey,
              operationDigest: operation.operationDigest,
              refNumber: generateRefNumber(),
              status: "pending",
              artistName: contact.name,
              artistEmail: contact.email.trim().toLowerCase(),
              requestedSongQty: input.songQty ?? null,
              brief,
              statusChangedAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted) return { request: inserted, created: true };

          const winner = await findExisting();
          if (winner) {
            try {
              assertPurchaseRequestOperationReplay(winner, operation);
            } catch (error) {
              mapRequestDomainError(error);
            }
            return { request: winner, created: false };
          }
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not allocate a purchase request reference.",
        });
      });

      if (result.created) {
        try {
          await emitPurchaseRequested(ctx.db, {
            producerId: product.producerId,
            purchaseRequestId: result.request.id,
            artistName: contact.name,
            artistEmail: contact.email,
            productName: product.name,
            refNumber: result.request.refNumber,
          });
        } catch {
          console.error("[notify] purchase-requested failed");
        }
      }

      return {
        purchaseRequestId: result.request.id,
        refNumber: result.request.refNumber,
        status: result.request.status,
      };
    }),

  get: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { request, product, producerName } = await loadArtistRequest(
        ctx.db,
        ctx.clerkUserId,
        input.purchaseRequestId,
      );
      const price = requestPrice(request, product);
      return {
        id: request.id,
        refNumber: request.refNumber,
        status: request.status,
        productId: request.productId,
        projectId: request.projectId,
        requestedSongQty: request.requestedSongQty,
        brief: request.brief,
        createdAt: request.createdAt,
        statusChangedAt: request.statusChangedAt,
        producerName: producerName ?? "Your producer",
        // Compatibility display values are live proposal data. They are not
        // persisted or accepted snapshots; immutable terms begin at Purchase.
        productNameSnapshot: product.name,
        priceCents: price.priceCents,
        currency: product.currency,
        paymentPlan: proposalPlan(product, price.priceCents),
        songQty: price.songQty,
        unitPriceCents: price.unitPriceCents,
        contractUrlSnapshot: safeAgreementUrl(product.contractUrl),
        royaltyTermsSnapshot: product.royaltyTerms,
        agreementTextSnapshot: effectiveAgreementText(product),
        agreementAccepted: false,
      };
    }),

  pending: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.producerId, input.producerId),
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) return { pending: null };

      const [pending] = await ctx.db
        .select({
          id: purchaseRequests.id,
          producerId: purchaseRequests.producerId,
          refNumber: purchaseRequests.refNumber,
          productId: purchaseRequests.productId,
          projectId: purchaseRequests.projectId,
          status: purchaseRequests.status,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.producerId, input.producerId),
            eq(purchaseRequests.clientContactId, contact.id),
            inArray(purchaseRequests.status, ["pending", "approved"]),
          ),
        )
        .orderBy(desc(purchaseRequests.createdAt))
        .limit(1);
      return { pending: pending ?? null };
    }),

  current: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query((): { current: ArtistCurrentCompatibility | null } => ({ current: null })),

  paymentPlan: router({
    options: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { request, product, producerName } = await loadArtistRequest(
          ctx.db,
          ctx.clerkUserId,
          input.purchaseRequestId,
        );
        if (request.status === "canceled" || request.status === "converted") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const price = requestPrice(request, product);
        return {
          productId: request.productId,
          productName: product.name,
          producerName: producerName ?? "Your producer",
          status: request.status as CompatibilityPurchaseStatus,
          chosenPlan: proposalPlan(product, price.priceCents),
          chosenAt: null as Date | null,
          totalCents: price.priceCents,
          currency: product.currency,
          options:
            price.priceCents === 0 ? [] : buildPlanOptions(product.paymentPlans, price.priceCents),
        };
      }),

    choose: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          paymentPlan: PAYMENT_PLAN_INPUT,
        }),
      )
      .mutation((): { ok: true; plan: PlanOption } =>
        notImplemented("artist.purchase.paymentPlan.choose"),
      ),
  }),

  paymentInstructions: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .query(
      (): ArtistPaymentInstructionsOutput => notImplemented("artist.purchase.paymentInstructions"),
    ),

  proofOfPayment: router({
    state: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query((): ArtistProofStateOutput => notImplemented("artist.purchase.proofOfPayment.state")),
    presign: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          fileName: z.string().min(1).max(200),
          contentType: z.enum(PROOF_CONTENT_TYPES),
          sizeBytes: z.number().int().positive().max(MAX_PROOF_BYTES),
        }),
      )
      .mutation((): { uploadUrl: string } =>
        notImplemented("artist.purchase.proofOfPayment.presign"),
      ),
    submit: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          amountCents: z.number().int().positive(),
          originalFileName: z.string().trim().min(1).max(200),
          note: z.string().max(2000).optional(),
        }),
      )
      .mutation(
        (): { ok: true; proofId: string; purchaseRequestId: string; productId: string | null } =>
          notImplemented("artist.purchase.proofOfPayment.submit"),
      ),
  }),
});

export const producerPurchaseRouter = router({
  approve: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyProducerRequestTransition(
        ctx.db,
        ctx.producerId,
        input.id,
        "approve",
      );
      const { request } = result;
      const approvedAt = result.transition.approvedAt ?? request.approvedAt;
      if (!approvedAt) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      if (result.transition.changed) {
        try {
          await emitPurchaseApproved(ctx.db, {
            producerId: request.producerId,
            purchaseRequestId: request.id,
            artistName: request.artistName,
            productName: result.product.name,
            refNumber: request.refNumber,
          });
        } catch {
          console.error("[notify] purchase-approved failed");
        }

        const price = requestPrice(request, result.product);
        after(async () => {
          try {
            await sendPurchaseApprovedEmail(request.artistEmail, {
              artistName: request.artistName,
              producerName: result.producerName ?? "Your producer",
              productName: result.product.name,
              refNumber: request.refNumber,
              currency: result.product.currency,
              priceCents: price.priceCents,
            });
          } catch {
            console.error("[email] purchase-approved failed");
          }
        });
      }

      return {
        ok: true as const,
        status: "approved" as const,
        approvedAt,
        undoableUntil: purchaseRequestApprovalUndoDeadline(approvedAt),
        projectId: request.projectId,
      };
    }),

  decline: producerProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyProducerRequestTransition(
        ctx.db,
        ctx.producerId,
        input.id,
        "decline",
      );
      const { request } = result;
      const declinedAt = result.transition.declinedAt ?? request.declinedAt;
      if (!declinedAt) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      if (result.transition.changed) {
        try {
          await emitPurchaseDeclined(ctx.db, {
            producerId: request.producerId,
            purchaseRequestId: request.id,
            artistName: request.artistName,
            productName: result.product.name,
            refNumber: request.refNumber,
            reason: input.reason ?? null,
          });
        } catch {
          console.error("[notify] purchase-declined failed");
        }

        after(async () => {
          try {
            await sendPurchaseDeclinedEmail(request.artistEmail, {
              artistName: request.artistName,
              producerName: result.producerName ?? "Your producer",
              productName: result.product.name,
              refNumber: request.refNumber,
            });
          } catch {
            console.error("[email] purchase-declined failed");
          }
        });
      }
      return { ok: true as const, status: "declined" as const, declinedAt };
    }),

  undoApproval: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await applyProducerRequestTransition(ctx.db, ctx.producerId, input.id, "undo_approval");
      return { ok: true as const, status: "pending" as const };
    }),

  list: producerProcedure
    .input(z.object({ status: PURCHASE_REQUEST_STATUS_INPUT.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ request: purchaseRequests, product: products })
        .from(purchaseRequests)
        .innerJoin(
          products,
          and(
            eq(products.id, purchaseRequests.productId),
            eq(products.producerId, purchaseRequests.producerId),
          ),
        )
        .where(
          input?.status
            ? and(
                eq(purchaseRequests.producerId, ctx.producerId),
                eq(purchaseRequests.status, input.status),
              )
            : eq(purchaseRequests.producerId, ctx.producerId),
        )
        .orderBy(desc(purchaseRequests.createdAt));
      return {
        requests: rows.map(({ request, product }) => {
          const price = requestPrice(request, product);
          return {
            id: request.id,
            refNumber: request.refNumber,
            status: request.status,
            artistName: request.artistName,
            artistEmail: request.artistEmail,
            productId: request.productId,
            productNameSnapshot: product.name,
            priceCents: price.priceCents,
            currency: product.currency,
            requestedSongQty: request.requestedSongQty,
            brief: request.brief,
            createdAt: request.createdAt,
          };
        }),
      };
    }),

  get: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { request, product } = await loadProducerRequest(ctx.db, ctx.producerId, input.id);
      if (request.status === "canceled" || request.status === "converted") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const price = requestPrice(request, product);
      const paymentPlan = proposalPlan(product, price.priceCents);
      return {
        request: {
          id: request.id,
          refNumber: request.refNumber,
          status: request.status,
          statusChangedAt: request.statusChangedAt,
          approvedAt: request.approvedAt,
          declinedAt: request.declinedAt,
          createdAt: request.createdAt,
          artistName: request.artistName,
          artistEmail: request.artistEmail,
          productId: request.productId,
          productNameSnapshot: product.name,
          priceCents: price.priceCents,
          currency: product.currency,
          sessionCountSnapshot: computeProjectSessionCount(product, price.songQty),
          songQty: price.songQty,
          unitPriceCents: price.unitPriceCents,
          paymentPlanSnapshot: paymentPlan,
          paymentPlanOptionsSnapshot: price.priceCents === 0 ? [] : product.paymentPlans,
          paymentPlanChosenAt: null as Date | null,
          royaltyTermsSnapshot: product.royaltyTerms,
          agreementTextSnapshot: effectiveAgreementText(product),
          undoableUntil:
            request.status === "approved" && request.approvedAt
              ? purchaseRequestApprovalUndoDeadline(request.approvedAt)
              : null,
          contractUrlSnapshot: safeAgreementUrl(product.contractUrl),
        },
        agreement: {
          acceptedAt: null as Date | null,
          agreementUrl: safeAgreementUrl(product.contractUrl),
        },
      };
    }),

  proofOfPayment: router({
    pending: producerProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid().optional() }).optional())
      .query((): { available: false; proofs: ProducerPendingProof[] } => ({
        available: false,
        proofs: [],
      })),
    history: producerProcedure
      .input(
        z.union([
          z.object({ purchaseRequestId: z.string().uuid() }),
          z.object({ clientContactId: z.string().uuid() }),
        ]),
      )
      .query((): { available: false; proofs: ProducerProofHistory[] } => ({
        available: false,
        proofs: [],
      })),
    view: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .query((): { url: string; expiresInSeconds: number } =>
        notImplemented("producer.purchase.proofOfPayment.view"),
      ),
    confirm: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .mutation(
        (): ProducerProofConfirmOutput =>
          notImplemented("producer.purchase.proofOfPayment.confirm"),
      ),
    reject: producerProcedure
      .input(
        z.object({
          proofId: z.string().uuid(),
          note: z.string().trim().min(1).max(2000),
        }),
      )
      .mutation(
        (): ProducerProofRejectOutput => notImplemented("producer.purchase.proofOfPayment.reject"),
      ),
  }),
});
