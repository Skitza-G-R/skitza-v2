import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  availabilityBlackouts,
  availabilityBlocks,
  bookings,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  products,
  producers,
  projects,
  privateOffers,
  purchases,
  purchaseRequests,
  sql,
  type PaymentPlan,
  type Product,
  type PurchaseCommercialSnapshot,
  type ProductRoyaltyTerms,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";
import {
  sendBookingCancelledOrRescheduledEmail,
  sendBookingConfirmedEmail,
} from "~/server/email/send";
import { mergePreservedPaymentPlans, normalizeProductPaymentPlans } from "~/lib/payment-plans";
import {
  mergeAndValidateStoreProduct,
  StoreProductCommercialError,
  validateStoreProductCommercialState,
  type StoreProductCommercialInput,
} from "~/server/domain/store-products/service";
import {
  sessionBookingRepository,
  sessionBookingScheduleAdvisoryLockKey,
} from "~/server/domain/session-booking/db";
import {
  cancelProducerSessionBooking,
  completeSessionBooking,
  confirmSessionBooking,
  markSessionNoShow,
  recordLateArtistCancellation,
  rejectSessionBooking,
  SessionBookingDomainError,
} from "~/server/domain/session-booking/service";
import { deliverPushToProjectArtist } from "~/server/push/delivery";

function mapStoreProductCommercialError(error: unknown): never {
  if (error instanceof StoreProductCommercialError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

function mapSessionBookingDomainError(error: unknown): never {
  if (!(error instanceof SessionBookingDomainError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  if (error.code === "OPERATION_KEY_CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (
    error.code === "PROJECT_INACTIVE" ||
    error.code === "PURCHASE_INACTIVE" ||
    error.code === "ALLOWANCE_CLOSED" ||
    error.code === "CANCELLATION_WINDOW" ||
    error.code === "TOO_EARLY"
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
}

function producerActorClerkUserId(userId: string | null | undefined): string {
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

function purchaseProductName(snapshot: PurchaseCommercialSnapshot, fallback: string): string {
  const name = snapshot.productOrOfferName.trim();
  return name || fallback;
}

async function loadProducerBookingMessageContext(
  db: Parameters<typeof sessionBookingRepository>[0],
  producerId: string,
  bookingId: string,
) {
  const [row] = await db
    .select({
      booking: bookings,
      commercialSnapshot: purchases.commercialSnapshot,
      producerDisplayName: producers.displayName,
      producerTimezone: producers.timezone,
    })
    .from(bookings)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, bookings.purchaseId),
        eq(purchases.projectId, bookings.projectId),
        eq(purchases.producerId, bookings.producerId),
      ),
    )
    .innerJoin(producers, eq(producers.id, bookings.producerId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.producerId, producerId)))
    .limit(1);
  return row ?? null;
}

type RecentPaymentCompatibility = {
  id: string;
  artistName: string;
  packageNameSnapshot: string | null;
  unitPriceCents: number | null;
  songQty: number | null;
  statusChangedAt: Date | null;
  projectId: string;
  projectName: string;
};

// ─── Product schemas ─────────────────────────────────────────────────
// Phase H.3 rebuild — producers don't sell time, they sell deliverables.
// `kind` is free-text on disk but we gate input to a friendly allow-list.
// Legacy values ("session", "mixing", "mastering", "producing", "other")
// are retained so pre-H.3 rows stay valid after the rename.
const ProductKind = z.enum([
  "mix",
  "master",
  "production",
  "album",
  "beat_lease",
  "hourly",
  "custom",
  // legacy values — kept for back-compat
  "session",
  "mixing",
  "mastering",
  "producing",
  "other",
]);
const ProductLocationType = z.enum(["studio", "remote", "client_space"]);
const PricingModel = z.enum(["flat", "per_song", "hourly", "bundle"]);

const VolumeTier = z.object({
  minQty: z.number().int().positive(),
  pricePerUnitCents: z.number().int().nonnegative(),
});

// Payment plans the producer opts this product into. Mirrors the
// `PaymentPlan` union on the schema side. Optional on input so legacy
// callers (onboarding wizard, tests) don't have to thread a value; when
// absent, the DB default of `[{kind:"full"}]` applies.
const PaymentPlanValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("split_50_50") }),
  z.object({
    kind: z.literal("monthly"),
    installments: z.number().int().min(2).max(12),
  }),
]);

const PaymentPlanInput = z
  .array(PaymentPlanValue)
  .superRefine((plans, ctx) => {
    const standardKinds = plans.map((plan) => plan.kind);
    for (const kind of ["full", "split_50_50", "monthly"] as const) {
      const count = standardKinds.filter((candidate) => candidate === kind).length;
      if (count > 1) {
        ctx.addIssue({
          code: "custom",
          message:
            kind === "monthly"
              ? "Choose only one monthly payment schedule"
              : `${kind} may be selected only once`,
        });
      }
    }
  })
  .transform((plans) => normalizeProductPaymentPlans(plans as PaymentPlan[]));

const PercentageRoyalty = z.object({
  mode: z.literal("percentage"),
  bps: z.number().int().min(1).max(10_000),
});

const ProductRoyaltyTermsInput = z
  .object({
    master: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      PercentageRoyalty,
      z.object({ mode: z.literal("agreement") }),
    ]),
    composition: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({
        mode: z.literal("percentage"),
        bps: z.number().int().min(1).max(10_000),
        role: z.enum(["composer", "lyricist", "arranger", "publisher", "other"]).optional(),
        collectingSociety: z.string().max(200).optional(),
      }),
      z.object({ mode: z.literal("agreement") }),
    ]),
    notes: z.string().max(4_000).optional(),
  })
  .transform((terms) => terms as ProductRoyaltyTerms);

// Product template input. Commercial payment plans are Full, 50/50, or
// Monthly; deposits and Milestone plans are not part of the model.
const ProductInputShape = {
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  kind: ProductKind.default("custom"),
  pricingModel: PricingModel.default("flat"),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.enum(["USD", "EUR", "GBP", "ILS"]).default("USD"),
  volumeTiers: z.array(VolumeTier).max(10).optional(),
  hourlyRateCents: z.number().int().min(0).max(100_000_000).optional(),
  // `durationMin` is optional at the schema level because pure-delivery
  // products (buy a mix, no calendar slot) don't need one. The DB
  // column is NOT NULL for legacy reasons; we store 0 when the
  // producer leaves it blank.
  durationMin: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
  // 0 is the canonical "unlimited sessions" marker — see
  // storefront-screen.tsx's read-side: `unlimitedSessions: p.sessionCount === 0`.
  // The wizard's Unlimited toggle saves 0; the prior min(1) made that
  // round-trip silently fail, so the Save button errored on any
  // product the producer marked as unlimited.
  sessionCount: z.number().int().min(0).max(100).optional(),
  deliverables: z.array(z.string().min(1).max(100)).max(10).optional(),
  locationType: ProductLocationType.default("studio"),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  minLeadHours: z
    .number()
    .int()
    .min(0)
    .max(30 * 24)
    .default(12),
  paymentPlans: PaymentPlanInput.optional(),
  royaltyTerms: ProductRoyaltyTermsInput.nullable().optional(),
  // Mutable external agreements are not valid Store terms. Null remains
  // accepted so an editor can clear the legacy column without a migration.
  contractUrl: z.null().optional(),
  agreementText: z.string().max(20_000).nullable().optional(),
  // Visibility is part of creation so "Save hidden" never exposes a product
  // between two mutations. Existing callers omit it and stay live by default.
  active: z.boolean().default(true),
};

const ProductInput = z.object(ProductInputShape).superRefine((val, ctx) => {
  if (val.paymentPlans?.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["paymentPlans"],
      message: "Choose at least one payment option",
    });
  }
  // Pricing-model-specific requirements.
  if (val.pricingModel === "flat" || val.pricingModel === "bundle") {
    if (val.priceCents == null) {
      ctx.addIssue({
        code: "custom",
        path: ["priceCents"],
        message: "Price is required for flat and bundle products",
      });
    }
  }
  if (val.pricingModel === "per_song") {
    if (!val.volumeTiers || val.volumeTiers.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["volumeTiers"],
        message: "At least one volume tier is required for per-song pricing",
      });
    } else if (!val.volumeTiers.some((t) => t.minQty === 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["volumeTiers"],
        message: "Tiers must include one starting at minQty = 1",
      });
    }
  }
  if (val.pricingModel === "hourly" && val.hourlyRateCents == null) {
    ctx.addIssue({
      code: "custom",
      path: ["hourlyRateCents"],
      message: "Hourly rate is required for hourly products",
    });
  }
});

// Partial update — allow same shape but everything optional.
const ProductUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  kind: ProductKind.optional(),
  pricingModel: PricingModel.optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.enum(["USD", "EUR", "GBP", "ILS"]).optional(),
  volumeTiers: z.array(VolumeTier).max(10).optional(),
  hourlyRateCents: z.number().int().min(0).max(100_000_000).optional(),
  durationMin: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
  // 0 = unlimited sessions (see create-input comment above).
  sessionCount: z.number().int().min(0).max(100).optional(),
  deliverables: z.array(z.string().min(1).max(100)).max(10).optional(),
  locationType: ProductLocationType.optional(),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  minLeadHours: z
    .number()
    .int()
    .min(0)
    .max(30 * 24)
    .optional(),
  paymentPlans: PaymentPlanInput.optional(),
  royaltyTerms: ProductRoyaltyTermsInput.nullable().optional(),
  // Clear-only compatibility for the legacy external-agreement column.
  contractUrl: z.null().optional(),
  agreementText: z.string().max(20_000).nullable().optional(),
});

// Dashboard safety bound. Follow-ups are grouped in SQL before the cap, so
// one project with many old sessions cannot starve other projects. Payment
// signals remain fail-closed until they are sourced from purchase history.
const FOLLOW_UP_PROJECT_CAP = 50;

// Weekly availability replaces the entire week atomically — easier UX
// than per-row editing + means we don't need to expose internal block
// IDs to the producer's form.
const Block = z.object({
  weekday: z.number().int().min(0).max(6),
  startMin: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  endMin: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
});
// Pure helper extracted for test coverage (H.4a). Returns true if ANY
// two blocks share a weekday AND overlap in time. Back-to-back blocks
// that only touch (a.endMin === b.startMin) are NOT overlaps.
export function blocksOverlapOnSameDay(
  blocks: Array<{ weekday: number; startMin: number; endMin: number }>,
): boolean {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (!a || !b) continue;
      if (a.weekday !== b.weekday) continue;
      if (a.startMin < b.endMin && b.startMin < a.endMin) return true;
    }
  }
  return false;
}

const AvailabilityWeekInput = z
  .object({
    blocks: z.array(Block).max(35), // up to 5 blocks × 7 weekdays (H.4a multi-block support)
  })
  .superRefine((val, ctx) => {
    for (let i = 0; i < val.blocks.length; i++) {
      const b = val.blocks[i];
      if (!b) continue;
      if (b.startMin >= b.endMin) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", i],
          message: "start must be before end",
        });
      }
      for (let j = i + 1; j < val.blocks.length; j++) {
        const other = val.blocks[j];
        if (!other || other.weekday !== b.weekday) continue;
        const overlaps = b.startMin < other.endMin && other.startMin < b.endMin;
        if (overlaps) {
          ctx.addIssue({
            code: "custom",
            path: ["blocks", j],
            message: "overlaps another block on the same weekday",
          });
        }
      }
    }
  });

const SLOT_INCREMENT_MIN = 15;
const DEFAULT_MIN_LEAD_HOURS = 12;

// ─── Price calculator ───────────────────────────────────────────────
// Pure helper — given a product + an options bag (quantity, hours),
// return the total price in cents. Used by the public booking flow to
// show a real-time price preview, by the admin dashboard to render
// example prices, and unit-tested without hitting the DB.
export function calculatePriceCents(
  product: Pick<Product, "pricingModel" | "priceCents" | "volumeTiers" | "hourlyRateCents">,
  opts: { quantity?: number; hours?: number } = {},
): number {
  if (product.pricingModel === "flat" || product.pricingModel === "bundle") {
    return product.priceCents;
  }
  if (product.pricingModel === "hourly") {
    const hours = opts.hours ?? 1;
    return (product.hourlyRateCents ?? 0) * hours;
  }
  if (product.pricingModel === "per_song") {
    const qty = opts.quantity ?? 1;
    if (qty <= 0) return 0;
    const tiers = product.volumeTiers ?? [];
    if (tiers.length === 0) return 0;
    // Highest minQty that's ≤ qty wins. Walk tiers descending so the
    // first match is the right one.
    const sorted = [...tiers].sort((a, b) => b.minQty - a.minQty);
    const tier = sorted.find((t) => qty >= t.minQty) ?? sorted[sorted.length - 1];
    if (!tier) return 0;
    return tier.pricePerUnitCents * qty;
  }
  return 0;
}

// ─── Helpers (slot computation) ──────────────────────────────────────

/**
 * Given `now` in a tz, return wall-clock year/month/day/hour/minute as
 * a UTC Date instant.
 */
function wallClockInTzToUtc(
  year: number,
  month: number, // 0-indexed (JS convention)
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guess = new Date(Date.UTC(year, month, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const shownUtcEquivalent = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour) % 24,
    Number(lookup.minute),
  );
  const offset = guess.getTime() - shownUtcEquivalent;
  return new Date(guess.getTime() + offset);
}

function calendarDayInTz(
  instant: Date,
  tz: string,
): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(lookup.year),
    month: Number(lookup.month) - 1,
    day: Number(lookup.day),
    weekday: weekdayMap[lookup.weekday ?? "Sun"] ?? 0,
  };
}

export function isBlackedOut(
  dayKey: string,
  blackouts: readonly { startDate: string; endDate: string }[],
): boolean {
  return blackouts.some((b) => dayKey >= b.startDate && dayKey <= b.endDate);
}

function computeSlots(
  weekBlocks: readonly { weekday: number; startMin: number; endMin: number }[],
  existingBookings: readonly { startsAt: Date; durationMin: number }[],
  durationMin: number,
  days: number,
  tz: string,
  opts: {
    minLeadHours?: number;
    bufferMinutes?: number;
    blackouts?: readonly { startDate: string; endDate: string }[];
    now?: Date;
  } = {},
): string[] {
  const {
    minLeadHours = DEFAULT_MIN_LEAD_HOURS,
    bufferMinutes = 0,
    blackouts = [],
    now = new Date(),
  } = opts;
  const out: string[] = [];
  const earliestAllowed = new Date(now.getTime() + minLeadHours * 60 * 60 * 1000);

  const blocksByDay = new Map<number, { startMin: number; endMin: number }[]>();
  for (const b of weekBlocks) {
    const list = blocksByDay.get(b.weekday) ?? [];
    list.push({ startMin: b.startMin, endMin: b.endMin });
    blocksByDay.set(b.weekday, list);
  }

  const today = calendarDayInTz(now, tz);

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const anchor = wallClockInTzToUtc(today.year, today.month, today.day, 0, 0, tz);
    const dayInstant = new Date(anchor.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const dayCal = calendarDayInTz(dayInstant, tz);
    const dayKey = `${String(dayCal.year)}-${String(dayCal.month + 1).padStart(2, "0")}-${String(dayCal.day).padStart(2, "0")}`;
    if (isBlackedOut(dayKey, blackouts)) continue;
    const todayBlocks = blocksByDay.get(dayCal.weekday) ?? [];
    for (const block of todayBlocks) {
      for (
        let startMin = block.startMin;
        startMin + durationMin <= block.endMin;
        startMin += SLOT_INCREMENT_MIN
      ) {
        const h = Math.floor(startMin / 60);
        const m = startMin % 60;
        const slotStart = wallClockInTzToUtc(dayCal.year, dayCal.month, dayCal.day, h, m, tz);
        if (slotStart < earliestAllowed) continue;
        const slotEnd = new Date(slotStart.getTime() + durationMin * 60 * 1000);
        const bufferMs = bufferMinutes * 60 * 1000;
        const overlaps = existingBookings.some((b) => {
          const bEnd = new Date(b.startsAt.getTime() + b.durationMin * 60 * 1000 + bufferMs);
          return slotStart < bEnd && b.startsAt < slotEnd;
        });
        if (overlaps) continue;
        out.push(slotStart.toISOString());
      }
    }
  }
  return out;
}

export const __computeSlotsForTests = computeSlots;
export const __wallClockInTzToUtcForTests = wallClockInTzToUtc;

// ─── Router ──────────────────────────────────────────────────────────

// Shared products CRUD — exposed under BOTH `products` (the Phase H.3
// name) and `packages` (the legacy name used by onboarding + existing
// callers). One definition means the two sub-routers stay in sync
// while we migrate.
const productsRouter = router({
  list: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.producerId, ctx.producerId), isNull(products.archivedAt)))
      .orderBy(asc(products.position), asc(products.createdAt));
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const [requestHistory, purchaseHistory, offerHistory] = await Promise.all([
      ctx.db
        .select({ productId: purchaseRequests.productId })
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.producerId, ctx.producerId),
            inArray(purchaseRequests.productId, ids),
          ),
        ),
      ctx.db
        .select({ productId: purchases.productId })
        .from(purchases)
        .where(and(eq(purchases.producerId, ctx.producerId), inArray(purchases.productId, ids))),
      ctx.db
        .select({ productId: privateOffers.productId })
        .from(privateOffers)
        .where(
          and(eq(privateOffers.producerId, ctx.producerId), inArray(privateOffers.productId, ids)),
        ),
    ]);
    const historyIds = new Set(
      [...requestHistory, ...purchaseHistory, ...offerHistory]
        .map((row) => row.productId)
        .filter((id): id is string => id !== null),
    );
    return rows.map((row) => ({
      ...row,
      removalAction: historyIds.has(row.id) ? ("archive" as const) : ("delete" as const),
    }));
  }),

  create: producerProcedure.input(ProductInput).mutation(async ({ ctx, input }) => {
    // Pre-H.3 callers (onboarding wizard) pass in only a minimal set
    // of fields. The DB expects durationMin NOT NULL, so default it
    // to 0 when the caller doesn't pass one.
    const { durationMin = 0, priceCents = 0, sessionCount = 1, ...rest } = input;
    const values = {
      ...stripUndefined(rest),
      durationMin,
      priceCents,
      sessionCount,
      producerId: ctx.producerId,
    };
    try {
      validateStoreProductCommercialState({
        name: values.name,
        description: values.description ?? null,
        kind: values.kind,
        pricingModel: values.pricingModel,
        priceCents: values.priceCents,
        currency: values.currency,
        volumeTiers: values.volumeTiers ?? null,
        hourlyRateCents: values.hourlyRateCents ?? null,
        durationMin: values.durationMin,
        sessionCount: values.sessionCount,
        deliverables: values.deliverables ?? null,
        locationType: values.locationType,
        bufferMinutes: values.bufferMinutes,
        minLeadHours: values.minLeadHours,
        paymentPlans: values.paymentPlans ?? [{ kind: "full" }],
        royaltyTerms: values.royaltyTerms ?? null,
        agreementText: values.agreementText ?? null,
        active: values.active,
        archivedAt: null,
      });
    } catch (error) {
      mapStoreProductCommercialError(error);
    }

    return ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`store-products:${ctx.producerId}`}, 0))`,
      );
      const existing = await tx
        .select({ position: products.position })
        .from(products)
        .where(eq(products.producerId, ctx.producerId))
        .orderBy(asc(products.position));
      const nextPos =
        existing.length === 0 ? 0 : (existing[existing.length - 1]?.position ?? 0) + 1;
      const [row] = await tx
        .insert(products)
        .values({ ...values, position: nextPos })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    });
  }),

  update: producerProcedure.input(ProductUpdateInput).mutation(async ({ ctx, input }) => {
    const { id, ...patch } = input;
    return ctx.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.producerId, ctx.producerId)))
        .limit(1)
        .for("update");
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const persistedPatch = {
        ...stripUndefined(patch),
        ...(patch.paymentPlans
          ? {
              paymentPlans: mergePreservedPaymentPlans(patch.paymentPlans, existing.paymentPlans),
            }
          : {}),
      };
      try {
        mergeAndValidateStoreProduct(
          existing as StoreProductCommercialInput,
          persistedPatch as Partial<StoreProductCommercialInput>,
        );
      } catch (error) {
        mapStoreProductCommercialError(error);
      }
      const [row] = await tx
        .update(products)
        .set(persistedPatch)
        .where(and(eq(products.id, id), eq(products.producerId, ctx.producerId)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    });
  }),

  // The user-facing remove action is decided under a product row lock:
  // unused drafts/products are deleted; anything with commercial history is
  // archived so every request, offer, and accepted snapshot remains resolvable.
  archive: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)))
          .limit(1)
          .for("update");
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        const [requestHistory] = await tx
          .select({ id: purchaseRequests.id })
          .from(purchaseRequests)
          .where(
            and(
              eq(purchaseRequests.productId, existing.id),
              eq(purchaseRequests.producerId, ctx.producerId),
            ),
          )
          .limit(1);
        const [purchaseHistory] = await tx
          .select({ id: purchases.id })
          .from(purchases)
          .where(
            and(
              eq(purchases.productId, existing.id),
              eq(purchases.producerId, ctx.producerId),
            ),
          )
          .limit(1);
        const [offerHistory] = await tx
          .select({ id: privateOffers.id })
          .from(privateOffers)
          .where(
            and(
              eq(privateOffers.productId, existing.id),
              eq(privateOffers.producerId, ctx.producerId),
            ),
          )
          .limit(1);

        if (requestHistory || purchaseHistory || offerHistory) {
          await tx
            .update(products)
            .set({ archivedAt: new Date(), active: false })
            .where(and(eq(products.id, existing.id), eq(products.producerId, ctx.producerId)));
          return { ok: true as const, outcome: "archived" as const };
        }

        const [deleted] = await tx
          .delete(products)
          .where(and(eq(products.id, existing.id), eq(products.producerId, ctx.producerId)))
          .returning({ id: products.id });
        if (!deleted) throw new TRPCError({ code: "CONFLICT" });
        return { ok: true as const, outcome: "deleted" as const };
      });
    }),

  // Phase 2 store redesign — Undo counterpart to `archive`. Surfaces
  // the row again to the dashboard list (filters on archivedAt IS NULL)
  // but keeps it hidden from the storefront until the producer
  // re-publishes via the Show toggle. Idempotent: safe to call on a
  // not-yet-archived product (clearing a null archivedAt is a no-op).
  restore: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db
        .update(products)
        .set({ archivedAt: null, active: false })
        .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)));
      return { ok: true as const };
    }),

  // Phase 3 store redesign — drag-to-reorder. Writes the new ordinals
  // in one transaction so a partial failure can't leave the list
  // half-reordered. Producer ownership is verified by selecting all
  // row producerIds in one query and asserting equality before any
  // write. Idempotent: calling with the same order is a no-op.
  // (Deliberately diverges from portfolio.reorder / producerExternalLinks.reorder,
  // which use Promise.all + scoped UPDATEs without a transaction — products
  // is the commerce surface, partial-reorder mid-failure isn't acceptable
  // here, even though the optimistic client reverts.)
  reorder: producerProcedure
    .input(
      z.object({
        orderedIds: z
          .array(z.string().uuid())
          .min(1)
          .refine((arr) => new Set(arr).size === arr.length, "duplicate ids are not allowed"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.producerId, ctx.producerId),
            inArray(products.id, input.orderedIds),
          ),
        );
      if (rows.length !== input.orderedIds.length) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.transaction(async (tx) => {
        for (const [idx, id] of input.orderedIds.entries()) {
          await tx
            .update(products)
            .set({ position: idx })
            .where(and(eq(products.id, id), eq(products.producerId, ctx.producerId)));
        }
      });
      return { ok: true as const };
    }),

  // Legacy alias — callers still using `deactivate` go through the
  // same code path as archive. Remove once all callers migrated.
  deactivate: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db
        .update(products)
        .set({ archivedAt: new Date(), active: false })
        .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)));
      return { ok: true as const };
    }),

  // Signed-in Store visibility toggle. Flips `active` without archiving
  // the row, so the producer can hide a product from artists while still
  // seeing it in the dashboard list. The anonymous portfolio never reads
  // products. Distinct from `archive`, which moves the row
  // to a soft-deleted state and removes it from the dashboard list.
  setActive: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        active: z.boolean(),
        requireAvailability: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        if (input.active && input.requireAvailability) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${sessionBookingScheduleAdvisoryLockKey(ctx.producerId)}, 0))`,
          );
        }
        const [existing] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)))
          .limit(1)
          .for("update");
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.active && input.requireAvailability && existing.durationMin > 0) {
          const [availability] = await tx
            .select({ id: availabilityBlocks.id })
            .from(availabilityBlocks)
            .where(eq(availabilityBlocks.producerId, ctx.producerId))
            .limit(1);
          if (!availability) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Add working hours before publishing this product.",
            });
          }
        }
        try {
          mergeAndValidateStoreProduct(existing as StoreProductCommercialInput, {
            active: input.active,
          });
        } catch (error) {
          mapStoreProductCommercialError(error);
        }
        const [updated] = await tx
          .update(products)
          .set({ active: input.active })
          .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)))
          .returning({ id: products.id });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      });
    }),

  // Duplicate — clone an existing product into a new row. The copy
  // starts hidden (active=false) so the producer can edit before
  // exposing it. Name gets " (copy)" appended; position is appended
  // to the end of the producer's list.
  duplicate: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`store-products:${ctx.producerId}`}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, input.id), eq(products.producerId, ctx.producerId)))
          .limit(1)
          .for("share");
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        // Compute next position at the tail of this producer's list.
        const all = await tx
          .select({ position: products.position })
          .from(products)
          .where(eq(products.producerId, ctx.producerId))
          .orderBy(asc(products.position));
        const nextPos = all.length === 0 ? 0 : (all[all.length - 1]?.position ?? 0) + 1;
        const [row] = await tx
          .insert(products)
          .values({
          producerId: existing.producerId,
          name: `${existing.name} (copy)`,
          description: existing.description,
          durationMin: existing.durationMin,
          sessionCount: existing.sessionCount,
          priceCents: existing.priceCents,
          currency: existing.currency,
          active: false,
          position: nextPos,
          kind: existing.kind,
          locationType: existing.locationType,
          bufferMinutes: existing.bufferMinutes,
          minLeadHours: existing.minLeadHours,
          pricingModel: existing.pricingModel,
          volumeTiers: existing.volumeTiers,
          hourlyRateCents: existing.hourlyRateCents,
          deliverables: existing.deliverables,
          paymentPlans: existing.paymentPlans,
          royaltyTerms: existing.royaltyTerms,
          // A duplicate is a future product and must not inherit mutable terms.
          contractUrl: null,
          agreementText: existing.agreementText,
          })
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return row;
      });
    }),
});

export const bookingRouter = router({
  // ── Products (producer-only) ─────────────────────────────────────
  // New Phase H.3 name.
  products: productsRouter,
  // Legacy alias — onboarding actions still call booking.packages.*.
  // Identical surface; removal tracked alongside the legacy `packages`
  // schema alias.
  packages: productsRouter,

  // ── Blackouts (producer-only) ────────────────────────────────────
  blackouts: router({
    list: producerProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(availabilityBlackouts)
        .where(eq(availabilityBlackouts.producerId, ctx.producerId))
        .orderBy(asc(availabilityBlackouts.startDate));
    }),

    create: producerProcedure
      .input(
        z
          .object({
            startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
            endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
            reason: z.string().max(200).optional(),
          })
          .refine((v) => v.endDate >= v.startDate, {
            message: "end date must be on or after start date",
            path: ["endDate"],
          }),
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${sessionBookingScheduleAdvisoryLockKey(ctx.producerId)}, 0))`,
          );
          const [row] = await tx
            .insert(availabilityBlackouts)
            .values({
              producerId: ctx.producerId,
              startDate: input.startDate,
              endDate: input.endDate,
              ...(input.reason ? { reason: input.reason } : {}),
            })
            .returning();
          if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          return row;
        });
      }),

    remove: producerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${sessionBookingScheduleAdvisoryLockKey(ctx.producerId)}, 0))`,
          );
          const [existing] = await tx
            .select({ producerId: availabilityBlackouts.producerId })
            .from(availabilityBlackouts)
            .where(
              and(
                eq(availabilityBlackouts.id, input.id),
                eq(availabilityBlackouts.producerId, ctx.producerId),
              ),
            )
            .limit(1)
            .for("update");
          if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
          await tx
            .delete(availabilityBlackouts)
            .where(
              and(
                eq(availabilityBlackouts.id, input.id),
                eq(availabilityBlackouts.producerId, ctx.producerId),
              ),
            );
          return { ok: true as const };
        });
      }),
  }),

  // ── Availability (producer-only) ─────────────────────────────────
  availability: router({
    list: producerProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(availabilityBlocks)
        .where(eq(availabilityBlocks.producerId, ctx.producerId))
        .orderBy(asc(availabilityBlocks.weekday), asc(availabilityBlocks.startMin));
    }),

    setWeek: producerProcedure.input(AvailabilityWeekInput).mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${sessionBookingScheduleAdvisoryLockKey(ctx.producerId)}, 0))`,
        );
        await tx
          .delete(availabilityBlocks)
          .where(eq(availabilityBlocks.producerId, ctx.producerId));
        if (input.blocks.length > 0) {
          await tx.insert(availabilityBlocks).values(
            input.blocks.map((b) => ({
              producerId: ctx.producerId,
              weekday: b.weekday,
              startMin: b.startMin,
              endMin: b.endMin,
            })),
          );
        }
        return { ok: true as const };
      }),
    ),

    // Producer-level booking settings surfaced on the availability
    // editor: default session length, auto-confirm toggle, cancellation
    // policy. Kept alongside the week editor so a single round-trip
    // fetches everything the editor needs.
    getSettings: producerProcedure.query(async ({ ctx }) => {
      const [row] = await ctx.db
        .select({
          defaultSessionMin: producers.defaultSessionMin,
          autoConfirmBookings: producers.autoConfirmBookings,
          cancellationPolicyHours: producers.cancellationPolicyHours,
        })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      return {
        defaultSessionMin: row?.defaultSessionMin ?? 60,
        autoConfirmBookings: row?.autoConfirmBookings ?? false,
        cancellationPolicyHours: row?.cancellationPolicyHours ?? 24,
      };
    }),

    updateSettings: producerProcedure
      .input(
        z.object({
          // 15-min min (so the slot-grid `SLOT_INCREMENT_MIN` works),
          // 8h max (a full workday). Custom values outside presets are
          // fine — the picker just shows "Custom".
          defaultSessionMin: z
            .number()
            .int()
            .min(15)
            .max(8 * 60)
            .optional(),
          autoConfirmBookings: z.boolean().optional(),
          // 0 = no policy, up to 30 days advance notice. The UI caps
          // at 168h (7d) for the spinner but any value is accepted.
          cancellationPolicyHours: z
            .number()
            .int()
            .min(0)
            .max(30 * 24)
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const patch = stripUndefined(input);
        if (Object.keys(patch).length === 0) return { ok: true as const };
        return ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${sessionBookingScheduleAdvisoryLockKey(ctx.producerId)}, 0))`,
          );
          await tx
            .update(producers)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(producers.id, ctx.producerId));
          return { ok: true as const };
        });
      }),
  }),

  // ── Bookings (producer-only views + status transitions) ──────────
  upcoming: producerProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(60).default(7),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 7;
      const now = new Date();
      const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const rows = await ctx.db
        .select({ booking: bookings, commercialSnapshot: purchases.commercialSnapshot })
        .from(bookings)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
        .where(
          and(
            eq(bookings.producerId, ctx.producerId),
            eq(bookings.status, "confirmed"),
            gte(bookings.startsAt, now),
            lte(bookings.startsAt, horizon),
          ),
        )
        .orderBy(asc(bookings.startsAt));
      return rows.map(({ booking, commercialSnapshot }) => ({
        id: booking.id,
        artistName: booking.artistName,
        artistEmail: booking.artistEmail,
        startsAt: booking.startsAt,
        durationMin: booking.durationMin,
        packageName: purchaseProductName(commercialSnapshot, "Session"),
      }));
    }),

  // Revenue is purchase-ledger data, not a booking-price projection. Keep
  // the compatibility numbers explicitly unavailable until that grouped
  // read model is wired.
  revenue: producerProcedure.query(async ({ ctx }) => {
    const [producer] = await ctx.db
      .select({ defaultCurrency: producers.defaultCurrency })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    const currency = producer?.defaultCurrency ?? "USD";
    return {
      available: false as const,
      mtdCents: 0,
      outstandingCents: 0,
      next7DaysCents: 0,
      currency,
    };
  }),

  // Producer dashboard follow-ups — confirmed sessions whose end time has
  // passed while the linked project is still `booked` or `in_production`.
  // The producer hasn't moved the project forward (uploaded files, marked
  // delivered) so we surface a nudge to follow up. Group before applying
  // the safety cap: a project with many sessions must still occupy one row.
  needsFollowUp: producerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const rows = await ctx.db
      .select({
        projectId: projects.id,
        artistName: projects.artistName,
        projectTitle: projects.title,
        count: sql<number>`count(${bookings.id})::int`,
      })
      .from(bookings)
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .where(
        and(
          eq(bookings.producerId, ctx.producerId),
          eq(bookings.status, "confirmed"),
          lte(sql`${bookings.startsAt} + ${bookings.durationMin} * interval '1 minute'`, now),
          eq(projects.lifecycleStatus, "active"),
        ),
      )
      .groupBy(projects.id)
      .orderBy(desc(sql`max(${bookings.startsAt})`))
      .limit(FOLLOW_UP_PROJECT_CAP);
    return rows.map((r) => ({
      id: r.projectId,
      artistName: r.artistName,
      projectId: r.projectId,
      projectTitle: r.projectTitle,
      count: r.count,
    }));
  }),

  recentPaidUnacknowledged: producerProcedure.query((): RecentPaymentCompatibility[] => []),

  // SK-20 — producer dismisses the payment-received banner for one
  // booking. Scoped to the caller's own bookings via the producerId
  // predicate so a producer can't no-op someone else's banner.
  acknowledgePayment: producerProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [owned] = await ctx.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.producerId, ctx.producerId)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Payment acknowledgement belongs to purchase payment history.",
      });
    }),

  list: producerProcedure
    .input(
      z
        .object({
          status: z
            .enum([
              "pending_approval",
              "confirmed",
              "rejected",
              "cancelled",
              "completed",
              "no_show",
            ])
            .optional(),
          projectId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const filter = and(
        eq(bookings.producerId, ctx.producerId),
        input?.projectId ? eq(bookings.projectId, input.projectId) : undefined,
        input?.status ? eq(bookings.status, input.status) : undefined,
      );
      const rows = await ctx.db
        .select({ booking: bookings, commercialSnapshot: purchases.commercialSnapshot })
        .from(bookings)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
        .where(filter)
        .orderBy(asc(bookings.startsAt));
      return rows.map(({ booking, commercialSnapshot }) => ({
        ...booking,
        packageNameSnapshot: purchaseProductName(commercialSnapshot, "Session"),
        unitPriceCents: commercialSnapshot.lineItems[0]?.unitPriceCents ?? null,
        songQty:
          commercialSnapshot.lineItems.reduce((total, item) => total + item.quantity, 0) || null,
      }));
    }),

  confirm: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        operationKey: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadProducerBookingMessageContext(ctx.db, ctx.producerId, input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      let result;
      try {
        result = await confirmSessionBooking(sessionBookingRepository(ctx.db), {
          bookingId: input.id,
          producerId: ctx.producerId,
          actorClerkUserId: producerActorClerkUserId(ctx.userId),
          operationKey: input.operationKey,
        });
      } catch (error) {
        mapSessionBookingDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await sendBookingConfirmedEmail(before.booking.artistEmail, {
              artistName: before.booking.artistName,
              producerName: before.producerDisplayName ?? "Your producer",
              productName: purchaseProductName(before.commercialSnapshot, "Session"),
              startsAt: before.booking.startsAt,
              producerTimezone: before.producerTimezone,
            });
          } catch {
            console.error("[email] booking confirmation failed");
          }
        });
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, before.booking.projectId, {
              category: "booking",
              url: `/artist/sessions/${result.booking.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
      }
      return { ok: true as const, id: result.booking.id, status: result.booking.status };
    }),

  reject: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        operationKey: z.string().trim().min(1).max(200),
        reason: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadProducerBookingMessageContext(ctx.db, ctx.producerId, input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      let result;
      try {
        result = await rejectSessionBooking(sessionBookingRepository(ctx.db), {
          bookingId: input.id,
          producerId: ctx.producerId,
          actorClerkUserId: producerActorClerkUserId(ctx.userId),
          operationKey: input.operationKey,
          ...(input.reason ? { reason: input.reason } : {}),
        });
      } catch (error) {
        mapSessionBookingDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await sendBookingCancelledOrRescheduledEmail(before.booking.artistEmail, {
              recipientName: before.booking.artistName,
              counterpartName: before.producerDisplayName ?? "Your producer",
              productName: purchaseProductName(before.commercialSnapshot, "Session"),
              status: "cancelled",
              oldStartsAt: before.booking.startsAt,
              newStartsAt: null,
              producerTimezone: before.producerTimezone,
              reason: input.reason ?? null,
            });
          } catch (error) {
            console.error("[email] booking rejection failed", error);
          }
        });
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, before.booking.projectId, {
              category: "booking",
              url: `/artist/sessions/${result.booking.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
      }
      return { ok: true as const, id: result.booking.id, status: result.booking.status };
    }),

  cancel: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        operationKey: z.string().trim().min(1).max(200),
        reason: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadProducerBookingMessageContext(ctx.db, ctx.producerId, input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      let result;
      try {
        result = await cancelProducerSessionBooking(sessionBookingRepository(ctx.db), {
          bookingId: input.id,
          producerId: ctx.producerId,
          actorClerkUserId: producerActorClerkUserId(ctx.userId),
          operationKey: input.operationKey,
          ...(input.reason ? { reason: input.reason } : {}),
        });
      } catch (error) {
        mapSessionBookingDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await sendBookingCancelledOrRescheduledEmail(before.booking.artistEmail, {
              recipientName: before.booking.artistName,
              counterpartName: before.producerDisplayName ?? "Your producer",
              productName: purchaseProductName(before.commercialSnapshot, "Session"),
              status: "cancelled",
              oldStartsAt: before.booking.startsAt,
              newStartsAt: null,
              producerTimezone: before.producerTimezone,
              reason: input.reason ?? null,
            });
          } catch (error) {
            console.error("[email] producer session cancellation failed", error);
          }
        });
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, before.booking.projectId, {
              category: "booking",
              url: `/artist/sessions/${result.booking.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
      }
      return {
        ok: true as const,
        id: result.booking.id,
        status: result.booking.status,
        outcome: result.booking.outcome,
      };
    }),

  recordLateCancellation: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        operationKey: z.string().trim().min(1).max(200),
        reason: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadProducerBookingMessageContext(ctx.db, ctx.producerId, input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      let result;
      try {
        result = await recordLateArtistCancellation(sessionBookingRepository(ctx.db), {
          bookingId: input.id,
          producerId: ctx.producerId,
          actorClerkUserId: producerActorClerkUserId(ctx.userId),
          operationKey: input.operationKey,
          ...(input.reason ? { reason: input.reason } : {}),
        });
      } catch (error) {
        mapSessionBookingDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await sendBookingCancelledOrRescheduledEmail(before.booking.artistEmail, {
              recipientName: before.booking.artistName,
              counterpartName: before.producerDisplayName ?? "Your producer",
              productName: purchaseProductName(before.commercialSnapshot, "Session"),
              status: "cancelled",
              oldStartsAt: before.booking.startsAt,
              newStartsAt: null,
              producerTimezone: before.producerTimezone,
              reason: input.reason ?? null,
            });
          } catch (error) {
            console.error("[email] late artist cancellation record failed", error);
          }
        });
      }
      return {
        ok: true as const,
        id: result.booking.id,
        status: result.booking.status,
        outcome: result.booking.outcome,
      };
    }),

  noShow: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        operationKey: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await markSessionNoShow(sessionBookingRepository(ctx.db), {
          bookingId: input.id,
          producerId: ctx.producerId,
          actorClerkUserId: producerActorClerkUserId(ctx.userId),
          operationKey: input.operationKey,
        });
        return {
          ok: true as const,
          id: result.booking.id,
          status: result.booking.status,
          outcome: result.booking.outcome,
        };
      } catch (error) {
        mapSessionBookingDomainError(error);
      }
    }),

  complete: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        operationKey: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await completeSessionBooking(sessionBookingRepository(ctx.db), {
          bookingId: input.id,
          producerId: ctx.producerId,
          actorClerkUserId: producerActorClerkUserId(ctx.userId),
          operationKey: input.operationKey,
        });
        return {
          ok: true as const,
          id: result.booking.id,
          status: result.booking.status,
          outcome: result.booking.outcome,
        };
      } catch (error) {
        mapSessionBookingDomainError(error);
      }
    }),
});
