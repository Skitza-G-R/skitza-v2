import { describe, expect, it } from "vitest";

import { getWeekDots, type WeekDot } from "../this-week-strip";

// Round 3 of the artist-home polish pass.
//
// The right rail on lg+ shows a tiny "This week" strip — 7 mini-dots
// Mon → Sun, filled when the artist has at least one session that
// day. Data comes from the upcomingSessions array on artist.home.
//
// `getWeekDots` is the pure helper: takes today + the upcoming
// sessions, returns a 7-element array describing each weekday of
// the current week (Mon-based to match Skitza's calendar week).
// Each dot knows its day label, ISO date, count of sessions, and
// whether it's "today."

const monday = new Date("2026-05-18T09:00:00Z"); // a known Monday
const wednesday = new Date("2026-05-20T14:00:00Z");
const friday = new Date("2026-05-22T16:00:00Z");

// Helper to build a session-like input. The helper only reads
// startsAt; the rest of the shape is irrelevant.
const session = (startsAt: Date) => ({ startsAt });

describe("getWeekDots", () => {
  it("returns 7 dots Monday → Sunday", () => {
    const result: WeekDot[] = getWeekDots([], monday);
    expect(result).toHaveLength(7);
    expect(result.map((d) => d.dayLabel)).toEqual([
      "M",
      "T",
      "W",
      "T",
      "F",
      "S",
      "S",
    ]);
  });

  it("counts sessions per day for the current week", () => {
    const sessions = [session(wednesday), session(friday), session(friday)];
    const result = getWeekDots(sessions, monday);

    // Monday-based: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
    const [mon, , wed, , fri] = result;
    expect(wed?.count).toBe(1);
    expect(fri?.count).toBe(2);
    expect(mon?.count).toBe(0);
  });

  it("flags the dot for `today`", () => {
    const result = getWeekDots([], wednesday);
    // Wednesday should be marked isToday
    const todayDot = result.find((d) => d.isToday);
    expect(todayDot).toBeDefined();
    expect(todayDot?.dayLabel).toBe("W");
  });

  it("ignores sessions outside this week", () => {
    const nextMonday = new Date("2026-05-25T10:00:00Z");
    const sessions = [session(nextMonday)];
    const result = getWeekDots(sessions, monday);
    expect(result.every((d) => d.count === 0)).toBe(true);
  });

  it("handles Sunday-anchored `today` correctly (week starts on Mon)", () => {
    // Sunday May 24 is the last day of the May 18-24 week, NOT the
    // first day of the next week. The Mon for that week is May 18.
    const sunday = new Date("2026-05-24T12:00:00Z");
    const result = getWeekDots([], sunday);
    const last = result[6];
    expect(last?.isToday).toBe(true);
    expect(last?.dayLabel).toBe("S");
  });
});
