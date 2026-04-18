import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  availabilityBlackouts,
  availabilityBlocks,
  bookings,
  clientContacts,
  createDb,
  eq,
  gte,
  inArray,
  invoices,
  isNull,
  lte,
  products,
  producers,
  projects,
  type Db,
  type PaymentPlan,
  type Product,
} from "@skitza/db";
import { z } from "zod";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";
import { recordContact } from "~/server/contacts/record";
import {
  sendBookingConfirmedEmail,
  sendBookingRequestEmail,
} from "~/server/email/send";
import { emitBookingRequested } from "~/server/notifications/emit";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";
import { buildCheckoutSessionParams } from "~/server/payments/checkout";
import { calculateCharges } from "~/server/payments/plan";
import { getOrCreateStripeCustomer } from "~/server/stripe/customer";

// Public procedures need their own `db` handle + an ipHash for
// rate-limiting. producerProcedure adds these already (for authed
// callers); publicProcedure doesn't. Small helper keeps each public
// endpoint's body focused on what it actually does.
async function publicCtx(): Promise<{ db: Db; ipHash: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return { db: createDb(dbUrl), ipHash: createHash("sha256").update(ipRaw).digest("hex") };
}

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
  sessionCount: z.number().int().min(1).max(100).optional(),
  deliverables: z.array(z.string().min(1).max(100)).max(10).optional(),
  depositModel: DepositModel.default("flat"),
  depositPct: z.number().int().min(0).max(100).optional(),
  milestones: z.array(Milestone).max(5).optional(),
  locationType: ProductLocationType.default("studio"),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  minLeadHours: z.number().int().min(0).max(30 * 24).default(12),
  paymentPlans: PaymentPlanInput.optional(),
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
    sessionCount: z.number().int().min(1).max(100).optional(),
    deliverables: z.array(z.string().min(1).max(100)).max(10).optional(),
    depositModel: DepositModel.optional(),
    depositPct: z.number().int().min(0).max(100).optional(),
    milestones: z.array(Milestone).max(5).optional(),
    locationType: ProductLocationType.optional(),
    bufferMinutes: z.number().int().min(0).max(240).optional(),
    minLeadHours: z.number().int().min(0).max(30 * 24).optional(),
    paymentPlans: PaymentPlanInput.optional(),
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

// Shared schema used for a single plan choice. Matches the on-disk
// `PaymentPlan` union (full / 50-50 / monthly with 2..12 installments).
const PaymentPlanChoice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("split_50_50") }),
  z.object({
    kind: z.literal("monthly"),
    installments: z.number().int().min(2).max(12),
  }),
]);

// Visitor booking-request input. `quantity` defaults to 1 for per-song
// products; ignored for flat/bundle/hourly. `hours` similarly optional
// for hourly. `paymentPlan` is the picker's selection — when the
// product offers multiple plans the client picks one before submitting.
// Absent means "legacy deposit/full flow" (no new project row, no
// Stripe Customer lookup). Validated against the product's
// `paymentPlans` at runtime.
const BookingRequestInput = z.object({
  productId: z.string().uuid(),
  artistName: z.string().min(1).max(80),
  artistEmail: z.string().email(),
  artistPhone: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  startsAtIso: z.string().datetime().optional(), // optional: pure-delivery products have no slot
  quantity: z.number().int().min(1).max(100).optional(),
  hours: z.number().int().min(1).max(24 * 7).optional(),
  paymentPlan: PaymentPlanChoice.optional(),
});

// Slot-compute input. `startDate` is an ISO date (YYYY-MM-DD) in the
// producer's TZ; we look forward from that date.
const SlotsInput = z.object({
  slug: z.string().min(3).max(48),
  productId: z.string().uuid(),
  days: z.number().int().min(1).max(60).default(14),
});

// Public rate-limit.
const BOOKING_REQUEST_LIMIT = 5;
const BOOKING_REQUEST_WINDOW_MS = 60_000;
const SLOTS_LIMIT = 30;
const SLOTS_WINDOW_MS = 60_000;

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

function dayKeyInTz(instant: Date, tz: string): string {
  const { year, month, day } = calendarDayInTz(instant, tz);
  return `${String(year)}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  // Reorder — atomic position swap. Accepts an ordered id array; each
  // id gets its index as the new position.
  reorder: producerProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Ownership check: every id must belong to this producer.
      if (input.ids.length === 0) return { ok: true as const };
      const rows = await ctx.db
        .select({ id: products.id, producerId: products.producerId })
        .from(products)
        .where(inArray(products.id, input.ids));
      for (const r of rows) {
        if (r.producerId !== ctx.producerId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }
      for (let i = 0; i < input.ids.length; i++) {
        const id = input.ids[i];
        if (!id) continue;
        await ctx.db
          .update(products)
          .set({ position: i })
          .where(eq(products.id, id));
      }
      return { ok: true as const };
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
          inArray(bookings.status, ["pending", "confirmed"]),
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

  list: producerProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "confirmed", "rejected", "cancelled"]).optional(),
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
        })
        .from(bookings)
        .where(eq(bookings.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (existing.status !== "pending") {
        if (existing.status === "confirmed") return { ok: true as const };
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot confirm a ${existing.status} booking`,
        });
      }
      await ctx.db
        .update(bookings)
        .set({ status: "confirmed", statusChangedAt: new Date() })
        .where(eq(bookings.id, input.id));

      // Email the artist that their session is confirmed. Fully
      // best-effort: catch + warn so a Resend hiccup doesn't unwind
      // the status transition the producer just performed.
      try {
        const [producer] = await ctx.db
          .select({
            displayName: producers.displayName,
            timezone: producers.timezone,
            defaultCurrency: producers.defaultCurrency,
          })
          .from(producers)
          .where(eq(producers.id, existing.producerId))
          .limit(1);
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
          producerName: producer?.displayName ?? "Your producer",
          productName: product?.name ?? existing.packageNameSnapshot ?? "Session",
          startsAt: existing.durationMin > 0 ? existing.startsAt : null,
          producerTimezone: producer?.timezone ?? "UTC",
          currency: product?.currency ?? producer?.defaultCurrency ?? "USD",
          priceCents,
          depositCents,
        });
      } catch (err) {
        console.warn("[email] sendBookingConfirmedEmail failed in booking.confirm", err);
      }

      return { ok: true as const };
    }),

  reject: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ producerId: bookings.producerId, status: bookings.status })
        .from(bookings)
        .where(eq(bookings.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (existing.status !== "pending") {
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
      return { ok: true as const };
    }),

  // ── Public procedures ────────────────────────────────────────────

  /** Public: list active products for a producer. Used by /p/<slug>/book. */
  publicProducts: publicProcedure
    .input(z.object({ slug: z.string().min(3).max(48) }))
    .query(async ({ input }) => {
      const { db } = await publicCtx();
      const [producer] = await db
        .select({ id: producers.id, displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.slug, input.slug))
        .limit(1);
      if (!producer || producer.displayName === null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const rows = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.producerId, producer.id),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .orderBy(asc(products.position), asc(products.createdAt));
      return { producer: { displayName: producer.displayName }, products: rows };
    }),

  /**
   * Legacy alias for `publicProducts` — the old call-site names this
   * procedure `publicPackages` and expects `.packages` on the result.
   * Keep both until every caller migrates.
   */
  publicPackages: publicProcedure
    .input(z.object({ slug: z.string().min(3).max(48) }))
    .query(async ({ input }) => {
      const { db } = await publicCtx();
      const [producer] = await db
        .select({ id: producers.id, displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.slug, input.slug))
        .limit(1);
      if (!producer || producer.displayName === null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const rows = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.producerId, producer.id),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .orderBy(asc(products.position), asc(products.createdAt));
      return { producer: { displayName: producer.displayName }, packages: rows };
    }),

  /** Public: available slots for a product over the next N days. */
  publicSlots: publicProcedure
    .input(SlotsInput)
    .query(async ({ input }) => {
      const { db, ipHash } = await publicCtx();
      const rl = checkRateLimit(`booking-slots:${ipHash}`, SLOTS_LIMIT, SLOTS_WINDOW_MS);
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const [producer] = await db
        .select({ id: producers.id, timezone: producers.timezone })
        .from(producers)
        .where(eq(producers.slug, input.slug))
        .limit(1);
      if (!producer) throw new TRPCError({ code: "NOT_FOUND" });

      const [prod] = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.producerId, producer.id),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .limit(1);
      if (!prod) throw new TRPCError({ code: "NOT_FOUND" });

      // Pure-delivery products (durationMin = 0) have no slot grid.
      if (prod.durationMin <= 0) {
        return { durationMin: 0, slots: [] as string[] };
      }

      const weekBlocks = await db
        .select({
          weekday: availabilityBlocks.weekday,
          startMin: availabilityBlocks.startMin,
          endMin: availabilityBlocks.endMin,
        })
        .from(availabilityBlocks)
        .where(eq(availabilityBlocks.producerId, producer.id));

      const now = new Date();
      const horizon = new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000);
      const existing = await db
        .select({ startsAt: bookings.startsAt, durationMin: bookings.durationMin })
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, producer.id),
            inArray(bookings.status, ["pending", "confirmed"]),
            gte(bookings.startsAt, now),
            lte(bookings.startsAt, horizon),
          ),
        );

      const blackoutRows = await db
        .select({
          startDate: availabilityBlackouts.startDate,
          endDate: availabilityBlackouts.endDate,
        })
        .from(availabilityBlackouts)
        .where(eq(availabilityBlackouts.producerId, producer.id));

      return {
        durationMin: prod.durationMin,
        slots: computeSlots(
          weekBlocks,
          existing,
          prod.durationMin,
          input.days,
          producer.timezone,
          {
            minLeadHours: prod.minLeadHours,
            bufferMinutes: prod.bufferMinutes,
            blackouts: blackoutRows,
            now,
          },
        ),
      };
    }),

  /** Public: submit a booking request. Rate-limited per IP. */
  publicRequest: publicProcedure
    .input(z.object({ slug: z.string().min(3).max(48) }).merge(BookingRequestInput))
    .mutation(async ({ input }) => {
      const { db, ipHash } = await publicCtx();
      const rl = checkRateLimit(
        `booking-request:${ipHash}`,
        BOOKING_REQUEST_LIMIT,
        BOOKING_REQUEST_WINDOW_MS,
      );
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const [producer] = await db
        .select({ id: producers.id })
        .from(producers)
        .where(eq(producers.slug, input.slug))
        .limit(1);
      if (!producer) throw new TRPCError({ code: "NOT_FOUND" });

      const [prod] = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.producerId, producer.id),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .limit(1);
      if (!prod) throw new TRPCError({ code: "NOT_FOUND" });

      // Products without a duration (pure-deliverable) skip the slot
      // check entirely. We still record a booking row for history +
      // notifications, using `now` as a placeholder startsAt so the
      // NOT NULL constraint is satisfied.
      const isSessionless = prod.durationMin <= 0;
      const startsAt = isSessionless
        ? new Date()
        : input.startsAtIso
          ? new Date(input.startsAtIso)
          : null;
      if (!isSessionless && !startsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A slot is required for this product.",
        });
      }

      if (!isSessionless && startsAt) {
        const minLeadMs = prod.minLeadHours * 60 * 60 * 1000;
        if (startsAt.getTime() - Date.now() < minLeadMs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Booking starts too soon — needs at least ${String(prod.minLeadHours)}h notice`,
          });
        }
        const endsAt = new Date(startsAt.getTime() + prod.durationMin * 60 * 1000);

        const [producerTz] = await db
          .select({ timezone: producers.timezone })
          .from(producers)
          .where(eq(producers.id, producer.id))
          .limit(1);
        const tz = producerTz?.timezone ?? "UTC";

        const blackoutRows = await db
          .select({
            startDate: availabilityBlackouts.startDate,
            endDate: availabilityBlackouts.endDate,
          })
          .from(availabilityBlackouts)
          .where(eq(availabilityBlackouts.producerId, producer.id));
        const slotDayKey = dayKeyInTz(startsAt, tz);
        if (isBlackedOut(slotDayKey, blackoutRows)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That day isn't available — please pick another.",
          });
        }

        const bufferMs = prod.bufferMinutes * 60 * 1000;
        const candidates = await db
          .select({ startsAt: bookings.startsAt, durationMin: bookings.durationMin })
          .from(bookings)
          .where(
            and(
              eq(bookings.producerId, producer.id),
              inArray(bookings.status, ["pending", "confirmed"]),
            ),
          );
        const hits = candidates.some((c) => {
          const cEnd = new Date(c.startsAt.getTime() + c.durationMin * 60 * 1000 + bufferMs);
          return startsAt < cEnd && c.startsAt < endsAt;
        });
        if (hits) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That slot was just taken — please pick another.",
          });
        }
      }

      const [row] = await db
        .insert(bookings)
        .values({
          producerId: producer.id,
          productId: prod.id,
          packageNameSnapshot: prod.name,
          artistName: input.artistName,
          artistEmail: input.artistEmail.toLowerCase(),
          ...(input.artistPhone ? { artistPhone: input.artistPhone } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          startsAt: startsAt ?? new Date(),
          durationMin: prod.durationMin,
          status: "pending",
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      try {
        await recordContact(db, {
          producerId: producer.id,
          email: input.artistEmail,
          name: input.artistName,
        });
      } catch (err) {
        console.warn("[contacts] recordContact failed in booking.publicRequest", err);
      }

      try {
        await emitBookingRequested(db, {
          producerId: producer.id,
          bookingId: row.id,
          artistName: input.artistName,
          artistEmail: input.artistEmail.toLowerCase(),
          when: startsAt ?? new Date(),
        });
      } catch (err) {
        console.warn("[notify] emitBookingRequested failed in booking.publicRequest", err);
      }

      // Fire the producer's "new request" email. Best-effort: a Resend
      // outage must not roll back the booking insert — the producer
      // can still see the request in /dashboard/booking?tab=requests.
      try {
        const [producerRow] = await db
          .select({
            email: producers.email,
            displayName: producers.displayName,
            timezone: producers.timezone,
          })
          .from(producers)
          .where(eq(producers.id, producer.id))
          .limit(1);
        if (producerRow?.email) {
          const depositCents = Math.round((prod.priceCents * prod.depositPct) / 100);
          await sendBookingRequestEmail(producerRow.email, {
            producerName: producerRow.displayName ?? "there",
            artistName: input.artistName,
            productName: prod.name,
            startsAt: prod.durationMin > 0 ? (startsAt ?? null) : null,
            producerTimezone: producerRow.timezone,
            currency: prod.currency,
            priceCents: prod.priceCents,
            depositCents,
            notes: input.notes,
          });
        }
      } catch (err) {
        console.warn("[email] sendBookingRequestEmail failed in booking.publicRequest", err);
      }

      // Phase H.5 — when the producer has Stripe Connect on and the
      // product carries a deposit (or is paid-in-full), mint a Stripe
      // Checkout Session and return the URL so the visitor can pay
      // immediately. Best-effort: a Stripe outage falls back to the
      // pending-approval flow — the booking row is still saved, the
      // producer still gets notified, the artist gets the request
      // email — only the in-flow checkout is skipped.
      //
      // Two branches:
      //   (a) `paymentPlan` selected (Phase I auto-installments): run
      //       the 3-shape dispatch via buildCheckoutSessionParams. We
      //       upsert a client_contact, reuse/create a Stripe Customer,
      //       create a project row in `lead` stage with the plan
      //       snapshot, and persist the invoice linked to that project.
      //       The webhook (Task 6) advances the project to `active` on
      //       checkout.session.completed and installs the Subscription
      //       Schedule for monthly plans.
      //   (b) No `paymentPlan` — legacy deposit/full path for producers
      //       still on the Phase H.5 flow. Unchanged behavior.
      let checkoutUrl: string | null = null;
      try {
        const [producerRow] = await db
          .select({
            stripeAccountId: producers.stripeAccountId,
            stripeChargesEnabled: producers.stripeChargesEnabled,
            slug: producers.slug,
          })
          .from(producers)
          .where(eq(producers.id, producer.id))
          .limit(1);

        if (producerRow?.stripeAccountId && producerRow.stripeChargesEnabled) {
          const fullPriceCents = calculatePriceCents(prod, {
            ...(input.quantity ? { quantity: input.quantity } : {}),
            ...(input.hours ? { hours: input.hours } : {}),
          });
          const { getSiteUrl, getStripe } = await import("~/server/stripe/client");
          const base = getSiteUrl();

          if (input.paymentPlan && fullPriceCents > 0) {
            // ── Branch (a): plan-driven 3-shape checkout ────────────
            // Guard: the plan the visitor picked must actually be
            // enabled on this product. Otherwise a determined visitor
            // could POST any plan and bypass the producer's configured
            // options.
            const offered = prod.paymentPlans;
            const chosen = input.paymentPlan;
            const ok = offered.some((p) => {
              if (p.kind !== chosen.kind) return false;
              if (p.kind === "monthly" && chosen.kind === "monthly") {
                return p.installments === chosen.installments;
              }
              return true;
            });
            if (!ok) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "That payment plan isn't offered on this product.",
              });
            }

            const plan: PaymentPlan = chosen;
            const charges = calculateCharges(plan, fullPriceCents);
            const firstCharge = charges[0];
            if (firstCharge === undefined) {
              // calculateCharges always returns a non-empty array for
              // the inputs we reach here with — this can't happen
              // unless the helper is broken, in which case fail loud
              // rather than send Stripe a bogus session.
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            }

            // Upsert the client_contact row so we can pin the Stripe
            // Customer mapping. recordContact does the same upsert for
            // the generic contacts cache; here we need the row's id, so
            // we run an explicit insert/select.
            const lowerEmail = input.artistEmail.trim().toLowerCase();
            const emailHash = createHash("sha256").update(lowerEmail).digest("hex");
            const now = new Date();
            const inserted = await db
              .insert(clientContacts)
              .values({
                producerId: producer.id,
                emailHash,
                email: lowerEmail,
                name: input.artistName.trim(),
                firstSeenAt: now,
                lastSeenAt: now,
              })
              .onConflictDoUpdate({
                target: [clientContacts.producerId, clientContacts.emailHash],
                set: { name: input.artistName.trim(), lastSeenAt: now },
              })
              .returning({ id: clientContacts.id });
            const clientContactId = inserted[0]?.id;
            if (!clientContactId) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            }

            // Reuse-or-create the Stripe Customer for this (producer,
            // client) pair. Saved cards carry across future projects
            // because we always key on the same Customer.
            const customerId = await getOrCreateStripeCustomer({
              db,
              producerId: producer.id,
              clientContactId,
              clientEmail: lowerEmail,
              clientName: input.artistName.trim(),
            });

            // Create the project row up front (stage=`lead`) so the
            // webhook handler has something to update when the checkout
            // completes. We snapshot the plan shape + chargesTotal here
            // because invoice rows FK back to this row.
            const token = mintShareToken();
            const [projectRow] = await db
              .insert(projects)
              .values({
                producerId: producer.id,
                bookingId: row.id,
                title: prod.name,
                artistName: input.artistName,
                artistEmail: lowerEmail,
                clientName: input.artistName,
                clientEmail: lowerEmail,
                shareTokenHash: token.hash,
                paymentPlanKind: plan.kind,
                installments: plan.kind === "monthly" ? plan.installments : null,
                chargesTotal: charges.length,
                stripeCustomerId: customerId,
              })
              .returning();
            if (!projectRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const params = buildCheckoutSessionParams({
              plan,
              productName: prod.name,
              currency: prod.currency.toLowerCase(),
              totalCents: fullPriceCents,
              customerId,
              destinationAccountId: producerRow.stripeAccountId,
              successUrl: `${base}/p/${producerRow.slug}/book/success?session_id={CHECKOUT_SESSION_ID}`,
              cancelUrl: `${base}/p/${producerRow.slug}/book?cancelled=1`,
              metadata: {
                producerId: producer.id,
                bookingId: row.id,
                projectId: projectRow.id,
                planKind: plan.kind,
              },
            });
            const stripe = getStripe();
            const session = await stripe.checkout.sessions.create(params, {
              idempotencyKey: `booking-${row.id}-checkout`,
            });
            checkoutUrl = session.url;

            // Record the first invoice (for the first charge). For
            // monthly plans, subsequent invoices land via invoice.paid
            // webhook handlers.
            const invoiceKind =
              plan.kind === "full"
                ? "full"
                : plan.kind === "split_50_50"
                  ? "deposit"
                  : "installment";
            await db.insert(invoices).values({
              producerId: producer.id,
              bookingId: row.id,
              projectId: projectRow.id,
              paymentPlanProjectId: projectRow.id,
              stripeCheckoutSessionId: session.id,
              amountCents: firstCharge,
              currency: prod.currency,
              description: `${prod.name} — ${invoiceKind}`,
              kind: invoiceKind,
              status: "sent",
              customerEmail: lowerEmail,
              customerName: input.artistName,
            });
            await db
              .update(bookings)
              .set({ stripeCheckoutSessionId: session.id })
              .where(eq(bookings.id, row.id));
          } else if (prod.depositPct > 0 || prod.depositModel === "paid_in_full") {
            // ── Branch (b): legacy deposit/paid-in-full path ───────
            const isFull = prod.depositModel === "paid_in_full";
            const amountCents = isFull
              ? fullPriceCents
              : Math.round((fullPriceCents * prod.depositPct) / 100);

            if (amountCents > 0) {
              const stripe = getStripe();
              const session = await stripe.checkout.sessions.create({
                mode: "payment",
                line_items: [
                  {
                    price_data: {
                      currency: prod.currency.toLowerCase(),
                      product_data: {
                        name: `${prod.name} — ${isFull ? "full" : "deposit"}`,
                      },
                      unit_amount: amountCents,
                    },
                    quantity: 1,
                  },
                ],
                customer_email: input.artistEmail.toLowerCase(),
                success_url: `${base}/p/${producerRow.slug}/book/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${base}/p/${producerRow.slug}/book?cancelled=1`,
                payment_intent_data: {
                  transfer_data: { destination: producerRow.stripeAccountId },
                },
                metadata: {
                  producerId: producer.id,
                  bookingId: row.id,
                  kind: isFull ? "full" : "deposit",
                },
              });
              checkoutUrl = session.url;

              await db.insert(invoices).values({
                producerId: producer.id,
                bookingId: row.id,
                stripeCheckoutSessionId: session.id,
                amountCents,
                currency: prod.currency,
                description: `${prod.name} — ${isFull ? "full" : "deposit"}`,
                kind: isFull ? "full" : "deposit",
                status: "sent",
                customerEmail: input.artistEmail.toLowerCase(),
                customerName: input.artistName,
              });
              await db
                .update(bookings)
                .set({ stripeCheckoutSessionId: session.id })
                .where(eq(bookings.id, row.id));
            }
          }
        }
      } catch (err) {
        // TRPCError subclasses (BAD_REQUEST for invalid plan choice)
        // must bubble up so the visitor sees the specific message. All
        // other failures (Stripe outage, DB hiccup) degrade gracefully
        // to the pending-approval flow.
        if (err instanceof TRPCError) throw err;
        console.warn("[stripe] checkout creation failed in booking.publicRequest", err);
      }

      return { id: row.id, checkoutUrl };
    }),
});

// Mint a share-token for project rooms. Mirrors project.ts — kept local
// here to avoid a cross-router import cycle.
function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}
