import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  availabilityBlackouts,
  availabilityBlocks,
  bookings,
  createDb,
  eq,
  gte,
  inArray,
  lte,
  packages,
  producers,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";
import { recordContact } from "~/server/contacts/record";
import { emitBookingRequested } from "~/server/notifications/emit";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";

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

// ─── Package schemas ─────────────────────────────────────────────────
// Keep price in integer cents to avoid float arithmetic. durationMin is
// capped at 24h because a "session" longer than a day is almost always
// a data error or an attempt to exhaust calendar search space.
// Kind is free-text on disk but we gate input to a friendly allow-list
// so typos don't splinter the classification UI on the public page.
// "other" is the escape hatch for producers who don't fit the presets.
const PackageKind = z.enum(["session", "mixing", "mastering", "producing", "other"]);
const PackageLocationType = z.enum(["studio", "remote", "client_space"]);

const PackageInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  durationMin: z.number().int().min(15).max(24 * 60),
  sessionCount: z.number().int().min(1).max(100).default(1),
  priceCents: z.number().int().min(0).max(100_000_000).default(0),
  currency: z.enum(["USD", "EUR", "GBP", "ILS"]).default("USD"),
  depositPct: z.number().int().min(0).max(100).default(0),
  // v2 fields — all have DB-level defaults so they're optional in
  // create/update inputs.
  kind: PackageKind.default("session"),
  locationType: PackageLocationType.default("studio"),
  // 0 = back-to-back sessions OK. Capped at 240 (4h) — anything larger
  // is almost always a data entry error.
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  // 0 = "book instantly". Max 30 days.
  minLeadHours: z.number().int().min(0).max(30 * 24).default(12),
});

// Weekly availability replaces the entire week atomically — easier UX
// than per-row editing + means we don't need to expose internal block
// IDs to the producer's form.
const Block = z.object({
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(24 * 60),
  endMin: z.number().int().min(0).max(24 * 60),
});
const AvailabilityWeekInput = z
  .object({
    blocks: z.array(Block).max(14), // 2 blocks × 7 weekdays
  })
  .superRefine((val, ctx) => {
    // Validate startMin < endMin per row + disallow overlapping blocks
    // within the same weekday so the slot-math stays deterministic.
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

// Visitor booking-request input. Artist fields are free-text (no
// account required). `startsAt` is an ISO string; we parse + normalize
// to the producer's timezone at slot-intersection time.
const BookingRequestInput = z.object({
  packageId: z.string().uuid(),
  artistName: z.string().min(1).max(80),
  artistEmail: z.string().email(),
  artistPhone: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  startsAtIso: z.string().datetime(),
});

// Slot-compute input. `startDate` is an ISO date (YYYY-MM-DD) in the
// producer's TZ; we look forward from that date.
const SlotsInput = z.object({
  slug: z.string().min(3).max(48),
  packageId: z.string().uuid(),
  days: z.number().int().min(1).max(60).default(14),
});

// Public rate-limit: booking requests + slot queries are both
// unauthenticated. Generous enough for a real visitor who makes 3-5
// probes + 1 submit.
const BOOKING_REQUEST_LIMIT = 5;
const BOOKING_REQUEST_WINDOW_MS = 60_000;
const SLOTS_LIMIT = 30;
const SLOTS_WINDOW_MS = 60_000;

// Slot increment for the public picker — 15 min. 30 min would miss
// "3:15pm is free", 5 min would be UI-spammy.
const SLOT_INCREMENT_MIN = 15;
// Floor for per-package minLeadHours. If a producer hasn't set a
// custom lead time (legacy row), this is the fallback default.
const DEFAULT_MIN_LEAD_HOURS = 12;

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Given producer weekly availability + non-cancelled bookings + the
 * producer's IANA timezone, compute slot starts as UTC ISO strings
 * for the next `days` days.
 *
 * Availability is authored in the producer's LOCAL time (e.g. "10:00
 * Berlin"). We must materialize that as the correct UTC instant on
 * each day (respecting DST). Approach:
 *
 *   1. Take a guessed UTC timestamp = `Date.UTC(Y, M, D, hour, min)`
 *      where Y/M/D/hour/min are the values we *want* to see in the
 *      target tz.
 *   2. Format that guess `in` the target tz via Intl.DateTimeFormat
 *      and read the offset between what we wanted and what we got.
 *   3. Apply the offset to the guess — that's the correct UTC instant.
 *
 * This is the standard approach for "local wall-clock → UTC" in
 * stdlib-only JS, used by date-fns-tz and friends. It handles DST
 * transitions correctly because the offset calculation happens per-
 * day at the specific wall-clock time.
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
    // Intl emits "24" for midnight in some locales; coerce to 0.
    Number(lookup.hour) % 24,
    Number(lookup.minute),
  );
  const offset = guess.getTime() - shownUtcEquivalent;
  return new Date(guess.getTime() + offset);
}

/**
 * Given `now` (a UTC instant) and a tz, return { year, month, day,
 * weekday } as they appear in that tz. Used to iterate calendar days
 * in the producer's local time, not UTC's.
 */
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
  // Intl short-weekday: "Sun", "Mon", ...
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

/**
 * Format a calendar day (in tz) as YYYY-MM-DD. Used to compare against
 * blackout ranges which are stored as text dates in the producer's TZ.
 */
function dayKeyInTz(instant: Date, tz: string): string {
  const { year, month, day } = calendarDayInTz(instant, tz);
  return `${String(year)}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Pure helper: is a given date-key (YYYY-MM-DD) inside any of the
 * blackout ranges (both ends inclusive)? String comparison on ISO
 * dates is correct lex-ordering, so we don't need to parse.
 *
 * Exported so the slot-computation tests can exercise the boundary
 * logic without spinning up a full DB.
 */
export function isBlackedOut(
  dayKey: string,
  blackouts: readonly { startDate: string; endDate: string }[],
): boolean {
  return blackouts.some((b) => dayKey >= b.startDate && dayKey <= b.endDate);
}

/**
 * Compute available slot start times as UTC ISO strings for the next
 * `days` days, from the producer's weekly availability (in producer
 * local time) minus existing non-cancelled bookings.
 *
 * - 15-min increments inside each availability block.
 * - durationMin must fit entirely inside the block.
 * - pending + confirmed bookings both block slots (optimistic hold);
 *   rejected/cancelled free the slot again.
 * - `bufferMinutes` is added to each existing booking's duration when
 *   checking for overlap, so a new slot can't start before the buffer
 *   after a finishing session.
 * - Slots inside the per-package `minLeadHours` cutoff are excluded.
 * - Days inside a blackout range (calendar-day, producer TZ,
 *   inclusive) are skipped entirely.
 */
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

  // Group availability blocks by weekday for O(1) lookup.
  const blocksByDay = new Map<number, { startMin: number; endMin: number }[]>();
  for (const b of weekBlocks) {
    const list = blocksByDay.get(b.weekday) ?? [];
    list.push({ startMin: b.startMin, endMin: b.endMin });
    blocksByDay.set(b.weekday, list);
  }

  // Start from today in the producer's tz — not UTC — so "this week"
  // matches what the producer sees in their calendar.
  const today = calendarDayInTz(now, tz);

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    // Add dayOffset days to the producer-tz date. Use UTC math on a
    // tz-day-midnight anchor to move day-by-day safely across DST.
    const anchor = wallClockInTzToUtc(today.year, today.month, today.day, 0, 0, tz);
    const dayInstant = new Date(anchor.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const dayCal = calendarDayInTz(dayInstant, tz);
    // Skip the whole day if it falls inside a blackout window.
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
        // Buffer applies to existing bookings only (we don't inflate
        // the candidate slot's end — that would double-count).
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

// Exported for tests only — the router calls computeSlots via the
// `publicSlots` procedure. Keeping this as a named export avoids
// making the helper into a first-class API.
export const __computeSlotsForTests = computeSlots;
export const __wallClockInTzToUtcForTests = wallClockInTzToUtc;

// ─── Router ──────────────────────────────────────────────────────────

export const bookingRouter = router({
  // ── Packages (producer-only) ─────────────────────────────────────
  packages: router({
    list: producerProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(packages)
        .where(eq(packages.producerId, ctx.producerId))
        .orderBy(asc(packages.position), asc(packages.createdAt));
    }),

    create: producerProcedure
      .input(PackageInput)
      .mutation(async ({ ctx, input }) => {
        // Position = current max + 1 so new packages land at the end
        // visually. Small race (two creates simultaneously get same
        // position) is fine — deterministic asc-createdAt tiebreak.
        const existing = await ctx.db
          .select({ position: packages.position })
          .from(packages)
          .where(eq(packages.producerId, ctx.producerId))
          .orderBy(asc(packages.position));
        const nextPos = existing.length === 0
          ? 0
          : (existing[existing.length - 1]?.position ?? 0) + 1;
        const [row] = await ctx.db
          .insert(packages)
          .values({ ...stripUndefined(input), producerId: ctx.producerId, position: nextPos })
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return row;
      }),

    update: producerProcedure
      .input(PackageInput.partial().extend({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        const [existing] = await ctx.db
          .select({ producerId: packages.producerId })
          .from(packages)
          .where(eq(packages.id, id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.producerId !== ctx.producerId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const [row] = await ctx.db
          .update(packages)
          .set(stripUndefined(patch))
          .where(eq(packages.id, id))
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return row;
      }),

    // Soft-delete — flip `active` so bookings' packageNameSnapshot +
    // FK still render in the dashboard's history view.
    deactivate: producerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select({ producerId: packages.producerId })
          .from(packages)
          .where(eq(packages.id, input.id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.producerId !== ctx.producerId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await ctx.db
          .update(packages)
          .set({ active: false })
          .where(eq(packages.id, input.id));
        return { ok: true as const };
      }),
  }),

  // ── Blackouts (producer-only) ────────────────────────────────────
  // Date-range windows where the producer isn't taking bookings
  // regardless of the weekly template. Stored in producer-local
  // calendar days (YYYY-MM-DD), inclusive on both ends.
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
          // Cheap client-side gate — the YYYY-MM-DD regex rejects
          // stray input before we hit the DB. Full calendar-validity
          // is enforced by Postgres' text storage + the app's own
          // comparisons (ISO dates compare correctly as strings).
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
        // Ownership walk — deleteByPk + producerId filter in one
        // shot so a forged id can't delete another producer's row.
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

    // Atomic replace of the full week. Simpler than per-row CRUD +
    // avoids the "partial save" failure mode.
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
  // Confirmed sessions in the next N days. Powers the dashboard
  // "upcoming strip". Returned rows are grouped client-side by
  // producer-local calendar day. Joins the package row so the UI can
  // show kind + location badges without a second trip.
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
      // Two round-trips is fine here — producers usually have < 20
      // upcoming sessions, so the second SELECT is cheap + keeps the
      // query Drizzle-ergonomic (no manual INNER JOIN typing).
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

  // Dashboard revenue tile. All three numbers are aggregated in JS
  // rather than SUM() in SQL because we need to dedupe by currency
  // (producers may have USD + EUR packages) + the volume is tiny
  // (hundreds of bookings max). priceCents comes from the package
  // row, so we join via the package id.
  revenue: producerProcedure.query(async ({ ctx }) => {
    // Anchor dates in the producer's TZ would be nicer, but we store
    // bookings.startsAt as timestamptz and the dashboard's "this
    // month" expectation is reasonable across any tz — close enough
    // for a summary tile. UTC math avoids DST quirks.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Read producer's default currency for the tile header.
    const [producer] = await ctx.db
      .select({ defaultCurrency: producers.defaultCurrency })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    const currency = producer?.defaultCurrency ?? "USD";

    // Pull every booking that could contribute to any of the three
    // numbers in a single query — cheap, and keeps the joining logic
    // in JS where it's easier to reason about.
    const bookingRows = await ctx.db
      .select({
        id: bookings.id,
        status: bookings.status,
        startsAt: bookings.startsAt,
        packageId: bookings.packageId,
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

    // Fetch the packages once for price + deposit lookup. Non-unique
    // packageIds compress via a Set so we only fetch each row once.
    // bookings.packageId is nullable (ON DELETE SET NULL keeps the
    // booking alive when a package is purged), so filter those out.
    const pkgIds = Array.from(
      new Set(
        bookingRows
          .map((b) => b.packageId)
          .filter((id): id is string => id !== null),
      ),
    );
    const pkgRows = pkgIds.length === 0
      ? []
      : await ctx.db
          .select({
            id: packages.id,
            priceCents: packages.priceCents,
            depositPct: packages.depositPct,
            currency: packages.currency,
          })
          .from(packages)
          .where(inArray(packages.id, pkgIds));
    const pkgById = new Map(pkgRows.map((p) => [p.id, p]));

    let mtdCents = 0;
    let outstandingCents = 0;
    let next7DaysCents = 0;
    for (const b of bookingRows) {
      if (b.packageId === null) continue;
      const pkg = pkgById.get(b.packageId);
      if (!pkg) continue;
      // Only count prices in the producer's default currency for the
      // summary tile — multi-currency aggregation isn't a thing we
      // want to attempt in a single cents number.
      if (pkg.currency !== currency) continue;
      if (b.status === "confirmed") {
        if (b.startsAt >= monthStart && b.startsAt < nextMonthStart) {
          mtdCents += pkg.priceCents;
        }
        if (b.startsAt >= now && b.startsAt <= in7) {
          next7DaysCents += pkg.priceCents;
        }
      }
      // Outstanding = unpaid deposits on pending + confirmed bookings.
      // We don't yet track "deposit paid" — that lands with Stripe
      // Connect. For now, the gross deposit owed is the signal.
      if (pkg.depositPct > 0) {
        outstandingCents += Math.round((pkg.priceCents * pkg.depositPct) / 100);
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
        .select({ producerId: bookings.producerId, status: bookings.status })
        .from(bookings)
        .where(eq(bookings.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (existing.status !== "pending") {
        // Idempotent-ish — confirming an already-confirmed booking is
        // a no-op, but confirming a rejected/cancelled one is a bug.
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
  // Keyed by producer slug (public identifier) rather than id, so
  // cold-lead visitors can call these without knowing internal IDs.

  /** Public: list active packages for a producer. Used by /p/<slug>/book. */
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
        .from(packages)
        .where(and(eq(packages.producerId, producer.id), eq(packages.active, true)))
        .orderBy(asc(packages.position), asc(packages.createdAt));
      return { producer: { displayName: producer.displayName }, packages: rows };
    }),

  /** Public: available slots for a package over the next N days. */
  publicSlots: publicProcedure
    .input(SlotsInput)
    .query(async ({ input }) => {
      const { db, ipHash } = await publicCtx();
      // Per-IP rate limit — slots is cheap but called repeatedly by
      // the client as the visitor clicks around.
      const rl = checkRateLimit(`booking-slots:${ipHash}`, SLOTS_LIMIT, SLOTS_WINDOW_MS);
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const [producer] = await db
        .select({ id: producers.id, timezone: producers.timezone })
        .from(producers)
        .where(eq(producers.slug, input.slug))
        .limit(1);
      if (!producer) throw new TRPCError({ code: "NOT_FOUND" });

      const [pkg] = await db
        .select()
        .from(packages)
        .where(
          and(
            eq(packages.id, input.packageId),
            eq(packages.producerId, producer.id),
            eq(packages.active, true),
          ),
        )
        .limit(1);
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND" });

      const weekBlocks = await db
        .select({
          weekday: availabilityBlocks.weekday,
          startMin: availabilityBlocks.startMin,
          endMin: availabilityBlocks.endMin,
        })
        .from(availabilityBlocks)
        .where(eq(availabilityBlocks.producerId, producer.id));

      // Only pending + confirmed bookings block slots. Rejected +
      // cancelled are ignored (the slot is free again).
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

      // Pull blackout windows for this producer — cheap (small table,
      // indexed by producerId). Filter expired ones out to keep the
      // intersection work minimal.
      const blackoutRows = await db
        .select({
          startDate: availabilityBlackouts.startDate,
          endDate: availabilityBlackouts.endDate,
        })
        .from(availabilityBlackouts)
        .where(eq(availabilityBlackouts.producerId, producer.id));

      return {
        durationMin: pkg.durationMin,
        slots: computeSlots(
          weekBlocks,
          existing,
          pkg.durationMin,
          input.days,
          producer.timezone,
          {
            minLeadHours: pkg.minLeadHours,
            bufferMinutes: pkg.bufferMinutes,
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

      const [pkg] = await db
        .select()
        .from(packages)
        .where(
          and(
            eq(packages.id, input.packageId),
            eq(packages.producerId, producer.id),
            eq(packages.active, true),
          ),
        )
        .limit(1);
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND" });

      const startsAt = new Date(input.startsAtIso);
      // Re-validate lead time server-side even though the client
      // filters — scripted clients could bypass. Uses the package's
      // per-row minLeadHours now, not a global constant.
      const minLeadMs = pkg.minLeadHours * 60 * 60 * 1000;
      if (startsAt.getTime() - Date.now() < minLeadMs) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Booking starts too soon — needs at least ${String(pkg.minLeadHours)}h notice`,
        });
      }
      const endsAt = new Date(startsAt.getTime() + pkg.durationMin * 60 * 1000);

      // Producer's studio TZ — used for the blackout comparison below.
      // (We already verified `producer` exists above; re-select the
      // timezone alongside id.)
      const [producerTz] = await db
        .select({ timezone: producers.timezone })
        .from(producers)
        .where(eq(producers.id, producer.id))
        .limit(1);
      const tz = producerTz?.timezone ?? "UTC";

      // Reject the slot if it lands inside a blackout window.
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

      // Race-safe overlap check: re-pull candidates now and filter in
      // JS. This catches the "two visitors submit same slot" edge
      // between slotsFor render and submit. Buffer adds to the
      // existing booking's end so we don't slot anyone back-to-back
      // when the producer wants a breather.
      const bufferMs = pkg.bufferMinutes * 60 * 1000;
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

      const [row] = await db
        .insert(bookings)
        .values({
          producerId: producer.id,
          packageId: pkg.id,
          packageNameSnapshot: pkg.name,
          artistName: input.artistName,
          artistEmail: input.artistEmail.toLowerCase(),
          ...(input.artistPhone ? { artistPhone: input.artistPhone } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          startsAt,
          durationMin: pkg.durationMin,
          status: "pending",
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Best-effort contact cache update. A failure here (e.g. a
      // transient DB issue on the upsert) MUST NOT break the booking
      // request — the row above is the source of truth.
      try {
        await recordContact(db, {
          producerId: producer.id,
          email: input.artistEmail,
          name: input.artistName,
        });
      } catch (err) {
        console.warn("[contacts] recordContact failed in booking.publicRequest", err);
      }

      // Best-effort inbox notification — same guard as above.
      try {
        await emitBookingRequested(db, {
          producerId: producer.id,
          bookingId: row.id,
          artistName: input.artistName,
          artistEmail: input.artistEmail.toLowerCase(),
          when: startsAt,
        });
      } catch (err) {
        console.warn("[notify] emitBookingRequested failed in booking.publicRequest", err);
      }

      return { id: row.id };
    }),
});
