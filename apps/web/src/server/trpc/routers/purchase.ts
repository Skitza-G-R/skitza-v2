import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  agreementAcceptances,
  and,
  clientContacts,
  desc,
  eq,
  inArray,
  invoices,
  isNull,
  paymentProofs,
  producers,
  products,
  purchaseRequests,
  sql,
} from "@skitza/db";
import type { Db, PaymentPlan, PaymentProof, PurchaseRequest } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";

import { snapshotProductPrice, validatePerSongUnit } from "~/lib/purchase/price-snapshot";
import { commercialTermsFingerprint } from "~/lib/purchase/commercial-terms-fingerprint";
import { safeAgreementUrl } from "~/lib/agreement-url";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";
import {
  generateRefNumber,
  isUniqueViolation,
  offeredPlans,
  planIsOffered,
} from "~/lib/purchase/request-helpers";
import type { PaymentPlanChoice } from "~/lib/purchase/request-helpers";
import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { calculateCharges } from "~/server/payments/plan";
import {
  buildPlanOptions,
  chargesProgress,
  invoiceKindForCharge,
  planOption,
} from "~/server/payments/plan-preview";
import {
  BUCKETS,
  buildFinalProofKey,
  buildProofStagingKey,
  encodeR2CopySource,
  getR2,
  hasValidProofFileSignature,
  isProofStagingKeyForPurchase,
} from "~/server/storage/r2";
import {
  emitAgreementAccepted,
  emitProofSubmitted,
  emitPurchaseApproved,
  emitPurchaseDeclined,
  emitPurchaseRequested,
} from "~/server/notifications/emit";
import {
  sendProofRejectedEmail,
  sendProofVerifiedEmail,
  sendPurchaseApprovedEmail,
  sendPurchaseDeclinedEmail,
} from "~/server/email/send";
import { artistProcedure } from "../artist-procedure";
import { producerProcedure } from "../producer-procedure";
import { router } from "../init";

// 5-minute Gate-1 undo window. There is no scheduler in the app, so the
// window is enforced purely at undo-time (now − approvedAt < UNDO_MS).
// Per Raz's call, the engagement project is NOT created on approve — it's
// deferred until the window elapses — so undo has nothing to reverse.
const UNDO_MS = 5 * 60 * 1000;

const PAYMENT_PLAN_INPUT = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("split_50_50") }),
  z.object({
    kind: z.literal("monthly"),
    installments: z.number().int().min(2).max(12),
  }),
  // BE-2: the choice carries no schedule — the server embeds the
  // product's own milestone rows at snapshot time (resolvePlanChoice).
  z.object({ kind: z.literal("milestones") }),
]);

// Rows that can still occupy the artist's single active-purchase slot.
// `paid` means at least one payment was confirmed and sessions unlocked;
// it continues to block until confirmed invoices cover the FULL snapshot.
const BLOCKING_CANDIDATE_STATUSES = ["pending", "approved", "verifying", "paid"] as const;

// Statuses in which money screens (S7-S9) are reachable.
const PAYING_STATUSES = new Set<PurchaseRequest["status"]>(["approved", "verifying", "paid"]);

const PROOF_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;
const MAX_PROOF_BYTES = 15 * 1024 * 1024;

// Running total confirmed for a purchase = SUM of its paid invoices.
async function paidTotalCents(db: Db, purchaseRequestId: string): Promise<number> {
  const rows = await db
    .select({ amountCents: invoices.amountCents })
    .from(invoices)
    .where(and(eq(invoices.purchaseRequestId, purchaseRequestId), eq(invoices.status, "paid")));
  return rows.reduce((sum, r) => sum + r.amountCents, 0);
}

async function pendingProofTotalCents(db: Db, purchaseRequestId: string): Promise<number> {
  const rows = await db
    .select({ amountCents: paymentProofs.amountCents })
    .from(paymentProofs)
    .where(
      and(
        eq(paymentProofs.purchaseRequestId, purchaseRequestId),
        eq(paymentProofs.status, "pending"),
      ),
    );
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

async function deleteProofObjectQuietly(bucket: keyof typeof BUCKETS, key: string): Promise<void> {
  try {
    await getR2().send(new DeleteObjectCommand({ Bucket: BUCKETS[bucket], Key: key }));
  } catch {
    // Lifecycle rules are the final safety net for staging/orphan cleanup.
    // Never include an object key or storage error (which can contain request
    // metadata) in logs.
    console.error("[proof] object cleanup failed");
  }
}

async function assertProofObjectIntegrity(
  proof: Pick<
    PaymentProof,
    "storageBucket" | "storageKey" | "objectEtag" | "contentType" | "sizeBytes"
  >,
): Promise<void> {
  if (!proof.objectEtag) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This proof file needs to be uploaded again before it can be reviewed.",
    });
  }

  try {
    const object = await getR2().send(
      new HeadObjectCommand({
        Bucket: BUCKETS[proof.storageBucket],
        Key: proof.storageKey,
        IfMatch: proof.objectEtag,
      }),
    );
    if (
      object.ETag !== proof.objectEtag ||
      object.ContentLength !== proof.sizeBytes ||
      (object.ContentType ?? "").toLowerCase() !== proof.contentType.toLowerCase()
    ) {
      throw new Error("proof metadata mismatch");
    }
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This proof file changed or is unavailable. Ask the artist to upload it again.",
    });
  }
}

// Resolve a client plan choice into a snapshot-safe PaymentPlan. The
// milestones choice gets the PRODUCT's schedule embedded so a tampered
// payload can't invent one. Null = the product can't satisfy the choice.
function resolvePlanChoice(
  choice: PaymentPlanChoice,
  product: {
    depositModel: string;
    milestones: { label: string; pct: number }[] | null;
  },
): PaymentPlan | null {
  if (choice.kind !== "milestones") return choice;
  if (product.depositModel !== "milestones" || !product.milestones?.length) {
    return null;
  }
  return { kind: "milestones", milestones: product.milestones };
}

function planFromFrozenOptions(
  choice: PaymentPlanChoice,
  plans: PaymentPlan[],
): PaymentPlan | null {
  return (
    plans.find((plan) => {
      if (plan.kind !== choice.kind) return false;
      if (plan.kind === "monthly" && choice.kind === "monthly") {
        return plan.installments === choice.installments;
      }
      return true;
    }) ?? null
  );
}

// A purchase accepts a proof while Gate 1 has passed and money is still
// owed. Returns the charge math so callers don't recompute it.
async function assertAcceptsProof(db: Db, request: PurchaseRequest) {
  if (!PAYING_STATUSES.has(request.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This purchase isn't ready for a payment yet.",
    });
  }
  if (!request.paymentPlanChosenAt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a payment plan before uploading proof.",
    });
  }
  const charges = calculateCharges(request.paymentPlanSnapshot, request.priceCents);
  const paid = await paidTotalCents(db, request.id);
  const reserved = await pendingProofTotalCents(db, request.id);
  const progress = chargesProgress(charges, paid, reserved);
  if (progress.remainingCents <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This purchase is already paid in full.",
    });
  }
  if (progress.reservedCents > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A payment proof is already being reviewed.",
    });
  }
  return { charges, paid, reserved, progress };
}

function frozenPlanOptions(request: PurchaseRequest): PaymentPlan[] {
  return request.paymentPlanOptionsSnapshot?.length
    ? request.paymentPlanOptionsSnapshot
    : [request.paymentPlanSnapshot];
}

function effectiveAgreementText(product: {
  agreementText: string | null;
  description: string | null;
}): string | null {
  // An explicit empty string is a deliberate clear and must not resurrect
  // encoded legacy text. Null means the row has not migrated yet.
  if (product.agreementText !== null) {
    return product.agreementText.trim().length > 0 ? product.agreementText : null;
  }
  return decodeDescription(product.description).contractText || null;
}

// Load a private proof the signed-in producer owns, joined to its purchase
// for status transitions + artist identity.
async function loadProducerProof(db: Db, producerId: string, proofId: string) {
  const [row] = await db
    .select({
      proof: paymentProofs,
      request: purchaseRequests,
      producerName: producers.displayName,
    })
    .from(paymentProofs)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, paymentProofs.purchaseRequestId))
    .innerJoin(producers, eq(producers.id, paymentProofs.producerId))
    .where(eq(paymentProofs.id, proofId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (row.proof.producerId !== producerId || row.request.producerId !== producerId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return row;
}

// Insert a purchase request, retrying with a fresh ref_number on the
// (astronomically unlikely) UNIQUE clash. ON CONFLICT avoids aborting the
// surrounding PostgreSQL transaction, which a caught 23505 would do.
async function insertPurchaseRequest(
  db: Pick<Db, "insert">,
  values: Omit<typeof purchaseRequests.$inferInsert, "refNumber">,
): Promise<PurchaseRequest> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db
      .insert(purchaseRequests)
      .values({ ...values, refNumber: generateRefNumber() })
      .onConflictDoNothing({ target: purchaseRequests.refNumber })
      .returning();
    if (row) return row;
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Couldn't create a unique purchase reference. Try again.",
  });
}

// Load a request the signed-in ARTIST owns. NOT_FOUND on any miss
// (request absent OR not this artist's) so we never leak existence.
async function resolveOwnedRequest(
  db: Db,
  clerkUserId: string,
  purchaseRequestId: string,
): Promise<PurchaseRequest> {
  const [request] = await db
    .select()
    .from(purchaseRequests)
    .where(eq(purchaseRequests.id, purchaseRequestId))
    .limit(1);
  if (!request) throw new TRPCError({ code: "NOT_FOUND" });

  const [contact] = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.id, request.clientContactId),
        eq(clientContacts.clerkUserId, clerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
  return request;
}

// Load a request the signed-in PRODUCER owns, plus their display name
// for outgoing emails. Scope in SQL so cross-tenant ids are never exposed.
async function loadProducerRequest(
  db: Pick<Db, "select">,
  producerId: string,
  id: string,
): Promise<PurchaseRequest & { producerName: string | null }> {
  const [row] = await db
    .select({ request: purchaseRequests, producerName: producers.displayName })
    .from(purchaseRequests)
    .innerJoin(producers, eq(producers.id, purchaseRequests.producerId))
    .where(
      and(
        eq(purchaseRequests.id, id),
        eq(purchaseRequests.producerId, producerId),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return { ...row.request, producerName: row.producerName };
}

// Frozen-contract stub. BE-2/3/4 replace the body; the typed input +
// annotated return shape are stable so the Screens track can build now.
function notImplemented(slice: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${slice} — frozen contract stub, lands in a later backend slice`,
  });
}

// ─── artist.purchase ────────────────────────────────────────────────
export const artistPurchaseRouter = router({
  // Create a purchase request. Price LOCKS here (snapshot of product +
  // chosen plan + contract); no payment is taken. While a request is
  // pending with this studio the artist can't start a second one
  // (additional sessions on a live product are a separate flow — BE-3).
  request: artistProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        paymentPlan: PAYMENT_PLAN_INPUT,
        agreementAccepted: z.literal(true),
        commercialTermsFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        // Required for per_song products; ignored otherwise. The unit
        // price is re-validated against the volume-tier ladder so a
        // tampered payload can't lock an unauthorised rate.
        songQty: z.number().int().min(1).max(1000).optional(),
        unitPriceCents: z.number().int().min(0).max(100_000_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Load product (live + sellable). NOT_FOUND if missing/archived.
      const [prod] = await ctx.db
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
      if (!prod) throw new TRPCError({ code: "NOT_FOUND" });

      const agreementTextSnapshot = effectiveAgreementText(prod);
      const paymentPlanOptionsSnapshot = offeredPlans(prod);
      // Legacy rows may contain a non-web scheme from before agreement URL
      // validation existed. Only freeze the same HTTP(S) reference the artist
      // was actually shown on the review screen.
      const contractUrlSnapshot = safeAgreementUrl(prod.contractUrl);
      const currentTermsFingerprint = commercialTermsFingerprint({
        productName: prod.name,
        priceCents: prod.priceCents,
        currency: prod.currency,
        paymentPlans: paymentPlanOptionsSnapshot,
        royaltyTerms: prod.royaltyTerms ?? null,
        agreementText: agreementTextSnapshot,
        contractUrl: contractUrlSnapshot,
      });
      if (input.commercialTermsFingerprint !== currentTermsFingerprint) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "These product terms changed. Refresh and review them again before sending.",
        });
      }

      // 2. Resolve the artist's contact under this producer (identity
      //    snapshot + the "my studio" access gate). NOT_FOUND on miss.
      const [contact] = await ctx.db
        .select({
          id: clientContacts.id,
          email: clientContacts.email,
          name: clientContacts.name,
        })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, prod.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

      // 3. The chosen plan must be one the product offers. The snapshot
      //    embeds the product's milestone schedule for that plan kind —
      //    this is PROVISIONAL: decision 3 (2026-07-05) moves the real
      //    choice to S7 post-approval via paymentPlan.choose.
      if (!planIsOffered(input.paymentPlan, paymentPlanOptionsSnapshot)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That payment plan isn't offered for this product.",
        });
      }
      const snapshotPlan = resolvePlanChoice(input.paymentPlan, prod);
      if (!snapshotPlan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That payment plan isn't offered for this product.",
        });
      }

      // 4. Price-lock snapshot — covers all four pricing models.
      let priceCents: number;
      let songQty: number | null;
      let unitPriceCents: number | null;
      if (prod.pricingModel === "per_song") {
        const v = validatePerSongUnit(prod, input.songQty, input.unitPriceCents);
        if (!v.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Per-song products need a valid song count — pick one and try again.",
          });
        }
        const snap = snapshotProductPrice(prod, {
          songQty: v.songQty,
          unitPriceCents: v.unitPriceCents,
        });
        priceCents = snap.priceCents;
        songQty = snap.songQty;
        unitPriceCents = snap.unitPriceCents;
      } else {
        const snap = snapshotProductPrice(prod, {});
        priceCents = snap.priceCents;
        songQty = snap.songQty;
        unitPriceCents = snap.unitPriceCents;
      }
      if (priceCents <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This product isn't available for purchase yet — contact the producer directly.",
        });
      }

      // 5. Serialize the artist/studio slot. The advisory lock closes the
      //    double-click race that a SELECT followed by INSERT cannot close.
      //    A partially-paid row remains blocking until paid invoices reach
      //    the full price snapshot.
      const inserted = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contact.id}, 0))`);

        const candidates = await tx
          .select({
            id: purchaseRequests.id,
            status: purchaseRequests.status,
            priceCents: purchaseRequests.priceCents,
          })
          .from(purchaseRequests)
          .where(
            and(
              eq(purchaseRequests.clientContactId, contact.id),
              inArray(purchaseRequests.status, [...BLOCKING_CANDIDATE_STATUSES]),
            ),
          );

        const paidCandidateIds = candidates
          .filter((candidate) => candidate.status === "paid")
          .map((candidate) => candidate.id);
        const paidRows =
          paidCandidateIds.length > 0
            ? await tx
                .select({
                  purchaseRequestId: invoices.purchaseRequestId,
                  amountCents: invoices.amountCents,
                })
                .from(invoices)
                .where(
                  and(
                    inArray(invoices.purchaseRequestId, paidCandidateIds),
                    eq(invoices.status, "paid"),
                  ),
                )
            : [];
        const paidByRequest = new Map<string, number>();
        for (const row of paidRows) {
          if (!row.purchaseRequestId) continue;
          paidByRequest.set(
            row.purchaseRequestId,
            (paidByRequest.get(row.purchaseRequestId) ?? 0) + row.amountCents,
          );
        }

        for (const candidate of candidates) {
          let blocks = candidate.status !== "paid";
          if (candidate.status === "paid") {
            const paidCents = paidByRequest.get(candidate.id) ?? 0;
            blocks = paidCents < candidate.priceCents;
          }
          if (blocks) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "You already have an active purchase with this studio. Finish paying it before starting another.",
            });
          }
        }

        // 6. Price, agreement URL, chosen plan, and every offered plan are
        //    frozen in the same transaction as the acceptance record.
        const request = await insertPurchaseRequest(tx, {
          producerId: prod.producerId,
          clientContactId: contact.id,
          productId: prod.id,
          status: "pending",
          artistName: contact.name,
          artistEmail: contact.email,
          productNameSnapshot: prod.name,
          priceCents,
          currency: prod.currency,
          paymentPlanSnapshot: snapshotPlan,
          paymentPlanOptionsSnapshot,
          songQty,
          unitPriceCents,
          contractUrlSnapshot,
          royaltyTermsSnapshot: prod.royaltyTerms ?? null,
          agreementTextSnapshot,
        });
        await tx.insert(agreementAcceptances).values({
          purchaseRequestId: request.id,
          producerId: request.producerId,
          clientContactId: request.clientContactId,
          acceptedByClerkUserId: ctx.clerkUserId,
          agreementUrl: request.contractUrlSnapshot ?? null,
        });
        return request;
      });

      // 7. Notify the producer (in-app inbox). Fire-and-forget.
      try {
        await emitPurchaseRequested(ctx.db, {
          producerId: prod.producerId,
          purchaseRequestId: inserted.id,
          artistName: contact.name,
          artistEmail: contact.email,
          productName: prod.name,
          refNumber: inserted.refNumber,
        });
      } catch (err) {
        console.error("[notify] purchase-requested failed", err);
      }

      return {
        purchaseRequestId: inserted.id,
        refNumber: inserted.refNumber,
        status: "pending" as const,
        priceCents: inserted.priceCents,
        currency: inserted.currency,
      };
    }),

  // Accept the producer's agreement (inline checkbox). Only valid once
  // the request is approved (Gate 1 passed). Idempotent.
  acceptAgreement: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
      if (request.status !== "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request hasn't been approved yet.",
        });
      }

      const [existing] = await ctx.db
        .select()
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.purchaseRequestId, request.id))
        .limit(1);
      if (existing) {
        return {
          ok: true as const,
          agreementAcceptanceId: existing.id,
          acceptedAt: existing.acceptedAt,
        };
      }

      let accept: typeof agreementAcceptances.$inferSelect;
      try {
        const [row] = await ctx.db
          .insert(agreementAcceptances)
          .values({
            purchaseRequestId: request.id,
            producerId: request.producerId,
            clientContactId: request.clientContactId,
            acceptedByClerkUserId: ctx.clerkUserId,
            agreementUrl: request.contractUrlSnapshot ?? null,
          })
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        accept = row;
      } catch (err) {
        // Concurrent accept lost the race on the UNIQUE(request) index —
        // re-read the winner and return it idempotently.
        if (isUniqueViolation(err)) {
          const [winner] = await ctx.db
            .select()
            .from(agreementAcceptances)
            .where(eq(agreementAcceptances.purchaseRequestId, request.id))
            .limit(1);
          if (winner) {
            return {
              ok: true as const,
              agreementAcceptanceId: winner.id,
              acceptedAt: winner.acceptedAt,
            };
          }
        }
        throw err;
      }

      try {
        await emitAgreementAccepted(ctx.db, {
          producerId: request.producerId,
          purchaseRequestId: request.id,
          artistName: request.artistName,
          productName: request.productNameSnapshot,
          refNumber: request.refNumber,
        });
      } catch (err) {
        console.error("[notify] agreement-accepted failed", err);
      }

      return {
        ok: true as const,
        agreementAcceptanceId: accept.id,
        acceptedAt: accept.acceptedAt,
      };
    }),

  // Single-request read for the artist's purchase-status surfaces.
  get: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
      const [accept] = await ctx.db
        .select({ id: agreementAcceptances.id })
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.purchaseRequestId, request.id))
        .limit(1);
      return {
        id: request.id,
        refNumber: request.refNumber,
        status: request.status,
        productNameSnapshot: request.productNameSnapshot,
        priceCents: request.priceCents,
        currency: request.currency,
        paymentPlan: request.paymentPlanSnapshot,
        songQty: request.songQty,
        unitPriceCents: request.unitPriceCents,
        contractUrlSnapshot: request.contractUrlSnapshot,
        royaltyTermsSnapshot: request.royaltyTermsSnapshot,
        agreementTextSnapshot: request.agreementTextSnapshot,
        agreementAccepted: Boolean(accept),
        createdAt: request.createdAt,
      };
    }),

  // The artist's open request with one studio, if any. Read-only — the S3
  // entry screen uses this to disable "Request to book" while a request is
  // in review (Gate 1 allows one open request per studio; the `request`
  // mutation enforces it with CONFLICT, this read just surfaces it early).
  // Added by the Screens track (SK-46) following BE-1's patterns.
  pending: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) return { pending: null };

      const rows = await ctx.db
        .select({
          id: purchaseRequests.id,
          refNumber: purchaseRequests.refNumber,
          productId: purchaseRequests.productId,
          status: purchaseRequests.status,
          priceCents: purchaseRequests.priceCents,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.clientContactId, contact.id),
            inArray(purchaseRequests.status, [...BLOCKING_CANDIDATE_STATUSES]),
          ),
        )
        .orderBy(desc(purchaseRequests.createdAt));

      for (const row of rows) {
        if (row.status !== "paid") return { pending: row };
        const paidCents = await paidTotalCents(ctx.db, row.id);
        if (paidCents < row.priceCents) return { pending: row };
      }
      return { pending: null };
    }),

  // The home heartbeat's read (S6, W2.4): the artist's LATEST request
  // with this studio in ANY state the card renders — open money-loop
  // states always; 'paid' for 30 days after its last transition (the
  // book-your-session nudge); 'declined' for 7 days (the generic
  // couldn't-confirm state). Older terminal rows fall off the card.
  current: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) return { current: null };

      const [row] = await ctx.db
        .select({
          id: purchaseRequests.id,
          refNumber: purchaseRequests.refNumber,
          productId: purchaseRequests.productId,
          status: purchaseRequests.status,
          productNameSnapshot: purchaseRequests.productNameSnapshot,
          priceCents: purchaseRequests.priceCents,
          currency: purchaseRequests.currency,
          statusChangedAt: purchaseRequests.statusChangedAt,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.clientContactId, contact.id))
        .orderBy(desc(purchaseRequests.createdAt))
        .limit(1);
      if (!row) return { current: null };

      const anchor = row.statusChangedAt ?? row.createdAt;
      const ageMs = Date.now() - anchor.getTime();
      const DAY = 24 * 60 * 60 * 1000;
      const paidCents = await paidTotalCents(ctx.db, row.id);
      const paidInFull = paidCents >= row.priceCents;
      const visible =
        ["pending", "approved", "verifying"].includes(row.status) ||
        (row.status === "paid" && (!paidInFull || ageMs <= 30 * DAY)) ||
        (row.status === "declined" && ageMs <= 7 * DAY);
      if (!visible) return { current: null };
      const pendingProofCents = await pendingProofTotalCents(ctx.db, row.id);
      return {
        current: {
          ...row,
          paidCents,
          pendingProofCents,
          remainingCents: Math.max(0, row.priceCents - paidCents),
          paidInFull,
        },
      };
    }),

  // ── BE-2 — payment plans (S7) ──────────────────────────────────────
  paymentPlan: router({
    // Frozen-contract shape: the CURRENT snapshot plan's charge math and
    // progress against confirmed invoices.
    preview: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const plan = request.paymentPlanSnapshot;
        const charges = calculateCharges(plan, request.priceCents);
        const paid = await paidTotalCents(ctx.db, request.id);
        const progress = chargesProgress(charges, paid);
        return {
          kind: plan.kind,
          totalCents: request.priceCents,
          currency: request.currency,
          charges,
          chargesTotal: charges.length,
          chargesCompleted: progress.chargesCompleted,
        };
      }),

    // Every plan offered at REQUEST TIME, priced against the locked total.
    // Never read the live product here: the artist agreed to this snapshot.
    options: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const offered = frozenPlanOptions(request);
        const [producer] = await ctx.db
          .select({ displayName: producers.displayName })
          .from(producers)
          .where(eq(producers.id, request.producerId))
          .limit(1);
        return {
          productId: request.productId,
          productName: request.productNameSnapshot,
          producerName: producer?.displayName ?? "Your producer",
          status: request.status,
          chosenPlan: request.paymentPlanSnapshot,
          chosenAt: request.paymentPlanChosenAt,
          totalCents: request.priceCents,
          currency: request.currency,
          options: buildPlanOptions(offered, request.priceCents),
        };
      }),

    // Decision 3 (2026-07-05): the artist picks the plan AFTER approval
    // (S7), before the first invoice exists — overwriting the
    // provisional snapshot taken at request time.
    choose: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          paymentPlan: PAYMENT_PLAN_INPUT,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const snapshotPlan = await ctx.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
          const [lockedRequest] = await tx
            .select()
            .from(purchaseRequests)
            .where(eq(purchaseRequests.id, request.id))
            .limit(1);
          if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedRequest.status !== "approved") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "A plan can be chosen once the request is approved and before the first payment.",
            });
          }
          const offered = frozenPlanOptions(lockedRequest);
          if (!planIsOffered(input.paymentPlan, offered)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That payment plan isn't offered for this product.",
            });
          }
          const selectedPlan = planFromFrozenOptions(input.paymentPlan, offered);
          if (!selectedPlan) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That payment plan isn't offered for this product.",
            });
          }
          if (lockedRequest.paymentPlanChosenAt) {
            if (
              JSON.stringify(lockedRequest.paymentPlanSnapshot) === JSON.stringify(selectedPlan)
            ) {
              return selectedPlan;
            }
            throw new TRPCError({
              code: "CONFLICT",
              message: "Your payment plan is already locked.",
            });
          }

          const [inFlightInvoice] = await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(
              and(
                eq(invoices.purchaseRequestId, lockedRequest.id),
                inArray(invoices.status, ["sent", "paid"]),
              ),
            )
            .limit(1);
          const [inFlightProof] = await tx
            .select({ id: paymentProofs.id })
            .from(paymentProofs)
            .where(
              and(
                eq(paymentProofs.purchaseRequestId, lockedRequest.id),
                eq(paymentProofs.status, "pending"),
              ),
            )
            .limit(1);
          if (inFlightInvoice || inFlightProof) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The plan is locked — a payment is already in flight.",
            });
          }
          await tx
            .update(purchaseRequests)
            .set({
              paymentPlanSnapshot: selectedPlan,
              paymentPlanChosenAt: new Date(),
            })
            .where(eq(purchaseRequests.id, lockedRequest.id));
          return selectedPlan;
        });
        return {
          ok: true as const,
          plan: planOption(snapshotPlan, request.priceCents),
        };
      }),
  }),

  // ── BE-2 — off-app payment instructions (S8) ───────────────────────
  paymentInstructions: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
      if (!PAYING_STATUSES.has(request.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This purchase isn't awaiting payment.",
        });
      }
      if (!request.paymentPlanChosenAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a payment plan first.",
        });
      }
      const [producer] = await ctx.db
        .select({
          displayName: producers.displayName,
          paymentDetails: producers.paymentDetails,
        })
        .from(producers)
        .where(eq(producers.id, request.producerId))
        .limit(1);
      const details = producer?.paymentDetails ?? {};
      const charges = calculateCharges(request.paymentPlanSnapshot, request.priceCents);
      const paid = await paidTotalCents(ctx.db, request.id);
      const reserved = await pendingProofTotalCents(ctx.db, request.id);
      const progress = chargesProgress(charges, paid, reserved);
      const hasDetails = [details.bankTransfer, details.bitPhone].some((v) => Boolean(v?.trim()));
      return {
        refNumber: request.refNumber,
        productId: request.productId,
        productName: request.productNameSnapshot,
        planKind: request.paymentPlanSnapshot.kind,
        planInstallments:
          request.paymentPlanSnapshot.kind === "monthly"
            ? request.paymentPlanSnapshot.installments
            : null,
        currency: request.currency,
        totalCents: request.priceCents,
        paidCents: paid,
        pendingProofCents: reserved,
        remainingCents: progress.remainingCents,
        amountDueNowCents: progress.availableToSubmitCents > 0 ? progress.nextDueCents : null,
        availableToSubmitCents: progress.availableToSubmitCents,
        producerName: producer?.displayName ?? null,
        hasDetails,
        bankTransfer: details.bankTransfer ?? null,
        bitPhone: details.bitPhone ?? null,
        note: details.note ?? null,
      };
    }),

  // ── BE-2 — proof of payment (S9, Gate 2 in) ────────────────────────
  proofOfPayment: router({
    // Everything S9 needs, derived from the locked request and the private
    // proof ledger. No storage key or public object URL leaves this query.
    state: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const [producer] = await ctx.db
          .select({ displayName: producers.displayName })
          .from(producers)
          .where(eq(producers.id, request.producerId))
          .limit(1);
        const proofs = await ctx.db
          .select({
            id: paymentProofs.id,
            amountCents: paymentProofs.amountCents,
            status: paymentProofs.status,
            rejectionNote: paymentProofs.rejectionNote,
            createdAt: paymentProofs.createdAt,
          })
          .from(paymentProofs)
          .where(eq(paymentProofs.purchaseRequestId, request.id))
          .orderBy(paymentProofs.createdAt);
        const charges = calculateCharges(request.paymentPlanSnapshot, request.priceCents);
        const paid = await paidTotalCents(ctx.db, request.id);
        const reserved = proofs
          .filter((proof) => proof.status === "pending")
          .reduce((sum, proof) => sum + proof.amountCents, 0);
        const progress = chargesProgress(charges, paid, reserved);
        return {
          purchaseRequestId: request.id,
          productId: request.productId,
          productName: request.productNameSnapshot,
          producerName: producer?.displayName ?? "Your producer",
          requestStatus: request.status,
          planChosenAt: request.paymentPlanChosenAt,
          currency: request.currency,
          totalCents: request.priceCents,
          paidCents: paid,
          pendingProofCents: reserved,
          remainingCents: progress.remainingCents,
          amountDueNowCents: progress.nextDueCents ?? 0,
          availableToSubmitCents: progress.availableToSubmitCents,
          paidInFull: progress.remainingCents === 0,
          proofs,
        };
      }),

    // Presigned browser PUT for one deterministic PRIVATE staging object.
    // The submitted evidence is copied to a never-client-exposed final key.
    presign: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          fileName: z.string().min(1).max(200),
          contentType: z.enum(PROOF_CONTENT_TYPES),
          sizeBytes: z.number().int().positive().max(MAX_PROOF_BYTES),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        await assertAcceptsProof(ctx.db, request);
        const rate = checkRateLimit(
          `proof-presign:${ctx.clerkUserId}:${request.id}`,
          10,
          10 * 60 * 1000,
        );
        if (!rate.ok) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many upload attempts. Wait a few minutes and try again.",
          });
        }
        const key = buildProofStagingKey({
          producerId: request.producerId,
          purchaseRequestId: request.id,
        });
        const uploadUrl = await getSignedUrl(
          getR2(),
          new PutObjectCommand({
            Bucket: BUCKETS.docs,
            Key: key,
            ContentType: input.contentType,
            ContentLength: input.sizeBytes,
          }),
          { expiresIn: 300 },
        );
        return { uploadUrl, storageKey: key };
      }),

    // Finalizes and records a private proof. The client can overwrite its one
    // staging object before submit, but never receives PUT access to the final
    // evidence key. CopySourceIfMatch pins the exact bytes that were checked.
    submit: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          amountCents: z.number().int().positive(),
          storageKey: z.string().min(1).max(1024),
          originalFileName: z.string().trim().min(1).max(200),
          note: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        if (
          !isProofStagingKeyForPurchase(input.storageKey, {
            producerId: request.producerId,
            purchaseRequestId: request.id,
          })
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That proof upload doesn't belong to this purchase.",
          });
        }

        const preflight = await assertAcceptsProof(ctx.db, request);
        if (
          !preflight.progress.nextDueCents ||
          input.amountCents !== preflight.progress.nextDueCents
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The proof amount must match the payment currently due.",
          });
        }

        let sizeBytes = 0;
        let contentType = "";
        let stagingEtag = "";
        try {
          const object = await getR2().send(
            new HeadObjectCommand({
              Bucket: BUCKETS.docs,
              Key: input.storageKey,
            }),
          );
          sizeBytes = object.ContentLength ?? 0;
          contentType = (object.ContentType ?? "").toLowerCase();
          stagingEtag = object.ETag ?? "";
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The proof upload could not be found. Upload it again.",
          });
        }
        if (
          sizeBytes <= 0 ||
          sizeBytes > MAX_PROOF_BYTES ||
          !stagingEtag ||
          !PROOF_CONTENT_TYPES.includes(contentType as (typeof PROOF_CONTENT_TYPES)[number])
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That proof file isn't a supported image or PDF.",
          });
        }

        try {
          const sample = await getR2().send(
            new GetObjectCommand({
              Bucket: BUCKETS.docs,
              Key: input.storageKey,
              Range: "bytes=0-31",
              IfMatch: stagingEtag,
            }),
          );
          const bytes = await sample.Body?.transformToByteArray();
          if (!bytes || !hasValidProofFileSignature(contentType, bytes)) {
            throw new Error("invalid proof signature");
          }
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The uploaded file contents don't match a supported image or PDF.",
          });
        }

        const finalKey = buildFinalProofKey({
          producerId: request.producerId,
          purchaseRequestId: request.id,
          filename: input.originalFileName,
        });
        let finalEtag = "";
        try {
          await getR2().send(
            new CopyObjectCommand({
              Bucket: BUCKETS.docs,
              Key: finalKey,
              CopySource: encodeR2CopySource(BUCKETS.docs, input.storageKey),
              CopySourceIfMatch: stagingEtag,
              MetadataDirective: "COPY",
            }),
          );
          const finalized = await getR2().send(
            new HeadObjectCommand({ Bucket: BUCKETS.docs, Key: finalKey }),
          );
          finalEtag = finalized.ETag ?? "";
          if (
            !finalEtag ||
            finalized.ContentLength !== sizeBytes ||
            (finalized.ContentType ?? "").toLowerCase() !== contentType
          ) {
            throw new Error("final proof metadata mismatch");
          }
        } catch {
          await deleteProofObjectQuietly("docs", finalKey);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The proof changed while it was being submitted. Upload it again.",
          });
        }

        let row: PaymentProof;
        try {
          row = await ctx.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
            const [lockedRequest] = await tx
              .select()
              .from(purchaseRequests)
              .where(eq(purchaseRequests.id, request.id))
              .limit(1);
            if (
              !lockedRequest ||
              !PAYING_STATUSES.has(lockedRequest.status) ||
              !lockedRequest.paymentPlanChosenAt
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This purchase isn't ready for a payment yet.",
              });
            }
            const paidRows = await tx
              .select({ amountCents: invoices.amountCents })
              .from(invoices)
              .where(
                and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
              );
            const pendingRows = await tx
              .select({ amountCents: paymentProofs.amountCents })
              .from(paymentProofs)
              .where(
                and(
                  eq(paymentProofs.purchaseRequestId, lockedRequest.id),
                  eq(paymentProofs.status, "pending"),
                ),
              );
            const paid = paidRows.reduce((sum, item) => sum + item.amountCents, 0);
            const reserved = pendingRows.reduce((sum, item) => sum + item.amountCents, 0);
            const charges = calculateCharges(
              lockedRequest.paymentPlanSnapshot,
              lockedRequest.priceCents,
            );
            const progress = chargesProgress(charges, paid, reserved);
            if (progress.reservedCents > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "A payment proof is already being reviewed.",
              });
            }
            if (!progress.nextDueCents || input.amountCents !== progress.nextDueCents) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "The proof amount must match the payment currently due.",
              });
            }
            const kind = invoiceKindForCharge(
              lockedRequest.paymentPlanSnapshot.kind,
              progress.chargesCompleted,
              charges.length,
            );
            const [proof] = await tx
              .insert(paymentProofs)
              .values({
                producerId: lockedRequest.producerId,
                projectId: lockedRequest.projectId,
                purchaseRequestId: lockedRequest.id,
                amountCents: input.amountCents,
                currency: lockedRequest.currency,
                kind,
                storageBucket: "docs",
                storageKey: finalKey,
                objectEtag: finalEtag,
                originalFileName: input.originalFileName,
                contentType,
                sizeBytes,
                status: "pending",
                note: input.note ?? null,
              })
              .returning();
            if (!proof) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            }
            if (lockedRequest.status === "approved") {
              await tx
                .update(purchaseRequests)
                .set({ status: "verifying", statusChangedAt: new Date() })
                .where(
                  and(
                    eq(purchaseRequests.id, lockedRequest.id),
                    eq(purchaseRequests.status, "approved"),
                  ),
                );
            }
            return proof;
          });
        } catch (error) {
          await deleteProofObjectQuietly("docs", finalKey);
          throw error;
        }

        await deleteProofObjectQuietly("docs", input.storageKey);

        try {
          await emitProofSubmitted(ctx.db, {
            producerId: request.producerId,
            purchaseRequestId: request.id,
            artistName: request.artistName,
            productName: request.productNameSnapshot,
            refNumber: request.refNumber,
            amountCents: input.amountCents,
            currency: request.currency,
          });
        } catch (err) {
          console.error("[notify] proof-submitted failed", err);
        }

        return { ok: true as const, proofId: row.id };
      }),

    view: artistProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [proof] = await ctx.db
          .select()
          .from(paymentProofs)
          .where(eq(paymentProofs.id, input.proofId))
          .limit(1);
        if (!proof) throw new TRPCError({ code: "NOT_FOUND" });
        await resolveOwnedRequest(ctx.db, ctx.clerkUserId, proof.purchaseRequestId);
        await assertProofObjectIntegrity(proof);
        const url = await getSignedUrl(
          getR2(),
          new GetObjectCommand({
            Bucket: BUCKETS[proof.storageBucket],
            Key: proof.storageKey,
          }),
          { expiresIn: 300 },
        );
        return { url, expiresInSeconds: 300 };
      }),
  }),
  session: router({
    schedule: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          startsAt: z.coerce.date(),
          durationMin: z.number().int().positive(),
          songId: z.string().uuid().optional(),
        }),
      )
      .mutation((): { bookingId: string; projectId: string } =>
        notImplemented("BE-3 artist.purchase.session.schedule"),
      ),
  }),
  delivery: router({
    canDownload: artistProcedure
      .input(z.object({ versionId: z.string().uuid() }))
      .query((): { locked: boolean; reason?: "unpaid" } =>
        notImplemented("BE-4 artist.purchase.delivery.canDownload"),
      ),
  }),
});

// ─── producer.purchase ──────────────────────────────────────────────
export const producerPurchaseRouter = router({
  // Tenant-scoped request detail. Every commercial term comes from the
  // immutable request row, never from the live product.
  get: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await loadProducerRequest(ctx.db, ctx.producerId, input.id);
      const [acceptance] = await ctx.db
        .select({ acceptedAt: agreementAcceptances.acceptedAt })
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.purchaseRequestId, request.id))
        .limit(1);
      return {
        id: request.id,
        refNumber: request.refNumber,
        status: request.status,
        artistName: request.artistName,
        artistEmail: request.artistEmail,
        productNameSnapshot: request.productNameSnapshot,
        priceCents: request.priceCents,
        currency: request.currency,
        paymentPlanSnapshot: request.paymentPlanSnapshot,
        paymentPlanChosenAt: request.paymentPlanChosenAt,
        paymentPlanOptionsSnapshot: frozenPlanOptions(request),
        royaltyTermsSnapshot: request.royaltyTermsSnapshot,
        agreementTextSnapshot: request.agreementTextSnapshot,
        contractUrlSnapshot: request.contractUrlSnapshot,
        createdAt: request.createdAt,
        acceptedAt: acceptance?.acceptedAt ?? null,
      };
    }),

  // Gate 1 — approve. Defers project creation (decision: created once the
  // 5-min undo window elapses). Idempotent on an already-approved row.
  approve: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const transition = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`);
        const req = await loadProducerRequest(tx, ctx.producerId, input.id);
        if (req.status === "approved") {
          return {
            req,
            didChange: false,
            approvedAt: req.approvedAt ?? req.statusChangedAt ?? req.createdAt,
          };
        }
        if (req.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot approve a ${req.status} request.`,
          });
        }

        const now = new Date();
        const [updated] = await tx
          .update(purchaseRequests)
          .set({ status: "approved", approvedAt: now, statusChangedAt: now })
          .where(and(eq(purchaseRequests.id, req.id), eq(purchaseRequests.status, "pending")))
          .returning({ id: purchaseRequests.id });
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This request was updated in another tab. Refresh and try again.",
          });
        }
        return { req, didChange: true, approvedAt: now };
      });
      const { req, approvedAt } = transition;

      if (transition.didChange) {
        try {
          await emitPurchaseApproved(ctx.db, {
            producerId: req.producerId,
            purchaseRequestId: req.id,
            artistName: req.artistName,
            productName: req.productNameSnapshot,
            refNumber: req.refNumber,
          });
        } catch (err) {
          console.error("[notify] purchase-approved failed", err);
        }

        after(async () => {
          try {
            await sendPurchaseApprovedEmail(req.artistEmail, {
              artistName: req.artistName,
              producerName: req.producerName ?? "Your producer",
              productName: req.productNameSnapshot,
              refNumber: req.refNumber,
              currency: req.currency,
              priceCents: req.priceCents,
            });
          } catch (err) {
            console.error("[email] purchase-approved failed", err);
          }
        });
      }

      return {
        ok: true as const,
        status: "approved" as const,
        approvedAt,
        undoableUntil: new Date(approvedAt.getTime() + UNDO_MS),
        projectId: req.projectId,
      };
    }),

  // Gate 1 — decline. Artist always sees a generic message; the reason
  // (if any) is recorded only on the producer's in-app notification.
  decline: producerProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const transition = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`);
        const req = await loadProducerRequest(tx, ctx.producerId, input.id);
        if (req.status === "declined") {
          return {
            req,
            didChange: false,
            declinedAt: req.declinedAt ?? req.statusChangedAt ?? req.createdAt,
          };
        }
        if (req.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot decline a ${req.status} request.`,
          });
        }

        const now = new Date();
        const [updated] = await tx
          .update(purchaseRequests)
          .set({ status: "declined", declinedAt: now, statusChangedAt: now })
          .where(and(eq(purchaseRequests.id, req.id), eq(purchaseRequests.status, "pending")))
          .returning({ id: purchaseRequests.id });
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This request was updated in another tab. Refresh and try again.",
          });
        }
        return { req, didChange: true, declinedAt: now };
      });
      const { req, declinedAt } = transition;

      if (transition.didChange) {
        try {
          await emitPurchaseDeclined(ctx.db, {
            producerId: req.producerId,
            purchaseRequestId: req.id,
            artistName: req.artistName,
            productName: req.productNameSnapshot,
            refNumber: req.refNumber,
            reason: input.reason ?? null,
          });
        } catch (err) {
          console.error("[notify] purchase-declined failed", err);
        }

        after(async () => {
          try {
            await sendPurchaseDeclinedEmail(req.artistEmail, {
              artistName: req.artistName,
              producerName: req.producerName ?? "Your producer",
              productName: req.productNameSnapshot,
              refNumber: req.refNumber,
            });
          } catch (err) {
            console.error("[email] purchase-declined failed", err);
          }
        });
      }

      return { ok: true as const, status: "declined" as const, declinedAt };
    }),

  // Reverse a just-made approval inside the 5-min window. Enforced at
  // call-time (no scheduler). Nothing to unwind because project creation
  // was deferred.
  undoApproval: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`);
        const req = await loadProducerRequest(tx, ctx.producerId, input.id);
        if (req.status !== "approved" || !req.approvedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "There's no approval to undo.",
          });
        }
        if (Date.now() - req.approvedAt.getTime() >= UNDO_MS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The undo window has elapsed.",
          });
        }

        const [proofActivity] = await tx
          .select({ id: paymentProofs.id })
          .from(paymentProofs)
          .where(eq(paymentProofs.purchaseRequestId, req.id))
          .limit(1);
        const [invoiceActivity] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.purchaseRequestId, req.id))
          .limit(1);
        if (req.paymentPlanChosenAt || proofActivity || invoiceActivity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment setup has started, so this approval can no longer be undone.",
          });
        }

        const now = new Date();
        const [updated] = await tx
          .update(purchaseRequests)
          .set({ status: "pending", approvedAt: null, statusChangedAt: now })
          .where(and(eq(purchaseRequests.id, req.id), eq(purchaseRequests.status, "approved")))
          .returning({ id: purchaseRequests.id });
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This request was updated in another tab. Refresh and try again.",
          });
        }
      });

      return { ok: true as const, status: "pending" as const };
    }),

  // Producer hub list, optional status filter, newest first.
  list: producerProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "approved", "verifying", "paid", "declined"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const filters = [eq(purchaseRequests.producerId, ctx.producerId)];
      if (input?.status) {
        filters.push(eq(purchaseRequests.status, input.status));
      }
      const rows = await ctx.db
        .select({
          id: purchaseRequests.id,
          refNumber: purchaseRequests.refNumber,
          status: purchaseRequests.status,
          artistName: purchaseRequests.artistName,
          artistEmail: purchaseRequests.artistEmail,
          productNameSnapshot: purchaseRequests.productNameSnapshot,
          priceCents: purchaseRequests.priceCents,
          currency: purchaseRequests.currency,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(and(...filters))
        .orderBy(desc(purchaseRequests.createdAt));
      return { requests: rows };
    }),

  // ── BE-2 — Gate 2: verify / reject proofs ──────────────────────────
  proofOfPayment: router({
    // The hub's verification queue: every awaiting proof, newest first.
    pending: producerProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          proofId: paymentProofs.id,
          amountCents: paymentProofs.amountCents,
          currency: paymentProofs.currency,
          originalFileName: paymentProofs.originalFileName,
          contentType: paymentProofs.contentType,
          sizeBytes: paymentProofs.sizeBytes,
          proofNote: paymentProofs.note,
          createdAt: paymentProofs.createdAt,
          purchaseRequestId: purchaseRequests.id,
          refNumber: purchaseRequests.refNumber,
          artistName: purchaseRequests.artistName,
          productNameSnapshot: purchaseRequests.productNameSnapshot,
          totalCents: purchaseRequests.priceCents,
        })
        .from(paymentProofs)
        .innerJoin(purchaseRequests, eq(purchaseRequests.id, paymentProofs.purchaseRequestId))
        .where(
          and(
            eq(paymentProofs.producerId, ctx.producerId),
            eq(purchaseRequests.producerId, ctx.producerId),
            eq(paymentProofs.status, "pending"),
          ),
        )
        .orderBy(desc(paymentProofs.createdAt));
      return { proofs: rows };
    }),

    view: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { proof } = await loadProducerProof(ctx.db, ctx.producerId, input.proofId);
        await assertProofObjectIntegrity(proof);
        const url = await getSignedUrl(
          getR2(),
          new GetObjectCommand({
            Bucket: BUCKETS[proof.storageBucket],
            Key: proof.storageKey,
          }),
          { expiresIn: 300 },
        );
        return { url, expiresInSeconds: 300 };
      }),

    // Gate-2 approve: confirm the private proof and atomically create ONE
    // paid ledger invoice. The proof-id unique index makes retries safe.
    confirm: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const loaded = await loadProducerProof(ctx.db, ctx.producerId, input.proofId);
        const { proof, request } = loaded;
        if (proof.status === "confirmed") {
          const paid = await paidTotalCents(ctx.db, request.id);
          const [depositDue = request.priceCents] = calculateCharges(
            request.paymentPlanSnapshot,
            request.priceCents,
          );
          return {
            ok: true as const,
            proofStatus: "confirmed" as const,
            invoiceStatus: "paid" as const,
            depositPaid: paid >= depositDue,
            finalPaid: paid >= request.priceCents,
          };
        }
        if (proof.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot confirm a ${proof.status} proof.`,
          });
        }
        await assertProofObjectIntegrity(proof);
        const result = await ctx.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
          const [lockedRequest] = await tx
            .select()
            .from(purchaseRequests)
            .where(eq(purchaseRequests.id, request.id))
            .limit(1);
          if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedRequest.producerId !== ctx.producerId) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          const [lockedProof] = await tx
            .select()
            .from(paymentProofs)
            .where(eq(paymentProofs.id, proof.id))
            .limit(1);
          if (!lockedProof) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedProof.status === "rejected") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot confirm a rejected proof.",
            });
          }
          const now = new Date();
          const didConfirm = lockedProof.status === "pending";
          if (lockedProof.status === "pending") {
            const paidBeforeRows = await tx
              .select({ amountCents: invoices.amountCents })
              .from(invoices)
              .where(
                and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
              );
            const paidBefore = paidBeforeRows.reduce((sum, item) => sum + item.amountCents, 0);
            const charges = calculateCharges(
              lockedRequest.paymentPlanSnapshot,
              lockedRequest.priceCents,
            );
            const due = chargesProgress(charges, paidBefore).nextDueCents;
            if (!due || lockedProof.amountCents !== due) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "This proof no longer matches the amount due. Reject it and ask for a new proof.",
              });
            }
            await tx
              .update(paymentProofs)
              .set({ status: "confirmed", confirmedAt: now })
              .where(eq(paymentProofs.id, lockedProof.id));
            await tx.insert(invoices).values({
              producerId: lockedRequest.producerId,
              projectId: lockedRequest.projectId,
              purchaseRequestId: lockedRequest.id,
              paymentProofId: lockedProof.id,
              amountCents: lockedProof.amountCents,
              currency: lockedRequest.currency,
              description: `Confirmed off-app payment — ${lockedRequest.refNumber}`,
              kind: lockedProof.kind,
              status: "paid",
              paidAt: now,
              customerEmail: lockedRequest.artistEmail,
              customerName: lockedRequest.artistName,
            });
          }
          const paidRows = await tx
            .select({ amountCents: invoices.amountCents })
            .from(invoices)
            .where(
              and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
            );
          const paid = paidRows.reduce((sum, item) => sum + item.amountCents, 0);
          const [depositDue = lockedRequest.priceCents] = calculateCharges(
            lockedRequest.paymentPlanSnapshot,
            lockedRequest.priceCents,
          );
          const depositPaid = paid >= depositDue;
          if (depositPaid && lockedRequest.status !== "paid") {
            await tx
              .update(purchaseRequests)
              .set({ status: "paid", statusChangedAt: now })
              .where(eq(purchaseRequests.id, lockedRequest.id));
          }
          return {
            paid,
            depositPaid,
            finalPaid: paid >= lockedRequest.priceCents,
            didConfirm,
          };
        });

        if (result.didConfirm) {
          after(async () => {
            try {
              await sendProofVerifiedEmail(request.artistEmail, {
                artistName: request.artistName,
                producerName: loaded.producerName ?? "Your producer",
                productName: request.productNameSnapshot,
                refNumber: request.refNumber,
                currency: request.currency,
                amountCents: proof.amountCents,
                paidCents: result.paid,
                totalCents: request.priceCents,
                paidInFull: result.finalPaid,
              });
            } catch (err) {
              console.error("[email] proof-verified failed", err);
            }
          });
        }

        return {
          ok: true as const,
          proofStatus: "confirmed" as const,
          invoiceStatus: "paid" as const,
          depositPaid: result.depositPaid,
          finalPaid: result.finalPaid,
        };
      }),

    // Gate-2 reject with an ARTIST-FACING note (unlike Gate-1 declines).
    // Confirmation and rejection take the same per-request lock so they
    // cannot both win when two producer tabs act at nearly the same time.
    reject: producerProcedure
      .input(
        z.object({
          proofId: z.string().uuid(),
          note: z.string().trim().min(1).max(2000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const loaded = await loadProducerProof(ctx.db, ctx.producerId, input.proofId);
        const { proof, request } = loaded;
        if (proof.status === "rejected") {
          return { ok: true as const, proofStatus: "rejected" as const };
        }
        if (proof.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot reject a ${proof.status} proof.`,
          });
        }
        const didReject = await ctx.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
          const [lockedRequest] = await tx
            .select()
            .from(purchaseRequests)
            .where(eq(purchaseRequests.id, request.id))
            .limit(1);
          if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedRequest.producerId !== ctx.producerId) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          const [lockedProof] = await tx
            .select()
            .from(paymentProofs)
            .where(eq(paymentProofs.id, proof.id))
            .limit(1);
          if (!lockedProof) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedProof.status === "confirmed") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot reject a confirmed proof.",
            });
          }
          if (lockedProof.status === "rejected") return false;

          const now = new Date();
          await tx
            .update(paymentProofs)
            .set({
              status: "rejected",
              rejectionNote: input.note,
              rejectedAt: now,
            })
            .where(eq(paymentProofs.id, lockedProof.id));

          // Before the first confirmed payment, rejection returns the request
          // to awaiting-payment. After a deposit it stays paid/sessions-open.
          if (lockedRequest.status === "verifying") {
            const paidRows = await tx
              .select({ amountCents: invoices.amountCents })
              .from(invoices)
              .where(
                and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
              );
            if (paidRows.length === 0) {
              await tx
                .update(purchaseRequests)
                .set({ status: "approved", statusChangedAt: now })
                .where(
                  and(
                    eq(purchaseRequests.id, lockedRequest.id),
                    eq(purchaseRequests.status, "verifying"),
                  ),
                );
            }
          }
          return true;
        });

        if (didReject) {
          after(async () => {
            try {
              await sendProofRejectedEmail(request.artistEmail, {
                artistName: request.artistName,
                producerName: loaded.producerName ?? "Your producer",
                productName: request.productNameSnapshot,
                refNumber: request.refNumber,
                note: input.note,
              });
            } catch (err) {
              console.error("[email] proof-rejected failed", err);
            }
          });
        }

        return { ok: true as const, proofStatus: "rejected" as const };
      }),
  }),
  session: router({
    confirm: producerProcedure
      .input(z.object({ bookingId: z.string().uuid() }))
      .mutation((): { ok: true; status: "confirmed"; projectId: string } =>
        notImplemented("BE-3 producer.purchase.session.confirm"),
      ),
  }),
});
