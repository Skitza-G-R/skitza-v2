import {
  agreementAcceptances,
  and,
  clientContacts,
  desc,
  eq,
  isNull,
  producers,
  products,
  purchaseRequests,
} from "@skitza/db";
import type { Db, PaymentPlan, PurchaseRequest } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";

import {
  snapshotProductPrice,
  validatePerSongUnit,
} from "~/lib/purchase/price-snapshot";
import {
  generateRefNumber,
  isUniqueViolation,
  planIsOffered,
} from "~/lib/purchase/request-helpers";
import {
  emitAgreementAccepted,
  emitPurchaseApproved,
  emitPurchaseDeclined,
  emitPurchaseRequested,
} from "~/server/notifications/emit";
import {
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
]);

// Insert a purchase request, retrying with a fresh ref_number on the
// (astronomically unlikely) UNIQUE clash.
async function insertPurchaseRequest(
  db: Db,
  values: Omit<typeof purchaseRequests.$inferInsert, "refNumber">,
): Promise<PurchaseRequest> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .insert(purchaseRequests)
        .values({ ...values, refNumber: generateRefNumber() })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    } catch (err) {
      if (attempt < 4 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
  // Unreachable — the loop either returns or throws.
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
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
// for outgoing emails. NOT_FOUND if absent, FORBIDDEN if it belongs to
// another producer (booking.confirm pattern).
async function loadProducerRequest(
  db: Db,
  producerId: string,
  id: string,
): Promise<PurchaseRequest & { producerName: string | null }> {
  const [row] = await db
    .select({ request: purchaseRequests, producerName: producers.displayName })
    .from(purchaseRequests)
    .innerJoin(producers, eq(producers.id, purchaseRequests.producerId))
    .where(eq(purchaseRequests.id, id))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (row.request.producerId !== producerId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
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

      // 3. The chosen plan must be one the product offers.
      if (!planIsOffered(input.paymentPlan, prod.paymentPlans)) {
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
            message:
              "Per-song products need a valid song count — pick one and try again.",
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
          message:
            "This product isn't available for purchase yet — contact the producer directly.",
        });
      }

      // 5. One pending request per (artist, producer).
      const [pending] = await ctx.db
        .select({ id: purchaseRequests.id })
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.clientContactId, contact.id),
            eq(purchaseRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "You already have a pending request with this studio — finish or cancel it first.",
        });
      }

      // 6. Insert (price-locked) with ref-number retry.
      const inserted = await insertPurchaseRequest(ctx.db, {
        producerId: prod.producerId,
        clientContactId: contact.id,
        productId: prod.id,
        status: "pending",
        artistName: contact.name,
        artistEmail: contact.email,
        productNameSnapshot: prod.name,
        priceCents,
        currency: prod.currency,
        paymentPlanSnapshot: input.paymentPlan,
        songQty,
        unitPriceCents,
        contractUrlSnapshot: prod.contractUrl ?? null,
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
      const request = await resolveOwnedRequest(
        ctx.db,
        ctx.clerkUserId,
        input.purchaseRequestId,
      );
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
      const request = await resolveOwnedRequest(
        ctx.db,
        ctx.clerkUserId,
        input.purchaseRequestId,
      );
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

      const [row] = await ctx.db
        .select({
          id: purchaseRequests.id,
          refNumber: purchaseRequests.refNumber,
          productId: purchaseRequests.productId,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.clientContactId, contact.id),
            eq(purchaseRequests.status, "pending"),
          ),
        )
        .orderBy(desc(purchaseRequests.createdAt))
        .limit(1);
      return { pending: row ?? null };
    }),

  // ── Frozen stubs (BE-2 / BE-3 / BE-4) ──────────────────────────────
  paymentPlan: router({
    preview: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(
        (): {
          kind: PaymentPlan["kind"];
          totalCents: number;
          currency: string;
          charges: number[];
          chargesTotal: number;
          chargesCompleted: number;
        } => notImplemented("BE-2 artist.purchase.paymentPlan.preview"),
      ),
  }),
  proofOfPayment: router({
    submit: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          amountCents: z.number().int().positive(),
          fileUrl: z.string().url(),
          note: z.string().max(2000).optional(),
        }),
      )
      .mutation(
        (): { ok: true; invoiceId: string } =>
          notImplemented("BE-2 artist.purchase.proofOfPayment.submit"),
      ),
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
      .mutation(
        (): { bookingId: string; projectId: string } =>
          notImplemented("BE-3 artist.purchase.session.schedule"),
      ),
  }),
  delivery: router({
    canDownload: artistProcedure
      .input(z.object({ versionId: z.string().uuid() }))
      .query(
        (): { locked: boolean; reason?: "unpaid" } =>
          notImplemented("BE-4 artist.purchase.delivery.canDownload"),
      ),
  }),
});

// ─── producer.purchase ──────────────────────────────────────────────
export const producerPurchaseRouter = router({
  // Gate 1 — approve. Defers project creation (decision: created once the
  // 5-min undo window elapses). Idempotent on an already-approved row.
  approve: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const req = await loadProducerRequest(ctx.db, ctx.producerId, input.id);

      if (req.status === "approved") {
        const approvedAt = req.approvedAt ?? new Date();
        return {
          ok: true as const,
          status: "approved" as const,
          approvedAt,
          undoableUntil: new Date(approvedAt.getTime() + UNDO_MS),
          projectId: req.projectId,
        };
      }
      if (req.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot approve a ${req.status} request.`,
        });
      }

      const now = new Date();
      await ctx.db
        .update(purchaseRequests)
        .set({ status: "approved", approvedAt: now, statusChangedAt: now })
        .where(eq(purchaseRequests.id, req.id));

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

      return {
        ok: true as const,
        status: "approved" as const,
        approvedAt: now,
        undoableUntil: new Date(now.getTime() + UNDO_MS),
        projectId: null as string | null,
      };
    }),

  // Gate 1 — decline. Artist always sees a generic message; the reason
  // (if any) is recorded only on the producer's in-app notification.
  decline: producerProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const req = await loadProducerRequest(ctx.db, ctx.producerId, input.id);

      if (req.status === "declined") {
        return { ok: true as const, status: "declined" as const, declinedAt: req.declinedAt ?? new Date() };
      }
      if (req.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot decline a ${req.status} request.`,
        });
      }

      const now = new Date();
      await ctx.db
        .update(purchaseRequests)
        .set({ status: "declined", declinedAt: now, statusChangedAt: now })
        .where(eq(purchaseRequests.id, req.id));

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

      return { ok: true as const, status: "declined" as const, declinedAt: now };
    }),

  // Reverse a just-made approval inside the 5-min window. Enforced at
  // call-time (no scheduler). Nothing to unwind because project creation
  // was deferred.
  undoApproval: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const req = await loadProducerRequest(ctx.db, ctx.producerId, input.id);
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

      const now = new Date();
      await ctx.db
        .update(purchaseRequests)
        .set({ status: "pending", approvedAt: null, statusChangedAt: now })
        .where(eq(purchaseRequests.id, req.id));

      return { ok: true as const, status: "pending" as const };
    }),

  // Producer hub list, optional status filter, newest first.
  list: producerProcedure
    .input(
      z
        .object({ status: z.enum(["pending", "approved", "declined"]).optional() })
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

  // ── Frozen stubs (BE-2 / BE-3) ─────────────────────────────────────
  proofOfPayment: router({
    confirm: producerProcedure
      .input(z.object({ invoiceId: z.string().uuid() }))
      .mutation(
        (): {
          ok: true;
          invoiceStatus: "paid";
          depositPaid: boolean;
          finalPaid: boolean;
        } => notImplemented("BE-2 producer.purchase.proofOfPayment.confirm"),
      ),
  }),
  session: router({
    confirm: producerProcedure
      .input(z.object({ bookingId: z.string().uuid() }))
      .mutation(
        (): { ok: true; status: "confirmed"; projectId: string } =>
          notImplemented("BE-3 producer.purchase.session.confirm"),
      ),
  }),
});
