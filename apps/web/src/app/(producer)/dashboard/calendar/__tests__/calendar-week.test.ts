import { describe, expect, it } from "vitest";

import {
  buildWeek,
  isSameDay,
  todayIndex,
  weekEyebrow,
  weekRangeLabel,
} from "../calendar-week";

// Pure date math powering the Schedule tab's week navigation.
// Calendar days are UTC markers; instants are interpreted in the
// producer's saved timezone.

const TIME_ZONE = "Asia/Jerusalem";
const SUN_MAY_3 = new Date("2026-05-03T09:30:00.000Z");
const WED_MAY_6 = new Date("2026-05-06T11:00:00.000Z");
const SAT_MAY_9 = new Date("2026-05-09T20:59:00.000Z");
const SUN_MAY_10 = new Date("2026-05-09T21:00:00.000Z");

describe("buildWeek", () => {
  it("returns 7 days starting on Sunday for offset 0", () => {
    const week = buildWeek(WED_MAY_6, 0, TIME_ZONE);
    expect(week).toHaveLength(7);
    expect(week[0]?.getUTCDay()).toBe(0);
    expect(week[0]?.getUTCDate()).toBe(3);
    expect(week[6]?.getUTCDay()).toBe(6);
    expect(week[6]?.getUTCDate()).toBe(9);
  });

  it("offset +1 advances by one week", () => {
    const week = buildWeek(WED_MAY_6, 1, TIME_ZONE);
    expect(week[0]?.getUTCDate()).toBe(10);
    expect(week[6]?.getUTCDate()).toBe(16);
  });

  it("offset -1 retreats by one week", () => {
    const week = buildWeek(WED_MAY_6, -1, TIME_ZONE);
    expect(week[0]?.getUTCDate()).toBe(26); // Apr 26
    expect(week[0]?.getUTCMonth()).toBe(3); // April (0-indexed)
    expect(week[6]?.getUTCDate()).toBe(2); // May 2
    expect(week[6]?.getUTCMonth()).toBe(4);
  });

  it("zeros the time on every returned day so isSameDay comparisons match", () => {
    const week = buildWeek(WED_MAY_6, 0, TIME_ZONE);
    for (const d of week) {
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });
});

describe("isSameDay", () => {
  it("matches same calendar day across times", () => {
    expect(
      isSameDay(
        new Date("2026-05-03T00:00:00.000Z"),
        new Date("2026-05-03T20:59:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(true);
  });

  it("rejects different days", () => {
    expect(isSameDay(SAT_MAY_9, SUN_MAY_10, TIME_ZONE)).toBe(false);
  });

  it("rejects same day-of-month in different months", () => {
    expect(
      isSameDay(
        new Date("2026-05-03T00:00:00.000Z"),
        new Date("2026-06-03T09:00:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(false);
  });
});

describe("todayIndex", () => {
  it("returns the index when today falls inside the week", () => {
    const week = buildWeek(WED_MAY_6, 0, TIME_ZONE);
    expect(todayIndex(week, WED_MAY_6, TIME_ZONE)).toBe(3);
  });

  it("returns -1 when today is outside the week (offset != 0)", () => {
    const nextWeek = buildWeek(WED_MAY_6, 1, TIME_ZONE);
    expect(todayIndex(nextWeek, WED_MAY_6, TIME_ZONE)).toBe(-1);
  });
});

describe("weekRangeLabel", () => {
  it("formats both endpoints inside the same month", () => {
    const week = buildWeek(WED_MAY_6, 0, TIME_ZONE);
    expect(weekRangeLabel(week)).toBe("May 3 – 9, 2026");
  });

  it("spells both months when the week spans a boundary", () => {
    // Apr 26 — May 2, 2026
    const week = buildWeek(WED_MAY_6, -1, TIME_ZONE);
    expect(weekRangeLabel(week)).toBe("Apr 26 – May 2, 2026");
  });
});

describe("weekEyebrow", () => {
  it("returns an uppercase eyebrow keyed off the week start", () => {
    const week = buildWeek(SUN_MAY_3, 0, TIME_ZONE);
    expect(weekEyebrow(week[0] ?? SUN_MAY_3)).toBe("WEEK OF MAY 3, 2026");
  });
});
