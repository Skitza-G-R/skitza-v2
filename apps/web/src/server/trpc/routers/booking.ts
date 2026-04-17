import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
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
const PackageInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  durationMin: z.number().int().min(15).max(24 * 60),
  sessionCount: z.number().int().min(1).max(100).default(1),
  priceCents: z.number().int().min(0).max(100_000_000).default(0),
  currency: z.enum(["USD", "EUR", "GBP", "ILS"]).default("USD"),
  depositPct: z.number().int().min(0).max(100).default(0),
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
// Minimum scheduling notice. Booking less than this far out is
// rejected by the client + server.
const MIN_LEAD_HOURS = 12;

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Given a producer's weekly availability + existing non-cancelled
 * bookings, compute available slot start times (ISO strings) for the
 * next `days` days starting at the producer's "today" (UTC-aware).
 *
 * Semantics:
 * - Slots are generated inside each availability block at 15-min
 *   increments, starting at each block's startMin and fitting the
 *   package's full durationMin within the block.
 * - A slot is excluded if it overlaps ANY non-cancelled booking for
 *   the same producer (pending + confirmed both block the slot —
 *   we're optimistic-hold; a rejected request frees the slot again).
 * - Slots inside the min-lead-time cutoff are excluded.
 *
 * Timezone strategy: v1 uses the PRODUCER's timezone for slot labels
 * and storage. The caller (public page) renders the producer's TZ
 * with a banner; visitor-TZ conversion lands in v2.
 */
function computeSlots(
  weekBlocks: readonly { weekday: number; startMin: number; endMin: number }[],
  existingBookings: readonly { startsAt: Date; durationMin: number }[],
  durationMin: number,
  days: number,
  now: Date = new Date(),
): string[] {
  const out: string[] = [];
  const minLeadMs = MIN_LEAD_HOURS * 60 * 60 * 1000;
  const earliestAllowed = new Date(now.getTime() + minLeadMs);

  // Group availability blocks by weekday for O(1) lookup during the day loop.
  const blocksByDay = new Map<number, { startMin: number; endMin: number }[]>();
  for (const b of weekBlocks) {
    const list = blocksByDay.get(b.weekday) ?? [];
    list.push({ startMin: b.startMin, endMin: b.endMin });
    blocksByDay.set(b.weekday, list);
  }

  // Pre-sort existing bookings by startsAt for quick overlap check.
  const sortedBookings = [...existingBookings].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    day.setUTCHours(0, 0, 0, 0);
    const weekday = day.getUTCDay(); // 0..6
    const todayBlocks = blocksByDay.get(weekday) ?? [];
    for (const block of todayBlocks) {
      // Walk 15-min steps within the block. `durationMin` must fit.
      for (let start = block.startMin; start + durationMin <= block.endMin; start += SLOT_INCREMENT_MIN) {
        const slotStart = new Date(day.getTime() + start * 60 * 1000);
        if (slotStart < earliestAllowed) continue;
        const slotEnd = new Date(slotStart.getTime() + durationMin * 60 * 1000);
        // Overlap check — any booking (pending OR confirmed) with
        // overlapping time blocks the slot.
        const overlaps = sortedBookings.some((b) => {
          const bEnd = new Date(b.startsAt.getTime() + b.durationMin * 60 * 1000);
          return slotStart < bEnd && b.startsAt < slotEnd;
        });
        if (overlaps) continue;
        out.push(slotStart.toISOString());
      }
    }
  }
  return out;
}

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

      return {
        durationMin: pkg.durationMin,
        slots: computeSlots(weekBlocks, existing, pkg.durationMin, input.days, now),
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
      // filters — scripted clients could bypass.
      const minLeadMs = MIN_LEAD_HOURS * 60 * 60 * 1000;
      if (startsAt.getTime() - Date.now() < minLeadMs) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking starts too soon — needs at least 12h notice",
        });
      }
      const endsAt = new Date(startsAt.getTime() + pkg.durationMin * 60 * 1000);

      // Race-safe overlap check: re-pull candidates now and filter in
      // JS. This catches the "two visitors submit same slot" edge
      // between slotsFor render and submit.
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
        const cEnd = new Date(c.startsAt.getTime() + c.durationMin * 60 * 1000);
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
      return { id: row.id };
    }),
});
