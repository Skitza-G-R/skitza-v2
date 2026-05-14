import { createHash } from "node:crypto";
import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  availabilityBlackouts,
  availabilityBlocks,
  bookings,
  clientContacts,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  products,
  producers,
  projects,
  sql,
  type Product,
} from "@skitza/db";
import { createDb } from "@skitza/db";
import { z } from "zod";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";
import {
  sendBookingCancelledOrRescheduledEmail,
  sendBookingConfirmedEmail,
} from "~/server/email/send";

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
const DepositModel = z.enum(["flat", "milestones", "paid_in_full"]);

const VolumeTier = z.object({
  minQty: z.number().int().positive(),
  pricePerUnitCents: z.number().int().nonnegative(),
});
const Milestone = z.object({
  label: z.string().min(1).max(80),
  pct: z.number().int().min(0).max(100),
});

// Payment plans the producer opts this product into. Mirrors the
// `PaymentPlan` union on the schema side. Optional on input so legacy
// callers (onboarding wizard, tests) don't have to thread a value; when
// absent, the DB default of `[{kind:"full"}]` applies.
const PaymentPlanInput = z.array(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("full") }),
    z.object({ kind: z.literal("split_50_50") }),
    z.object({
      kind: z.literal("monthly"),
      installments: z.number().int().min(2).max(12),
    }),
  ]),
);

// Input for create/update. Several fields are conditional on the
// pricing/deposit model — we validate the cross-field rules in a
// superRefine after the zod object so the messages point at the
// right field.
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
  durationMin: z.number().int().min(0).max(24 * 60).optional(),
  // 0 is the canonical "unlimited sessions" marker — see
  // storefront-screen.tsx's read-side: `unlimitedSessions: p.sessionCount === 0`.
  // The wizard's Unlimited toggle saves 0; the prior min(1) made that
  // round-trip silently fail, so the Save button errored on any
  // product the producer marked as unlimited.
  sessionCount: z.number().int().min(0).max(100).optional(),
  deliverables: z.array(z.string().min(1).max(100)).max(10).optional(),
  depositModel: DepositModel.default("flat"),
  depositPct: z.number().int().min(0).max(100).optional(),
  milestones: z.array(Milestone).max(5).optional(),
  locationType: ProductLocationType.default("studio"),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  minLeadHours: z.number().int().min(0).max(30 * 24).default(12),
  paymentPlans: PaymentPlanInput.optional(),
  // B7 — optional URL to a contract PDF the producer hosts elsewhere
  // (Dropbox, Drive, their own site). Same paste-a-link pattern as
  // brand.logoUrl. Nullable so producers can clear an existing link.
  contractUrl: z.string().url().max(2048).nullable().optional(),
};

const ProductInput = z.object(ProductInputShape).superRefine((val, ctx) => {
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
  // Deposit rules.
  if (val.depositModel === "flat" && val.depositPct == null) {
    ctx.addIssue({
      code: "custom",
      path: ["depositPct"],
      message: "Deposit percent is required for flat deposit",
    });
  }
  if (val.depositModel === "milestones") {
    const ms = val.milestones ?? [];
    if (ms.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["milestones"],
        message: "At least one milestone is required",
      });
    } else {
      const sum = ms.reduce((acc, m) => acc + m.pct, 0);
      if (sum !== 100) {
        ctx.addIssue({
          code: "custom",
          path: ["milestones"],
          message: `Milestones must sum to 100% (got ${String(sum)}%)`,
        });
      }
    }
  }
});

// Partial update — allow same shape but everything optional.
const ProductUpdateInput = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
    kind: ProductKind.optional(),
    pricingModel: PricingModel.optional(),
    priceCents: z.number().int().min(0).max(100_000_000).optional(),
    currency: z.enum(["USD", "EUR", "GBP", "ILS"]).optional(),
    volumeTiers: z.array(VolumeTier).max(10).optional(),
    hourlyRateCents: z.number().int().min(0).max(100_000_000).optional(),
    durationMin: z.number().int().min(0).max(24 * 60).optional(),
    // 0 = unlimited sessions (see create-input comment above).
    sessionCount: z.number().int().min(0).max(100).optional(),
    deliverables: z.array(z.string().min(1).max(100)).max(10).optional(),
    depositModel: DepositModel.optional(),
    depositPct: z.number().int().min(0).max(100).optional(),
    milestones: z.array(Milestone).max(5).optional(),
    locationType: ProductLocationType.optional(),
    bufferMinutes: z.number().int().min(0).max(240).optional(),
    minLeadHours: z.number().int().min(0).max(30 * 24).optional(),
    paymentPlans: PaymentPlanInput.optional(),
    // B7 — see ProductInputShape comment.
    contractUrl: z.string().url().max(2048).nullable().optional(),
  });

// Weekly availability replaces the entire week atomically — easier UX
// than per-row editing + means we don't need to expose internal block
// IDs to the producer's form.
const Block = z.object({
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(24 * 60),
  endMin: z.number().int().min(0).max(24 * 60),
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
  product: Pick<
    Product,
    "pricingModel" | "priceCents" | "volumeTiers" | "hourlyRateCents"
  >,
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
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
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
    return ctx.db
      .select()
      .from(products)
      .where(
        and(
          eq(products.producerId, ctx.producerId),
          isNull(products.archivedAt),
        ),
      )
      .orderBy(asc(products.position), asc(products.createdAt));
  }),

  create: producerProcedure
    .input(ProductInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ position: products.position })
        .from(products)
        .where(eq(products.producerId, ctx.producerId))
        .orderBy(asc(products.position));
      const nextPos = existing.length === 0
        ? 0
        : (existing[existing.length - 1]?.position ?? 0) + 1;
      // Pre-H.3 callers (onboarding wizard) pass in only a minimal set
      // of fields. The DB expects durationMin NOT NULL, so default it
      // to 0 when the caller doesn't pass one.
      const {
        durationMin = 0,
        priceCents = 0,
        sessionCount = 1,
        ...rest
      } = input;
      const [row] = await ctx.db
        .insert(products)
        .values({
          ...stripUndefined(rest),
          durationMin,
          priceCents,
          sessionCount,
          producerId: ctx.producerId,
          position: nextPos,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  update: producerProcedure
    .input(ProductUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const [existing] = await ctx.db
        .select({ producerId: products.producerId })
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const [row] = await ctx.db
        .update(products)
        .set(stripUndefined(patch))
        .where(eq(products.id, id))
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  // Phase H.3 — soft-delete via `archived_at` timestamp. Keeps the row
  // for historical bookings to resolve. Also flips `active = false`
  // for back-compat with code that still filters on that column.
  archive: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ producerId: products.producerId })
        .from(products)
        .where(eq(products.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(products)
        .set({ archivedAt: new Date(), active: false })
        .where(eq(products.id, input.id));
      return { ok: true as const };
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
        .select({ producerId: products.producerId })
        .from(products)
        .where(eq(products.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(products)
        .set({ archivedAt: null, active: false })
        .where(eq(products.id, input.id));
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
        .select({ id: products.id, producerId: products.producerId })
        .from(products)
        .where(inArray(products.id, input.orderedIds));
      if (rows.length !== input.orderedIds.length) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (rows.some((r) => r.producerId !== ctx.producerId)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db.transaction(async (tx) => {
        for (const [idx, id] of input.orderedIds.entries()) {
          await tx
            .update(products)
            .set({ position: idx })
            .where(eq(products.id, id));
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
        .select({ producerId: products.producerId })
        .from(products)
        .where(eq(products.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(products)
        .set({ archivedAt: new Date(), active: false })
        .where(eq(products.id, input.id));
      return { ok: true as const };
    }),

  // Storefront visibility toggle. Flips `active` without archiving the
  // row, so the producer can hide a product from their public page
  // (publicPackages query filters on active=true) and still show it in
  // the dashboard list. Distinct from `archive`, which moves the row
  // to a soft-deleted state and removes it from the dashboard list.
  setActive: producerProcedure
    .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ producerId: products.producerId })
        .from(products)
        .where(eq(products.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(products)
        .set({ active: input.active })
        .where(eq(products.id, input.id));
      return { ok: true as const };
    }),

  // Duplicate — clone an existing product into a new row. The copy
  // starts hidden (active=false) so the producer can edit before
  // exposing it. Name gets " (copy)" appended; position is appended
  // to the end of the producer's list.
  duplicate: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(products)
        .where(eq(products.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Compute next position at the tail of this producer's list.
      const all = await ctx.db
        .select({ position: products.position })
        .from(products)
        .where(eq(products.producerId, ctx.producerId))
        .orderBy(asc(products.position));
      const nextPos = all.length === 0
        ? 0
        : (all[all.length - 1]?.position ?? 0) + 1;
      const [row] = await ctx.db
        .insert(products)
        .values({
          producerId: existing.producerId,
          name: `${existing.name} (copy)`,
          description: existing.description,
          durationMin: existing.durationMin,
          sessionCount: existing.sessionCount,
          priceCents: existing.priceCents,
          currency: existing.currency,
          depositPct: existing.depositPct,
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
          depositModel: existing.depositModel,
          milestones: existing.milestones,
          paymentPlans: existing.paymentPlans,
          contractUrl: existing.contractUrl,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
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
        z.object({
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
          reason: z.string().max(200).optional(),
        }).refine((v) => v.endDate >= v.startDate, {
          message: "end date must be on or after start date",
          path: ["endDate"],
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
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
      }),

    remove: producerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select({ producerId: availabilityBlackouts.producerId })
          .from(availabilityBlackouts)
          .where(eq(availabilityBlackouts.id, input.id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.producerId !== ctx.producerId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await ctx.db
          .delete(availabilityBlackouts)
          .where(eq(availabilityBlackouts.id, input.id));
        return { ok: true as const };
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

    setWeek: producerProcedure
      .input(AvailabilityWeekInput)
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(availabilityBlocks)
          .where(eq(availabilityBlocks.producerId, ctx.producerId));
        if (input.blocks.length === 0) return { ok: true as const };
        await ctx.db.insert(availabilityBlocks).values(
          input.blocks.map((b) => ({
            producerId: ctx.producerId,
            weekday: b.weekday,
            startMin: b.startMin,
            endMin: b.endMin,
          })),
        );
        return { ok: true as const };
      }),

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
          defaultSessionMin: z.number().int().min(15).max(8 * 60).optional(),
          autoConfirmBookings: z.boolean().optional(),
          // 0 = no policy, up to 30 days advance notice. The UI caps
          // at 168h (7d) for the spinner but any value is accepted.
          cancellationPolicyHours: z.number().int().min(0).max(30 * 24).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const patch = stripUndefined(input);
        if (Object.keys(patch).length === 0) return { ok: true as const };
        await ctx.db
          .update(producers)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(producers.id, ctx.producerId));
        return { ok: true as const };
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
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, ctx.producerId),
            eq(bookings.status, "confirmed"),
            gte(bookings.startsAt, now),
            lte(bookings.startsAt, horizon),
          ),
        )
        .orderBy(asc(bookings.startsAt));
      return rows.map((b) => ({
        id: b.id,
        artistName: b.artistName,
        artistEmail: b.artistEmail,
        startsAt: b.startsAt,
        durationMin: b.durationMin,
        packageName: b.packageNameSnapshot,
      }));
    }),

  revenue: producerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [producer] = await ctx.db
      .select({ defaultCurrency: producers.defaultCurrency })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    const currency = producer?.defaultCurrency ?? "USD";

    const bookingRows = await ctx.db
      .select({
        id: bookings.id,
        status: bookings.status,
        startsAt: bookings.startsAt,
        productId: bookings.productId,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.producerId, ctx.producerId),
          inArray(bookings.status, ["pending_approval", "pending_payment", "confirmed"]),
        ),
      );
    if (bookingRows.length === 0) {
      return {
        mtdCents: 0,
        outstandingCents: 0,
        next7DaysCents: 0,
        currency,
      };
    }

    const productIds = Array.from(
      new Set(
        bookingRows
          .map((b) => b.productId)
          .filter((id): id is string => id !== null),
      ),
    );
    const productRows = productIds.length === 0
      ? []
      : await ctx.db
          .select({
            id: products.id,
            priceCents: products.priceCents,
            depositPct: products.depositPct,
            currency: products.currency,
          })
          .from(products)
          .where(inArray(products.id, productIds));
    const productById = new Map(productRows.map((p) => [p.id, p]));

    let mtdCents = 0;
    let outstandingCents = 0;
    let next7DaysCents = 0;
    for (const b of bookingRows) {
      if (b.productId === null) continue;
      const prod = productById.get(b.productId);
      if (!prod) continue;
      if (prod.currency !== currency) continue;
      if (b.status === "confirmed") {
        if (b.startsAt >= monthStart && b.startsAt < nextMonthStart) {
          mtdCents += prod.priceCents;
        }
        if (b.startsAt >= now && b.startsAt <= in7) {
          next7DaysCents += prod.priceCents;
        }
      }
      if (prod.depositPct > 0) {
        outstandingCents += Math.round((prod.priceCents * prod.depositPct) / 100);
      }
    }
    return { mtdCents, outstandingCents, next7DaysCents, currency };
  }),

  // Producer dashboard banner — confirmed sessions whose end time has
  // passed while the linked project is still `booked` or `in_production`.
  // The producer hasn't moved the project forward (uploaded files, marked
  // delivered) so we surface a nudge to follow up. Capped at 5 to keep
  // the dashboard from turning into a stale-session graveyard.
  needsFollowUp: producerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const rows = await ctx.db
      .select({
        id: bookings.id,
        artistName: bookings.artistName,
        startsAt: bookings.startsAt,
        durationMin: bookings.durationMin,
        projectId: bookings.projectId,
        projectStage: projects.stage,
        projectTitle: projects.title,
      })
      .from(bookings)
      .leftJoin(projects, eq(projects.id, bookings.projectId))
      .where(
        and(
          eq(bookings.producerId, ctx.producerId),
          eq(bookings.status, "confirmed"),
          lte(
            sql`${bookings.startsAt} + ${bookings.durationMin} * interval '1 minute'`,
            now,
          ),
          inArray(projects.stage, ["booked", "in_production"]),
        ),
      )
      .orderBy(desc(bookings.startsAt))
      .limit(5);
    return rows.map((r) => ({
      id: r.id,
      artistName: r.artistName,
      startsAt: r.startsAt,
      durationMin: r.durationMin,
      projectId: r.projectId,
      projectTitle: r.projectTitle ?? r.artistName,
    }));
  }),

  list: producerProcedure
    .input(
      z
        .object({
          status: z
            .enum([
              "pending_approval",
              "pending_payment",
              "confirmed",
              "rejected",
              "cancelled",
            ])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const filter = input?.status
        ? and(eq(bookings.producerId, ctx.producerId), eq(bookings.status, input.status))
        : eq(bookings.producerId, ctx.producerId);
      return ctx.db
        .select()
        .from(bookings)
        .where(filter)
        .orderBy(asc(bookings.startsAt));
    }),

  confirm: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({
          producerId: bookings.producerId,
          status: bookings.status,
          artistName: bookings.artistName,
          artistEmail: bookings.artistEmail,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          productId: bookings.productId,
          packageNameSnapshot: bookings.packageNameSnapshot,
          // New: needed for the auto-project-creation idempotency check
          // (Today Cockpit). Skip the insert when the booking already
          // has a linked project — the producer may have manually
          // provisioned one first via project.createFromBooking.
          projectId: bookings.projectId,
          stripeCheckoutSessionId: bookings.stripeCheckoutSessionId,
        })
        .from(bookings)
        .where(eq(bookings.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (existing.status !== "pending_approval") {
        if (existing.status === "confirmed") return { ok: true as const };
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot confirm a ${existing.status} booking`,
        });
      }

      // Producer "Approve" branches on whether the booking still owes
      // money. A booking with a productId AND no project yet is a fresh,
      // unpaid engagement — approval moves it to `pending_payment` and we
      // skip auto-project creation + the confirmation email until the
      // artist actually pays. A booking that already has a linked project
      // is a returning-artist follow-up (already paid for the engagement),
      // so we go straight to `confirmed` and run the auto-project +
      // welcome-email side effects as before.
      const needsPayment =
        existing.productId !== null && existing.projectId === null;
      if (needsPayment) {
        await ctx.db
          .update(bookings)
          .set({ status: "pending_payment", statusChangedAt: new Date() })
          .where(eq(bookings.id, input.id));
        return { ok: true as const };
      }

      await ctx.db
        .update(bookings)
        .set({ status: "confirmed", statusChangedAt: new Date() })
        .where(eq(bookings.id, input.id));

      // ── Today Cockpit ── Auto-provision a Project row on confirm.
      // Landing a confirmed booking in the producer's dashboard WITHOUT
      // an associated project would force them to click "create
      // project" as a second step — exactly the friction this flow is
      // trying to kill. We insert a projects row here, stamp the
      // bookings.projectId FK, and upsert the client_contacts cache so
      // a later Clerk sign-in by the artist picks up a pre-existing
      // row (the webhook stamps clerk_user_id by (producerId, emailHash)).
      //
      // Idempotent: if the booking already links to a project (the
      // producer called project.createFromBooking or the webhook got
      // there first), skip the insert entirely.
      //
      // All three writes are best-effort but we DO propagate failures
      // on the project insert itself — the producer would otherwise
      // silently lose the auto-project benefit with no way to retry.
      // The status transition already committed above, so a failure
      // here lands them in the same state as pre-cockpit: a confirmed
      // booking with no project yet, recoverable via
      // project.createFromBooking.
      if (!existing.projectId) {
        const title =
          existing.packageNameSnapshot && existing.packageNameSnapshot.length > 0
            ? existing.packageNameSnapshot
            : `Session with ${existing.artistName}`;
        const lowerEmail = existing.artistEmail.trim().toLowerCase();

        try {
          const [projectRow] = await ctx.db
            .insert(projects)
            .values({
              producerId: ctx.producerId,
              bookingId: input.id,
              title,
              artistName: existing.artistName,
              artistEmail: lowerEmail,
              clientName: existing.artistName,
              clientEmail: lowerEmail,
              stage: "booked",
              depositPaid: false,
              finalPaid: false,
            })
            .returning();
          if (projectRow) {
            await ctx.db
              .update(bookings)
              .set({ projectId: projectRow.id })
              .where(eq(bookings.id, input.id));
          }
        } catch (err) {
          // Rare — a DB error or share-token collision. Logged so ops
          // can spot it; the producer can still hit "Create project"
          // on the booking detail page as a manual fallback.
          console.warn("[today-cockpit] auto-project insert failed in booking.confirm", err);
        }

        // Upsert client_contacts keyed on (producerId, emailHash).
        // Separate write from recordContact() because recordContact
        // swallows errors via console.warn; we want the same semantics
        // here but with the insert parameters the Today Cockpit guard
        // expects (name snapshot from the booking row, not the artist's
        // later Clerk display name).
        try {
          const emailHash = createHash("sha256").update(lowerEmail).digest("hex");
          const now = new Date();
          await ctx.db
            .insert(clientContacts)
            .values({
              producerId: ctx.producerId,
              emailHash,
              email: lowerEmail,
              name: existing.artistName,
              firstSeenAt: now,
              lastSeenAt: now,
            })
            .onConflictDoUpdate({
              target: [clientContacts.producerId, clientContacts.emailHash],
              set: { name: existing.artistName, lastSeenAt: now },
            });
        } catch (err) {
          console.warn("[today-cockpit] client_contacts upsert failed in booking.confirm", err);
        }
      }

      // Email the artist that their session is confirmed. Fully
      // best-effort: catch + warn so a Resend hiccup doesn't unwind
      // the status transition the producer just performed.
      //
      // Batch G — Autopilot gate. Reads `autopilotWelcomeEmail` off
      // the producer row; skips the send when the switch is off. We
      // still fetch the producer row below (it feeds the email copy
      // when on), so gating is a single extra column in the SELECT.
      try {
        const [producer] = await ctx.db
          .select({
            displayName: producers.displayName,
            timezone: producers.timezone,
            defaultCurrency: producers.defaultCurrency,
            autopilotWelcomeEmail: producers.autopilotWelcomeEmail,
          })
          .from(producers)
          .where(eq(producers.id, existing.producerId))
          .limit(1);
        if (producer && producer.autopilotWelcomeEmail) {
          const product = existing.productId
            ? (
                await ctx.db
                  .select({
                    name: products.name,
                    priceCents: products.priceCents,
                    currency: products.currency,
                    depositPct: products.depositPct,
                  })
                  .from(products)
                  .where(eq(products.id, existing.productId))
                  .limit(1)
              )[0]
            : undefined;
          const priceCents = product?.priceCents ?? 0;
          const depositPct = product?.depositPct ?? 0;
          const depositCents = Math.round((priceCents * depositPct) / 100);
          await sendBookingConfirmedEmail(existing.artistEmail, {
            artistName: existing.artistName,
            producerName: producer.displayName ?? "Your producer",
            productName: product?.name ?? existing.packageNameSnapshot ?? "Session",
            startsAt: existing.durationMin > 0 ? existing.startsAt : null,
            producerTimezone: producer.timezone,
            currency: product?.currency ?? producer.defaultCurrency,
            priceCents,
            depositCents,
          });
        }
      } catch (err) {
        console.warn("[email] sendBookingConfirmedEmail failed in booking.confirm", err);
      }

      return { ok: true as const };
    }),

  // Public read of a confirmed booking by id. Used by surfaces that
  // can't rely on a Clerk session (Tranzila's success redirect, future
  // share links) — returns null for any booking that isn't yet
  // confirmed, so a guessed UUID can't leak booking metadata before
  // the artist actually paid.
  getConfirmedBooking: publicProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ input }) => {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "missing DATABASE_URL",
        });
      }
      const db = createDb(dbUrl);
      const [row] = await db
        .select({
          id: bookings.id,
          status: bookings.status,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          artistName: bookings.artistName,
          packageNameSnapshot: bookings.packageNameSnapshot,
          tranzilaConfirmationCode: bookings.tranzilaConfirmationCode,
          producerName: producers.displayName,
        })
        .from(bookings)
        .leftJoin(producers, eq(producers.id, bookings.producerId))
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!row || row.status !== "confirmed") return null;
      return row;
    }),

  // Public — called from the Tranzila callback handler at
  // /api/tranzila/callback. We can't gate on a signed-in artist because
  // Tranzila's server-to-server `notify_url` POST has no Clerk session.
  //
  // SECURITY: The current shape trusts that anyone hitting this with a
  // valid `bookingId + status=success` actually paid. Real Tranzila
  // integrations call Tranzila's `confirm.php` verification endpoint
  // with the txn id to confirm the charge cleared. For MVP we accept the
  // bookingId at face value; a follow-up should verify against
  // tranzila so a guessed UUID can't flip a booking to confirmed.
  // TODO(payments): verify with Tranzila's confirm.php API.
  confirmAfterPayment: publicProcedure
    .input(
      z.object({
        bookingId: z.string().uuid(),
        tranzilaConfirmationCode: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "missing DATABASE_URL",
        });
      }
      const db = createDb(dbUrl);

      const [existing] = await db
        .select({
          id: bookings.id,
          producerId: bookings.producerId,
          status: bookings.status,
          artistName: bookings.artistName,
          artistEmail: bookings.artistEmail,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          productId: bookings.productId,
          packageNameSnapshot: bookings.packageNameSnapshot,
          projectId: bookings.projectId,
        })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      // Idempotent — if the artist re-hits the success URL after the
      // booking already flipped, just return the existing project id.
      if (existing.status === "confirmed") {
        return { ok: true as const, projectId: existing.projectId };
      }
      if (existing.status !== "pending_payment") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot confirm payment on ${existing.status} booking`,
        });
      }

      try {
        await db
          .update(bookings)
          .set({
            status: "confirmed",
            statusChangedAt: new Date(),
            // Only overwrite when the caller actually has a code in hand.
            // The notify_url POST is the canonical confirmation path and
            // will supply one; preserving the existing value on no-arg
            // calls keeps idempotent retries safe.
            ...(input.tranzilaConfirmationCode
              ? { tranzilaConfirmationCode: input.tranzilaConfirmationCode }
              : {}),
          })
          .where(eq(bookings.id, input.bookingId));
      } catch (err) {
        console.error("[payment] booking status update to confirmed failed", {
          bookingId: existing.id,
          producerId: existing.producerId,
          artistEmail: existing.artistEmail,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
      }

      // Fetch the product's financial snapshot once — both the existing-
      // project update path (below) and the new-project insert path
      // (further below) want to land totalAmountCents + currency on the
      // project row. Cheaper than two separate SELECTs and keeps the two
      // branches in sync. Null when the booking has no productId (rare:
      // bookings without a product can't have a price to snapshot).
      const productRow = existing.productId
        ? await db
            .select({
              priceCents: products.priceCents,
              currency: products.currency,
              sessionCount: products.sessionCount,
            })
            .from(products)
            .where(eq(products.id, existing.productId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null;

      // Flip depositPaid + populate financial snapshot on the already-
      // linked project (returning-artist follow-up flow where the
      // booking arrived with projectId already set). New projects
      // created below in the auto-provision block land the same fields
      // directly in their values() object. Best-effort: log on failure,
      // don't unwind the status transition.
      //
      // Conditional spread on totalAmountCents/currency so a productRow
      // miss leaves any existing values on the project untouched —
      // overwriting a populated currency with NULL would be worse than
      // doing nothing.
      if (existing.projectId) {
        try {
          await db
            .update(projects)
            .set({
              depositPaid: true,
              chargesCompleted: 1,
              ...(productRow?.priceCents != null
                ? { totalAmountCents: productRow.priceCents }
                : {}),
              ...(productRow?.currency
                ? { currency: productRow.currency }
                : {}),
            })
            .where(eq(projects.id, existing.projectId));
        } catch (err) {
          console.warn("[payment] project depositPaid update failed", {
            projectId: existing.projectId,
            bookingId: existing.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Auto-provision a project — same shape as booking.confirm's
      // auto-project block. Idempotent on existing.projectId so a
      // duplicate callback (browser redirect AND notify_url POST) only
      // inserts once.
      let projectId = existing.projectId;
      if (!projectId) {
        const title =
          existing.packageNameSnapshot && existing.packageNameSnapshot.length > 0
            ? existing.packageNameSnapshot
            : `Session with ${existing.artistName}`;
        const lowerEmail = existing.artistEmail.trim().toLowerCase();
        try {
          const [projectRow] = await db
            .insert(projects)
            .values({
              producerId: existing.producerId,
              bookingId: existing.id,
              title,
              artistName: existing.artistName,
              artistEmail: lowerEmail,
              clientName: existing.artistName,
              clientEmail: lowerEmail,
              stage: "booked",
              // confirmAfterPayment runs after the artist's deposit has
              // cleared at Tranzila — the project starts with
              // depositPaid=true and chargesCompleted=1 so the
              // producer's dashboard reflects funds-in-hand from the
              // first render. totalAmountCents + currency snapshot the
              // product's price so later modals (final charge, etc.)
              // can derive the second-half amount without re-reading
              // the product (which the producer may have edited).
              depositPaid: true,
              finalPaid: false,
              chargesCompleted: 1,
              totalAmountCents: productRow?.priceCents ?? null,
              currency: productRow?.currency ?? "ILS",
              sessionCount: productRow?.sessionCount ?? 1,
            })
            .returning();
          if (projectRow) {
            projectId = projectRow.id;
            await db
              .update(bookings)
              .set({ projectId: projectRow.id })
              .where(eq(bookings.id, existing.id));
          }
        } catch (err) {
          console.error("[payment] auto-project insert failed", {
            bookingId: existing.id,
            producerId: existing.producerId,
            artistEmail: existing.artistEmail,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }

        try {
          const emailHash = createHash("sha256")
            .update(lowerEmail)
            .digest("hex");
          const now = new Date();
          await db
            .insert(clientContacts)
            .values({
              producerId: existing.producerId,
              emailHash,
              email: lowerEmail,
              name: existing.artistName,
              firstSeenAt: now,
              lastSeenAt: now,
            })
            .onConflictDoUpdate({
              target: [clientContacts.producerId, clientContacts.emailHash],
              set: { name: existing.artistName, lastSeenAt: now },
            });
        } catch (err) {
          console.warn("[payment] client_contacts upsert failed", err);
        }
      }

      // Confirmation email — best-effort, gated on autopilot toggle to
      // match booking.confirm's semantics.
      try {
        const [producer] = await db
          .select({
            displayName: producers.displayName,
            timezone: producers.timezone,
            defaultCurrency: producers.defaultCurrency,
            autopilotWelcomeEmail: producers.autopilotWelcomeEmail,
          })
          .from(producers)
          .where(eq(producers.id, existing.producerId))
          .limit(1);
        if (producer && producer.autopilotWelcomeEmail) {
          const product = existing.productId
            ? (
                await db
                  .select({
                    name: products.name,
                    priceCents: products.priceCents,
                    currency: products.currency,
                    depositPct: products.depositPct,
                  })
                  .from(products)
                  .where(eq(products.id, existing.productId))
                  .limit(1)
              )[0]
            : undefined;
          const priceCents = product?.priceCents ?? 0;
          const depositPct = product?.depositPct ?? 0;
          const depositCents = Math.round((priceCents * depositPct) / 100);
          await sendBookingConfirmedEmail(existing.artistEmail, {
            artistName: existing.artistName,
            producerName: producer.displayName ?? "Your producer",
            productName:
              product?.name ?? existing.packageNameSnapshot ?? "Session",
            startsAt: existing.durationMin > 0 ? existing.startsAt : null,
            producerTimezone: producer.timezone,
            currency: product?.currency ?? producer.defaultCurrency,
            priceCents,
            depositCents,
          });
        }
      } catch (err) {
        console.warn(
          "[email] sendBookingConfirmedEmail failed in confirmAfterPayment",
          err,
        );
      }

      return { ok: true as const, projectId };
    }),

  reject: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({
          producerId: bookings.producerId,
          status: bookings.status,
          artistEmail: bookings.artistEmail,
          artistName: bookings.artistName,
          startsAt: bookings.startsAt,
          packageNameSnapshot: bookings.packageNameSnapshot,
          producerDisplayName: producers.displayName,
          producerTimezone: producers.timezone,
        })
        .from(bookings)
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .where(eq(bookings.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (existing.status !== "pending_approval") {
        if (existing.status === "rejected") return { ok: true as const };
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot reject a ${existing.status} booking`,
        });
      }
      await ctx.db
        .update(bookings)
        .set({ status: "rejected", statusChangedAt: new Date() })
        .where(eq(bookings.id, input.id));

      after(async () => {
        try {
          await sendBookingCancelledOrRescheduledEmail(existing.artistEmail, {
            recipientName: existing.artistName,
            counterpartName: existing.producerDisplayName ?? "Your producer",
            productName: existing.packageNameSnapshot ?? "Session",
            status: "cancelled",
            oldStartsAt: existing.startsAt,
            newStartsAt: null,
            producerTimezone: existing.producerTimezone,
            reason: null,
          });
        } catch (err) {
          console.error("[email] booking-cancelled-or-rescheduled failed", err);
        }
      });

      return { ok: true as const };
    }),
});