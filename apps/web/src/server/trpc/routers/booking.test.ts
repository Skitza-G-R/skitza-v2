import { describe, it, expect } from "vitest";

import {
  __computeSlotsForTests as computeSlots,
  blocksOverlapOnSameDay,
  isBlackedOut,
} from "./booking";

// These tests exercise the pure slot-computation helper, not the tRPC
// router itself. The router wraps this function with DB reads; the
// math + filtering lives inside the helper so we can test without
// spinning up Postgres.

describe("isBlackedOut", () => {
  it("returns false for an empty list", () => {
    expect(isBlackedOut("2026-04-20", [])).toBe(false);
  });

  it("matches on the start boundary (inclusive)", () => {
    expect(isBlackedOut("2026-04-20", [{ startDate: "2026-04-20", endDate: "2026-04-24" }])).toBe(true);
  });

  it("matches on the end boundary (inclusive)", () => {
    expect(isBlackedOut("2026-04-24", [{ startDate: "2026-04-20", endDate: "2026-04-24" }])).toBe(true);
  });

  it("returns false for a day just outside the range", () => {
    expect(isBlackedOut("2026-04-25", [{ startDate: "2026-04-20", endDate: "2026-04-24" }])).toBe(false);
    expect(isBlackedOut("2026-04-19", [{ startDate: "2026-04-20", endDate: "2026-04-24" }])).toBe(false);
  });

  it("matches when the day is inside any of multiple ranges", () => {
    const blackouts = [
      { startDate: "2026-04-20", endDate: "2026-04-24" },
      { startDate: "2026-05-01", endDate: "2026-05-03" },
    ];
    expect(isBlackedOut("2026-05-02", blackouts)).toBe(true);
    expect(isBlackedOut("2026-04-30", blackouts)).toBe(false);
  });
});

describe("computeSlots — blackouts, buffers, lead time", () => {
  const TZ = "UTC";
  // Every Monday 10:00-12:00 UTC.
  const weekBlocks = [{ weekday: 1, startMin: 10 * 60, endMin: 12 * 60 }];
  // Fixed "now" on a Sunday so Monday is tomorrow — lots of lead room.
  // 2026-04-12 is a Sunday, 2026-04-13 is a Monday.
  const now = new Date("2026-04-12T00:00:00Z");

  it("produces slots on Monday by default", () => {
    const slots = computeSlots(weekBlocks, [], 60, 7, TZ, {
      minLeadHours: 0,
      now,
    });
    // 10:00, 10:15, 10:30, 10:45, 11:00 all fit a 60-min session ≤ 12:00.
    expect(slots.length).toBeGreaterThan(0);
    // First slot should start at 10:00 on Monday 2026-04-13.
    expect(slots[0]).toBe("2026-04-13T10:00:00.000Z");
  });

  it("excludes slots inside a blackout range", () => {
    const slotsWithoutBlackout = computeSlots(weekBlocks, [], 60, 7, TZ, {
      minLeadHours: 0,
      now,
    });
    const slotsWithBlackout = computeSlots(weekBlocks, [], 60, 7, TZ, {
      minLeadHours: 0,
      now,
      blackouts: [{ startDate: "2026-04-13", endDate: "2026-04-13" }],
    });
    expect(slotsWithoutBlackout.length).toBeGreaterThan(0);
    expect(slotsWithBlackout.length).toBe(0);
  });

  it("keeps slots on days outside a blackout range", () => {
    // 2-week window, Monday blackout only on week 1 — week 2 Monday
    // should still produce slots.
    const slots = computeSlots(weekBlocks, [], 60, 14, TZ, {
      minLeadHours: 0,
      now,
      blackouts: [{ startDate: "2026-04-13", endDate: "2026-04-13" }],
    });
    expect(slots.some((s) => s.startsWith("2026-04-20"))).toBe(true);
    expect(slots.some((s) => s.startsWith("2026-04-13"))).toBe(false);
  });

  it("respects per-package minLeadHours — large lead time kills same-day slots", () => {
    // "now" is 00:00 Sunday. Monday 10:00 is +34h. A 48h lead should
    // skip all Monday slots but keep the next Monday's.
    const slots = computeSlots(weekBlocks, [], 60, 14, TZ, {
      minLeadHours: 48,
      now,
    });
    expect(slots.some((s) => s.startsWith("2026-04-13"))).toBe(false);
    expect(slots.some((s) => s.startsWith("2026-04-20"))).toBe(true);
  });

  it("respects per-package minLeadHours — zero lead allows immediate slots", () => {
    const slots = computeSlots(weekBlocks, [], 60, 14, TZ, {
      minLeadHours: 0,
      now,
    });
    expect(slots.some((s) => s.startsWith("2026-04-13"))).toBe(true);
  });

  it("adds bufferMinutes to existing booking duration when checking overlaps", () => {
    // Existing booking: Monday 10:00-11:00. Without buffer, a new 60-
    // min slot at 11:00 is fine. With a 30-min buffer, 11:00 overlaps
    // the buffer (11:00 < 11:30 cut-off), so it disappears; 11:30
    // still doesn't fit (would need to end ≤ 12:00 = fits) — yes,
    // 11:30 still fits since 11:30 + 60 = 12:30 > 12:00, so the only
    // post-buffer slot that would fit is pushed out entirely.
    const existing = [
      {
        startsAt: new Date("2026-04-13T10:00:00Z"),
        durationMin: 60,
      },
    ];
    const withoutBuffer = computeSlots(weekBlocks, existing, 60, 7, TZ, {
      minLeadHours: 0,
      bufferMinutes: 0,
      now,
    });
    const withBuffer = computeSlots(weekBlocks, existing, 60, 7, TZ, {
      minLeadHours: 0,
      bufferMinutes: 30,
      now,
    });
    // Without buffer: 11:00 slot should exist (starts right as prior
    // booking ends).
    expect(withoutBuffer).toContain("2026-04-13T11:00:00.000Z");
    // With a 30-min buffer, 11:00 is swallowed by the buffer window.
    expect(withBuffer).not.toContain("2026-04-13T11:00:00.000Z");
    // 11:30 would start inside the 12:00 end but can't fit a 60-min
    // duration so it was never a candidate — confirm no Monday slots
    // post-10:00 survive with a 30-min buffer on a 2-hour block.
    expect(withBuffer.filter((s) => s.startsWith("2026-04-13")).length).toBe(0);
  });

  it("ignores buffer entirely when bufferMinutes is 0 (default)", () => {
    const existing = [
      {
        startsAt: new Date("2026-04-13T10:00:00Z"),
        durationMin: 60,
      },
    ];
    const slots = computeSlots(weekBlocks, existing, 60, 7, TZ, {
      minLeadHours: 0,
      now,
    });
    expect(slots).toContain("2026-04-13T11:00:00.000Z");
  });
});

describe("blocksOverlapOnSameDay", () => {
  it("detects overlap within a weekday", () => {
    expect(
      blocksOverlapOnSameDay([
        { weekday: 1, startMin: 540, endMin: 720 }, // 9-12
        { weekday: 1, startMin: 600, endMin: 780 }, // 10-13 — overlaps
      ]),
    ).toBe(true);
  });

  it("allows back-to-back same-weekday blocks (no gap)", () => {
    expect(
      blocksOverlapOnSameDay([
        { weekday: 1, startMin: 540, endMin: 720 }, // 9-12
        { weekday: 1, startMin: 720, endMin: 900 }, // 12-15 — touches, no overlap
      ]),
    ).toBe(false);
  });

  it("allows 3 non-overlapping blocks on one day", () => {
    expect(
      blocksOverlapOnSameDay([
        { weekday: 1, startMin: 540, endMin: 720 }, // 9-12
        { weekday: 1, startMin: 840, endMin: 1020 }, // 14-17
        { weekday: 1, startMin: 1080, endMin: 1260 }, // 18-21
      ]),
    ).toBe(false);
  });

  it("different weekdays never overlap (regardless of times)", () => {
    expect(
      blocksOverlapOnSameDay([
        { weekday: 1, startMin: 540, endMin: 720 },
        { weekday: 2, startMin: 540, endMin: 720 },
      ]),
    ).toBe(false);
  });

  it("returns false for an empty list", () => {
    expect(blocksOverlapOnSameDay([])).toBe(false);
  });

  it("detects an exact duplicate block on the same day", () => {
    expect(
      blocksOverlapOnSameDay([
        { weekday: 3, startMin: 600, endMin: 720 },
        { weekday: 3, startMin: 600, endMin: 720 },
      ]),
    ).toBe(true);
  });
});

describe("computeSlots with multi-block weekday", () => {
  // Three blocks on Monday 2026-04-13 — 9-12, 14-17, 18-21 — the
  // concrete "studio hours" example from the H.4a spec. Verify slot
  // starts include all three windows, not just the first.
  const TZ = "UTC";
  const studioBlocks = [
    { weekday: 1, startMin: 9 * 60, endMin: 12 * 60 },
    { weekday: 1, startMin: 14 * 60, endMin: 17 * 60 },
    { weekday: 1, startMin: 18 * 60, endMin: 21 * 60 },
  ];
  const now = new Date("2026-04-12T00:00:00Z");

  it("generates slot candidates from every block on the same day", () => {
    const slots = computeSlots(studioBlocks, [], 60, 2, TZ, {
      minLeadHours: 0,
      now,
    });
    // Morning window — 9:00, 9:15, ..., 11:00.
    expect(slots).toContain("2026-04-13T09:00:00.000Z");
    // Afternoon window — 14:00 kicks in AFTER the 12:00 morning end.
    expect(slots).toContain("2026-04-13T14:00:00.000Z");
    // Evening window — 18:00 onwards.
    expect(slots).toContain("2026-04-13T18:00:00.000Z");
  });

  it("excludes the gap between blocks — 12:30 is not a slot", () => {
    const slots = computeSlots(studioBlocks, [], 60, 2, TZ, {
      minLeadHours: 0,
      now,
    });
    // 12:30 falls in the 12-14 gap — not a valid slot start.
    expect(slots).not.toContain("2026-04-13T12:30:00.000Z");
    // 13:30 would also be in the gap.
    expect(slots).not.toContain("2026-04-13T13:30:00.000Z");
  });

  it("still honours existing-booking overlap across multiple blocks", () => {
    const existing = [
      // Booking during the afternoon block.
      { startsAt: new Date("2026-04-13T14:00:00Z"), durationMin: 60 },
    ];
    const slots = computeSlots(studioBlocks, existing, 60, 2, TZ, {
      minLeadHours: 0,
      now,
    });
    // Morning + evening should be unaffected.
    expect(slots).toContain("2026-04-13T09:00:00.000Z");
    expect(slots).toContain("2026-04-13T18:00:00.000Z");
    // Afternoon 14:00 overlaps the existing booking.
    expect(slots).not.toContain("2026-04-13T14:00:00.000Z");
    // 15:00 is inside the booking (14-15).
    expect(slots).not.toContain("2026-04-13T14:30:00.000Z");
  });
});
