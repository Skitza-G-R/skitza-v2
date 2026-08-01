import {
  and,
  asc,
  clientContacts,
  desc,
  eq,
  inArray,
  isNull,
  products,
  producers,
  projects,
  purchaseRequests,
  sql,
} from "@skitza/db";
import type {
  Db,
  PaymentPlan,
  Product,
  PurchaseRequest,
} from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";

import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { snapshotProductPrice } from "~/lib/purchase/price-snapshot";
import { generateRefNumber } from "~/lib/purchase/request-helpers";
import {
  emitArtistProofDecisionNotification,
  emitArtistPurchaseDecisionNotification,
} from "~/server/artist/notification-emitters";
import {
  getProducerPaymentInstructions,
  loadArtistInstallmentPaymentInstructions,
  PaymentInstructionsNotFoundError,
  saveProducerPaymentInstructions,
} from "~/server/domain/payment-instructions/service";
import {
  cancelArtistProofUpload,
  confirmProducerPaymentProof,
  listProducerPaymentProofHistory,
  listProducerPendingPaymentProofs,
  loadArtistPaymentProofState,
  loadProducerPaymentProofReview,
  PaymentProofDomainError,
  prepareArtistProofUpload,
  rejectProducerPaymentProof,
  submitArtistPaymentProof,
} from "~/server/domain/payment-proofs/service";
import { MAX_PROOF_BYTES, PROOF_CONTENT_TYPES } from "~/server/domain/payment-proofs/policy";
import { paymentLedgerReadRepository } from "~/server/domain/purchase-ledger/read-db";
import { loadArtistPaymentReadModel } from "~/server/domain/purchase-ledger/read-model";
import {
  acceptStorePurchase,
  previewStorePurchaseAcceptance,
  StoreAcceptanceError,
} from "~/server/domain/purchases/store-acceptance";
import { loadAcceptedPurchaseForProducerRequest } from "~/server/domain/purchases/db";
import {
  buildPurchaseRequestCommercialProposal,
  isPurchaseRequestApprovalAvailable,
  tryBuildPurchaseRequestCommercialProposal,
  type PurchaseRequestCommercialProposal,
} from "~/server/domain/purchases/request-proposal";
import {
  assertPurchaseRequestOperationReplay,
  preparePurchaseRequestOperation,
  purchaseRequestApprovalUndoDeadline,
  PurchaseRequestDomainError,
  transitionPurchaseRequest,
  type PurchaseRequestTransitionAction,
} from "~/server/domain/purchase-requests/service";
import { loadArtistPurchaseGuard } from "~/server/domain/purchase-requests/active-guard";
import {
  correctProducerPurchaseTarget,
  listSameClientPurchaseTargets,
} from "~/server/domain/purchase-targeting/db";
import { PurchaseTargetingError } from "~/server/domain/purchase-targeting/service";
import {
  sendProofRejectedEmail,
  sendProofVerifiedEmail,
  sendPurchaseApprovedEmail,
  sendPurchaseDeclinedEmail,
} from "~/server/email/send";
import {
  emitAgreementAccepted,
  emitProofSubmitted,
  emitPurchaseApproved,
  emitPurchaseDeclined,
  emitPurchaseRequested,
} from "~/server/notifications/emit";
import {
  deliverPushToProducer,
  deliverPushToProjectArtist,
  deliverPushToPurchaseRequestArtist,
} from "~/server/push/delivery";
import { buildPlanOptions } from "~/server/payments/plan-preview";
import {
  buildStorePurchaseSnapshot,
  StoreProductCommercialError,
} from "~/server/domain/store-products/service";
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
  acceptanceAvailable: boolean;
};

function mapRequestDomainError(error: unknown): never {
  if (!(error instanceof PurchaseRequestDomainError)) throw error;
  if (error.code === "OPERATION_KEY_CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
}

function mapPaymentInstructionsNotFound(error: unknown): never {
  if (error instanceof PaymentInstructionsNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  throw error;
}

function mapPaymentProofError(error: unknown): never {
  if (!(error instanceof PaymentProofDomainError)) throw error;
  switch (error.code) {
    case "NOT_FOUND":
      throw new TRPCError({ code: "NOT_FOUND" });
    case "CONFLICT":
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    case "INVALID_INPUT":
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    case "INTEGRITY_ERROR":
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }
}

function proofServerSecret(): string {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Private proof delivery is not configured",
    });
  }
  return secret;
}

function mapPurchaseTargetingError(error: unknown): never {
  if (!(error instanceof PurchaseTargetingError)) throw error;
  if (error.code === "NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  throw new TRPCError({ code: "CONFLICT", message: error.message });
}

function mapStoreAcceptanceError(error: unknown): never {
  if (!(error instanceof StoreAcceptanceError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  if (error.code === "TERMS_CHANGED") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error.code === "NOT_APPROVED") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
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
      artistClerkUserId: clientContacts.clerkUserId,
      producerName: producers.displayName,
      producerTaxMode: producers.taxMode,
      producerTaxRatePct: producers.taxRatePct,
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

async function loadProjectArtistClerkUserId(
  db: Pick<Db, "select">,
  producerId: string,
  projectId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ clerkUserId: clientContacts.clerkUserId })
    .from(projects)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, projects.clientContactId),
        eq(clientContacts.producerId, projects.producerId),
      ),
    )
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.producerId, producerId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  return row?.clerkUserId ?? null;
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
      artistClerkUserId: clientContacts.clerkUserId,
      producerName: producers.displayName,
      producerTaxMode: producers.taxMode,
      producerTaxRatePct: producers.taxRatePct,
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
    let commercialProposal: PurchaseRequestCommercialProposal | null = null;
    if (action === "approve") {
      try {
        commercialProposal = buildPurchaseRequestCommercialProposal({
          requestedSongQty: loaded.request.requestedSongQty,
          product: loaded.product,
          taxMode: loaded.producerTaxMode,
          taxRatePct: loaded.producerTaxRatePct,
        });
      } catch (error) {
        if (error instanceof StoreProductCommercialError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }
    let transition;
    try {
      transition = transitionPurchaseRequest(loaded.request, action, new Date());
    } catch (error) {
      mapRequestDomainError(error);
    }
    if (!transition.changed) return { ...loaded, transition, commercialProposal };

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
    return { ...loaded, transition, commercialProposal };
  });
}

export const artistPurchaseRouter = router({
  payments: artistProcedure.query(async ({ ctx }) =>
    loadArtistPaymentReadModel(paymentLedgerReadRepository(ctx.db), {
      clerkUserId: ctx.clerkUserId,
      asOf: new Date(),
    }),
  ),

  activeForStudio: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      loadArtistPurchaseGuard(ctx.db, {
        clerkUserId: ctx.clerkUserId,
        producerId: input.producerId,
      }),
    ),

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

      let contact: { id: string; name: string; email: string } | undefined;
      if (input.projectId) {
        [contact] = await ctx.db
          .select({ id: clientContacts.id, name: clientContacts.name, email: clientContacts.email })
          .from(projects)
          .innerJoin(
            clientContacts,
            and(
              eq(projects.clientContactId, clientContacts.id),
              eq(projects.producerId, clientContacts.producerId),
            ),
          )
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.producerId, product.producerId),
              eq(clientContacts.clerkUserId, ctx.clerkUserId),
              isNull(clientContacts.archivedAt),
              inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
            ),
          )
          .limit(1);
      } else {
        [contact] = await ctx.db
          .select({ id: clientContacts.id, name: clientContacts.name, email: clientContacts.email })
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.producerId, product.producerId),
              eq(clientContacts.clerkUserId, ctx.clerkUserId),
              isNull(clientContacts.archivedAt),
            ),
          )
          .orderBy(asc(clientContacts.firstSeenAt), asc(clientContacts.id))
          .limit(1);
      }
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

      const [commercialOwner] = await ctx.db
        .select({ taxMode: producers.taxMode, taxRatePct: producers.taxRatePct })
        .from(producers)
        .where(eq(producers.id, product.producerId))
        .limit(1);
      const initialPlan = product.paymentPlans[0];
      if (!commercialOwner || !initialPlan) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        buildStorePurchaseSnapshot({
          product,
          requestedSongQty: input.songQty,
          taxMode: commercialOwner.taxMode,
          taxRatePct: commercialOwner.taxRatePct,
          selectedPaymentPlan: initialPlan,
        });
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This product is not available." });
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
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`artist-purchase:${ctx.clerkUserId}:${product.producerId}`}, 0))`,
        );

        const findExisting = async () => {
          const [existingRequest] = await tx
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
          return existingRequest ?? null;
        };

        const existing = await findExisting();
        if (existing) {
          try {
            assertPurchaseRequestOperationReplay(existing, operation);
          } catch (error) {
            mapRequestDomainError(error);
          }
        }

        if (!existing) {
          const guard = await loadArtistPurchaseGuard(tx, {
            clerkUserId: ctx.clerkUserId,
            producerId: product.producerId,
          });
          if (guard.blocked) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Finish the current purchase with this studio before starting another.",
            });
          }
        }

        const [availableProduct] = await tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, product.id),
              eq(products.producerId, product.producerId),
              eq(products.active, true),
              isNull(products.archivedAt),
            ),
          )
          .limit(1)
          .for("share");
        if (!availableProduct) throw new TRPCError({ code: "NOT_FOUND" });
        try {
          buildStorePurchaseSnapshot({
            product: availableProduct,
            requestedSongQty: input.songQty,
            taxMode: commercialOwner.taxMode,
            taxRatePct: commercialOwner.taxRatePct,
            selectedPaymentPlan: initialPlan,
          });
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This product is not available." });
        }

        if (input.projectId) {
          const [availableTarget] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, input.projectId),
                eq(projects.producerId, product.producerId),
                eq(projects.clientContactId, contact.id),
                inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
              ),
            )
            .limit(1)
            .for("share");
          if (!availableTarget) throw new TRPCError({ code: "NOT_FOUND" });
        }

        if (existing) {
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
        after(async () => {
          try {
            await deliverPushToProducer(ctx.db, product.producerId, {
              category: "purchase_status",
              url: `/dashboard/requests/${result.request.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
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
        producerId: request.producerId,
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
        // Compatibility-only response field. Store agreements are inline and
        // freeze only in the accepted Purchase commercial snapshot.
        contractUrlSnapshot: null,
        royaltyTermsSnapshot: product.royaltyTerms,
        agreementTextSnapshot: effectiveAgreementText(product),
        agreementAccepted: false,
      };
    }),

  pending: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
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
        .innerJoin(
          clientContacts,
          and(
            eq(clientContacts.id, purchaseRequests.clientContactId),
            eq(clientContacts.producerId, purchaseRequests.producerId),
          ),
        )
        .where(
          and(
            eq(purchaseRequests.producerId, input.producerId),
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            isNull(clientContacts.archivedAt),
            inArray(purchaseRequests.status, ["pending", "approved"]),
          ),
        )
        .orderBy(desc(purchaseRequests.createdAt))
        .limit(1);
      return { pending: pending ?? null };
    }),

  current: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<{ current: ArtistCurrentCompatibility | null }> => {
      const [row] = await ctx.db
        .select({
          request: purchaseRequests,
          product: products,
          producerTaxMode: producers.taxMode,
          producerTaxRatePct: producers.taxRatePct,
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
            eq(purchaseRequests.producerId, input.producerId),
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            isNull(clientContacts.archivedAt),
            inArray(purchaseRequests.status, ["pending", "approved", "declined"]),
          ),
        )
        .orderBy(desc(purchaseRequests.createdAt), desc(purchaseRequests.id))
        .limit(1);
      if (!row) return { current: null };

      const { request, product } = row;
      if (
        request.status !== "pending" &&
        request.status !== "approved" &&
        request.status !== "declined"
      ) {
        return { current: null };
      }

      let proposal: PurchaseRequestCommercialProposal;
      try {
        proposal = buildPurchaseRequestCommercialProposal({
          requestedSongQty: request.requestedSongQty,
          product,
          taxMode: row.producerTaxMode,
          taxRatePct: row.producerTaxRatePct,
          allowUnpublished: true,
        });
      } catch {
        return { current: null };
      }

      return {
        current: {
          id: request.id,
          producerId: request.producerId,
          refNumber: request.refNumber,
          productId: request.productId,
          projectId: request.projectId,
          status: request.status,
          productNameSnapshot: product.name,
          priceCents: proposal.totalCents,
          currency: proposal.currency,
          statusChangedAt: request.statusChangedAt,
          createdAt: request.createdAt,
          paidCents: 0,
          pendingProofCents: 0,
          remainingCents: proposal.totalCents,
          paidInFull: proposal.totalCents === 0,
          acceptanceAvailable: isPurchaseRequestApprovalAvailable(product),
        },
      };
    }),

  paymentPlan: router({
    options: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { request, product, producerName, producerTaxMode, producerTaxRatePct } =
          await loadArtistRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        if (request.status === "canceled" || request.status === "converted") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const offeredPlan = product.paymentPlans[0];
        if (!offeredPlan) throw new TRPCError({ code: "NOT_FOUND" });
        let exactTerms;
        try {
          exactTerms = buildStorePurchaseSnapshot({
            product,
            requestedSongQty: request.requestedSongQty,
            taxMode: producerTaxMode,
            taxRatePct: producerTaxRatePct,
            selectedPaymentPlan: offeredPlan,
          });
        } catch {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const totalCents = exactTerms.snapshot.totalCents;
        return {
          productId: request.productId,
          producerId: request.producerId,
          productName: product.name,
          producerName: producerName ?? "Your producer",
          status: request.status as CompatibilityPurchaseStatus,
          chosenPlan: offeredPlan,
          chosenAt: null as Date | null,
          totalCents,
          currency: product.currency,
          options: buildPlanOptions(product.paymentPlans, totalCents),
        };
      }),
  }),

  acceptance: router({
    preview: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          paymentPlan: PAYMENT_PLAN_INPUT,
        }),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await previewStorePurchaseAcceptance(ctx.db, {
            clerkUserId: ctx.clerkUserId,
            purchaseRequestId: input.purchaseRequestId,
            selectedPaymentPlan: input.paymentPlan,
          });
        } catch (error) {
          mapStoreAcceptanceError(error);
        }
      }),

    accept: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          paymentPlan: PAYMENT_PLAN_INPUT,
          expectedSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
          operationKey: z.string().trim().min(1).max(200),
          agreementAccepted: z.literal(true),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        let result;
        try {
          result = await acceptStorePurchase(ctx.db, {
            clerkUserId: ctx.clerkUserId,
            purchaseRequestId: input.purchaseRequestId,
            selectedPaymentPlan: input.paymentPlan,
            expectedSnapshotDigest: input.expectedSnapshotDigest,
            operationKey: input.operationKey,
            agreementAccepted: input.agreementAccepted,
          });
        } catch (error) {
          mapStoreAcceptanceError(error);
        }

        const notification = result.notification;
        if (notification) {
          try {
            await emitAgreementAccepted(ctx.db, notification);
          } catch {
            console.error("[notify] agreement-accepted failed");
          }
          after(async () => {
            try {
              await deliverPushToProducer(ctx.db, notification.producerId, {
                category: "purchase_status",
                url: `/dashboard/requests/${notification.purchaseRequestId}`,
              });
            } catch {
              // Push is best effort and must not expose delivery details.
            }
          });
        }
        return {
          purchaseId: result.purchaseId,
          productId: result.productId,
          created: result.created,
        };
      }),
  }),

  paymentInstructions: artistProcedure
    .input(
      z.union([
        z
          .object({
            purchaseId: z.string().uuid(),
            installmentId: z.string().uuid().optional(),
          })
          .strict(),
        z
          .object({
            purchaseRequestId: z.string().uuid(),
            installmentId: z.string().uuid().optional(),
          })
          .strict(),
      ]),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await loadArtistInstallmentPaymentInstructions(ctx.db, ctx.clerkUserId, input);
      } catch (error) {
        mapPaymentInstructionsNotFound(error);
      }
    }),

  proofOfPayment: router({
    state: artistProcedure
      .input(
        z.object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await loadArtistPaymentProofState(ctx.db, {
            clerkUserId: ctx.clerkUserId,
            purchaseId: input.purchaseId,
            installmentId: input.installmentId,
            serverSecret: proofServerSecret(),
          });
        } catch (error) {
          mapPaymentProofError(error);
        }
      }),
    presign: artistProcedure
      .input(
        z.object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          operationKey: z.string().uuid(),
          fileName: z.string().min(1).max(200),
          contentType: z.enum(PROOF_CONTENT_TYPES),
          sizeBytes: z.number().int().positive().max(MAX_PROOF_BYTES),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await prepareArtistProofUpload(ctx.db, {
            clerkUserId: ctx.clerkUserId,
            purchaseId: input.purchaseId,
            installmentId: input.installmentId,
            operationKey: input.operationKey,
            originalFileName: input.fileName,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            serverSecret: proofServerSecret(),
          });
        } catch (error) {
          mapPaymentProofError(error);
        }
      }),
    cancel: artistProcedure
      .input(
        z.object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          uploadToken: z.string().min(1).max(4096),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await cancelArtistProofUpload({
            clerkUserId: ctx.clerkUserId,
            purchaseId: input.purchaseId,
            installmentId: input.installmentId,
            uploadToken: input.uploadToken,
            serverSecret: proofServerSecret(),
          });
        } catch (error) {
          mapPaymentProofError(error);
        }
      }),
    submit: artistProcedure
      .input(
        z.object({
          purchaseId: z.string().uuid(),
          installmentId: z.string().uuid(),
          uploadToken: z.string().min(1).max(4096),
          amountCents: z.number().int().positive(),
          note: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        let result;
        try {
          result = await submitArtistPaymentProof(ctx.db, {
            clerkUserId: ctx.clerkUserId,
            purchaseId: input.purchaseId,
            installmentId: input.installmentId,
            uploadToken: input.uploadToken,
            amountCents: input.amountCents,
            note: input.note,
            serverSecret: proofServerSecret(),
          });
        } catch (error) {
          mapPaymentProofError(error);
        }
        const notification = result.notification;
        if (notification) {
          try {
            await emitProofSubmitted(ctx.db, notification);
          } catch {
            console.error("[notify] proof-submitted failed");
          }
          after(async () => {
            try {
              await deliverPushToProducer(ctx.db, notification.producerId, {
                category: "payment",
                url: `/dashboard/payments/${notification.proofId}`,
              });
            } catch {
              // Push is best effort and must not expose delivery details.
            }
          });
        }
        return {
          ok: true as const,
          proofId: result.proofId,
          purchaseId: result.purchaseId,
          installmentId: result.installmentId,
          productId: result.productId,
          projectId: result.projectId,
          created: result.created,
        };
      }),
  }),
});

export const producerPurchaseRouter = router({
  paymentInstructions: router({
    get: producerProcedure.query(async ({ ctx }) => {
      try {
        return await getProducerPaymentInstructions(ctx.db, ctx.producerId);
      } catch (error) {
        mapPaymentInstructionsNotFound(error);
      }
    }),
    update: producerProcedure
      .input(
        z
          .object({
            bankTransfer: z.string().max(500).optional(),
            bitPhone: z.string().max(32).optional(),
            note: z.string().max(500).optional(),
          })
          .strict(),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await saveProducerPaymentInstructions(ctx.db, ctx.producerId, input);
        } catch (error) {
          mapPaymentInstructionsNotFound(error);
        }
      }),
  }),

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
        const proposal = result.commercialProposal;
        if (!proposal) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        }
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

        let artistEmailEnabled = true;
        try {
          const channels = await emitArtistPurchaseDecisionNotification(ctx.db, {
            recipientClerkUserId: result.artistClerkUserId,
            producerId: request.producerId,
            purchaseRequestId: request.id,
            productId: request.productId,
            producerName: result.producerName ?? "Your producer",
            productName: result.product.name,
            decision: "approved",
          });
          artistEmailEnabled = channels.emailEnabled;
        } catch {
          console.error("[notify] artist purchase-approved failed");
        }

        if (artistEmailEnabled) {
          after(async () => {
            try {
              await sendPurchaseApprovedEmail(request.artistEmail, {
                artistName: request.artistName,
                producerName: result.producerName ?? "Your producer",
                productName: result.product.name,
                refNumber: request.refNumber,
                currency: result.product.currency,
                subtotalCents: proposal.subtotalCents,
                taxMode: proposal.tax.mode,
                taxRatePct: proposal.tax.ratePct,
                taxCents: proposal.tax.amountCents,
                totalCents: proposal.totalCents,
              });
            } catch {
              console.error("[email] purchase-approved failed");
            }
          });
        }
        after(async () => {
          try {
            await deliverPushToPurchaseRequestArtist(ctx.db, request.id, {
              category: "purchase_status",
              url: `/artist/purchase/${request.productId}/pay?req=${request.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
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

        let artistEmailEnabled = true;
        try {
          const channels = await emitArtistPurchaseDecisionNotification(ctx.db, {
            recipientClerkUserId: result.artistClerkUserId,
            producerId: request.producerId,
            purchaseRequestId: request.id,
            productId: request.productId,
            producerName: result.producerName ?? "Your producer",
            productName: result.product.name,
            decision: "declined",
          });
          artistEmailEnabled = channels.emailEnabled;
        } catch {
          console.error("[notify] artist purchase-declined failed");
        }

        if (artistEmailEnabled) {
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
        after(async () => {
          try {
            await deliverPushToPurchaseRequestArtist(ctx.db, request.id, {
              category: "purchase_status",
              url: `/artist/purchase/${request.productId}/sent?req=${request.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
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
        .select({
          request: purchaseRequests,
          product: products,
          producerTaxMode: producers.taxMode,
          producerTaxRatePct: producers.taxRatePct,
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
          input?.status
            ? and(
                eq(purchaseRequests.producerId, ctx.producerId),
                eq(purchaseRequests.status, input.status),
              )
            : eq(purchaseRequests.producerId, ctx.producerId),
        )
        .orderBy(desc(purchaseRequests.createdAt));
      return {
        requests: rows.map(({ request, product, producerTaxMode, producerTaxRatePct }) => {
          const proposal = tryBuildPurchaseRequestCommercialProposal({
            requestedSongQty: request.requestedSongQty,
            product,
            taxMode: producerTaxMode,
            taxRatePct: producerTaxRatePct,
            allowUnpublished: true,
          });
          return {
            id: request.id,
            refNumber: request.refNumber,
            status: request.status,
            artistName: request.artistName,
            artistEmail: request.artistEmail,
            productId: request.productId,
            productNameSnapshot: product.name,
            priceCents: proposal?.totalCents ?? null,
            currency: proposal?.currency ?? product.currency,
            commercialTermsAvailable: proposal !== null,
            approvalAvailable:
              proposal !== null && isPurchaseRequestApprovalAvailable(product),
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
      const { request, product, producerTaxMode, producerTaxRatePct } = await loadProducerRequest(
        ctx.db,
        ctx.producerId,
        input.id,
      );
      if (request.status === "canceled") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const commonRequest = {
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
        requestedSongQty: request.requestedSongQty,
        brief: request.brief,
        projectId: request.projectId,
      };

      if (request.status === "converted") {
        const accepted = await loadAcceptedPurchaseForProducerRequest(ctx.db, {
          producerId: request.producerId,
          clientContactId: request.clientContactId,
          purchaseRequestId: request.id,
        });
        if (!accepted) throw new TRPCError({ code: "NOT_FOUND" });

        return {
          request: {
            ...commonRequest,
            status: "converted" as const,
            undoableUntil: null,
            targetProjects: [],
          },
          commercialTerms: {
            kind: "accepted" as const,
            purchaseId: accepted.purchase.id,
            acceptedAt: accepted.acceptance.acceptedAt,
            snapshot: accepted.acceptance.commercialSnapshot.value,
          },
        };
      }

      const commercialProposal = tryBuildPurchaseRequestCommercialProposal({
        requestedSongQty: request.requestedSongQty,
        product,
        taxMode: producerTaxMode,
        taxRatePct: producerTaxRatePct,
        allowUnpublished: true,
      });
      const targetProjects = await listSameClientPurchaseTargets(ctx.db, {
        producerId: request.producerId,
        clientContactId: request.clientContactId,
      });
      return {
        request: {
          ...commonRequest,
          status: request.status,
          undoableUntil:
            request.status === "approved" && request.approvedAt
              ? purchaseRequestApprovalUndoDeadline(request.approvedAt)
              : null,
          targetProjects,
        },
        commercialTerms: {
          ...(commercialProposal
            ? {
                kind: "proposal" as const,
                snapshot: commercialProposal,
                approvalAvailable: isPurchaseRequestApprovalAvailable(product),
              }
            : {
                kind: "unavailable" as const,
                productName: product.name,
              }),
        },
      };
    }),

  correctTarget: producerProcedure
    .input(
      z.object({
        purchaseRequestId: z.string().uuid(),
        projectId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await correctProducerPurchaseTarget(ctx.db, {
          producerId: ctx.producerId,
          purchaseRequestId: input.purchaseRequestId,
          projectId: input.projectId,
        });
      } catch (error) {
        mapPurchaseTargetingError(error);
      }
    }),

  proofOfPayment: router({
    pending: producerProcedure
      .input(z.object({ purchaseId: z.string().uuid().optional() }).optional())
      .query(async ({ ctx, input }) => ({
        available: true as const,
        proofs: await listProducerPendingPaymentProofs(ctx.db, ctx.producerId, input?.purchaseId),
      })),
    history: producerProcedure
      .input(
        z
          .object({
            purchaseId: z.string().uuid().optional(),
            clientContactId: z.string().uuid().optional(),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => ({
        available: true as const,
        proofs: await listProducerPaymentProofHistory(ctx.db, {
          producerId: ctx.producerId,
          purchaseId: input?.purchaseId,
          clientContactId: input?.clientContactId,
          limit: input?.limit,
        }),
      })),
    get: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        try {
          return await loadProducerPaymentProofReview(ctx.db, {
            producerId: ctx.producerId,
            clerkUserId: ctx.userId,
            proofId: input.proofId,
            serverSecret: proofServerSecret(),
          });
        } catch (error) {
          mapPaymentProofError(error);
        }
      }),
    view: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        try {
          const review = await loadProducerPaymentProofReview(ctx.db, {
            producerId: ctx.producerId,
            clerkUserId: ctx.userId,
            proofId: input.proofId,
            serverSecret: proofServerSecret(),
          });
          return {
            url: review.evidenceUrl,
            expiresInSeconds: review.evidenceExpiresInSeconds,
          };
        } catch (error) {
          mapPaymentProofError(error);
        }
      }),
    confirm: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        let result;
        try {
          result = await confirmProducerPaymentProof(ctx.db, {
            producerId: ctx.producerId,
            clerkUserId: ctx.userId,
            proofId: input.proofId,
          });
        } catch (error) {
          mapPaymentProofError(error);
        }
        const email = result.email;
        let artistEmailEnabled = true;
        if (result.created) {
          try {
            const recipientClerkUserId = await loadProjectArtistClerkUserId(
              ctx.db,
              ctx.producerId,
              result.projectId,
            );
            const channels = await emitArtistProofDecisionNotification(ctx.db, {
              recipientClerkUserId,
              producerId: ctx.producerId,
              purchaseId: result.purchaseId,
              proofId: result.proofId,
              producerName: email?.producerName ?? "Your producer",
              productName: email?.productName ?? "Purchase",
              decision: "verified",
            });
            artistEmailEnabled = channels.emailEnabled;
          } catch {
            console.error("[notify] artist proof-verified failed");
          }
          after(async () => {
            try {
              await deliverPushToProjectArtist(ctx.db, result.projectId, {
                category: "payment",
                url: `/artist/payments/${result.purchaseId}`,
              });
            } catch {
              // Push is best effort and must not expose delivery details.
            }
          });
        }
        if (email && artistEmailEnabled) {
          after(async () => {
            try {
              await sendProofVerifiedEmail(email.artistEmail, email);
            } catch {
              console.error("[email] proof-verified failed");
            }
          });
        }
        return result;
      }),
    reject: producerProcedure
      .input(
        z.object({
          proofId: z.string().uuid(),
          note: z.string().trim().min(1).max(2000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        let result;
        try {
          result = await rejectProducerPaymentProof(ctx.db, {
            producerId: ctx.producerId,
            clerkUserId: ctx.userId,
            proofId: input.proofId,
            note: input.note,
          });
        } catch (error) {
          mapPaymentProofError(error);
        }
        const email = result.email;
        const rejectionNote = email?.rejectionNote;
        let artistEmailEnabled = true;
        if (result.changed) {
          try {
            const recipientClerkUserId = await loadProjectArtistClerkUserId(
              ctx.db,
              ctx.producerId,
              result.projectId,
            );
            const channels = await emitArtistProofDecisionNotification(ctx.db, {
              recipientClerkUserId,
              producerId: ctx.producerId,
              purchaseId: result.purchaseId,
              proofId: result.proofId,
              producerName: email?.producerName ?? "Your producer",
              productName: email?.productName ?? "Purchase",
              decision: "rejected",
            });
            artistEmailEnabled = channels.emailEnabled;
          } catch {
            console.error("[notify] artist proof-rejected failed");
          }
          after(async () => {
            try {
              await deliverPushToProjectArtist(ctx.db, result.projectId, {
                category: "payment",
                url: `/artist/payments/${result.purchaseId}`,
              });
            } catch {
              // Push is best effort and must not expose delivery details.
            }
          });
        }
        if (email && rejectionNote && artistEmailEnabled) {
          after(async () => {
            try {
              await sendProofRejectedEmail(email.artistEmail, {
                artistName: email.artistName,
                producerName: email.producerName,
                productName: email.productName,
                refNumber: email.refNumber,
                note: rejectionNote,
              });
            } catch {
              console.error("[email] proof-rejected failed");
            }
          });
        }
        return result;
      }),
  }),
});
