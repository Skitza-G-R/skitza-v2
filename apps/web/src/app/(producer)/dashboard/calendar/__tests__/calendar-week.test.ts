import { describe, expect, it } from "vitest";

import {
  buildWeek,
  isSameDay,
  todayIndex,
  weekEyebrow,
  weekRangeLabel,
} from "../calendar-week";

// Pure date math powering the Schedule tab's week navigation.
// Pinned by tests so DST changes / locale defaults don't silently
// shift the grid by a day. All inputs are JS Date in the producer's
// local timezone — the calendar UI is local-time everywhere per the
// PRD ("Producer's local timezone is what they see").

const SUN_MAY_3 = new Date(2026, 4, 3, 9, 30); // May 3, 2026 — Sun, 9:30
const WED_MAY_6 = new Date(2026, 4, 6, 14, 0); // Wed, May 6
const SAT_MAY_9 = new Date(2026, 4, 9, 23, 59);
const SUN_MAY_10 = new Date(2026, 4, 10, 0, 0);

describe("buildWeek", () => {
  it("returns 7 days starting on Sunday for offset 0", () => {
    const week = buildWeek(WED_MAY_6, 0);
    expect(week).toHaveLength(7);
    expect(week[0]?.getDay()).toBe(0);
    expect(week[0]?.getDate()).toBe(3);
    expect(week[6]?.getDay()).toBe(6);
    expect(week[6]?.getDate()).toBe(9);
  });

  it("offset +1 advances by one week", () => {
    const week = buildWeek(WED_MAY_6, 1);
    expect(week[0]?.getDate()).toBe(10);
    expect(week[6]?.getDate()).toBe(16);
  });

  it("offset -1 retreats by one week", () => {
    const week = buildWeek(WED_MAY_6, -1);
    expect(week[0]?.getDate()).toBe(26); // Apr 26
    expect(week[0]?.getMonth()).toBe(3); // April (0-indexed)
    expect(week[6]?.getDate()).toBe(2); // May 2
    expect(week[6]?.getMonth()).toBe(4);
  });

  it("zeros the time on every returned day so isSameDay comparisons match", () => {
    const week = buildWeek(WED_MAY_6, 0);
    for (const d of week) {
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
    }
  });
});

describe("isSameDay", () => {
  it("matches same calendar day across times", () => {
    expect(
      isSameDay(new Date(2026, 4, 3, 0, 0), new Date(2026, 4, 3, 23, 59)),
    ).toBe(true);
  });

  it("rejects different days", () => {
    expect(isSameDay(SAT_MAY_9, SUN_MAY_10)).toBe(false);
  });

  it("rejects same day-of-month in different months", () => {
    expect(
      isSameDay(new Date(2026, 4, 3), new Date(2026, 5, 3)),
    ).toBe(false);
  });
});

describe("todayIndex", () => {
  it("returns the index when today falls inside the week", () => {
    const week = buildWeek(WED_MAY_6, 0);
    expect(todayIndex(week, WED_MAY_6)).toBe(3); // Wednesday is index 3
  });

  it("returns -1 when today is outside the week (offset != 0)", () => {
    const nextWeek = buildWeek(WED_MAY_6, 1);
    expect(todayIndex(nextWeek, WED_MAY_6)).toBe(-1);
  });
});

describe("weekRangeLabel", () => {
  it("formats both endpoints inside the same month", () => {
    const week = buildWeek(WED_MAY_6, 0);
    expect(weekRangeLabel(week)).toBe("May 3 – 9, 2026");
  });

  it("spells both months when the week spans a boundary", () => {
    // Apr 26 — May 2, 2026
    const week = buildWeek(WED_MAY_6, -1);
    expect(weekRangeLabel(week)).toBe("Apr 26 – May 2, 2026");
  });
});

describe("weekEyebrow", () => {
  it("returns an uppercase eyebrow keyed off the week start", () => {
    expect(weekEyebrow(SUN_MAY_3)).toBe("WEEK OF MAY 3, 2026");
  });
});
