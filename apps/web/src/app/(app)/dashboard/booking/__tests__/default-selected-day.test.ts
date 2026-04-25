import { describe, it, expect } from "vitest";

import { defaultSelectedDay } from "../availability-editor";

// `defaultSelectedDay` picks which weekday tab the AvailabilityEditor
// lands on when it first mounts. Producers expect the tab they're
// "in" — today, if today has hours; otherwise the first day with
// hours; otherwise just today (so the empty state still feels like
// "you're looking at today and it's closed").

describe("defaultSelectedDay", () => {
  it("returns today's weekday when today has windows configured", () => {
    const draft = {
      0: [],
      1: [{ id: "blk-1", startMin: 600, endMin: 720 }], // Monday has hours
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };
    expect(defaultSelectedDay(draft, 1)).toBe(1); // today = Monday → land on Monday
  });

  it("falls back to the first weekday with windows when today is empty", () => {
    const draft = {
      0: [],
      1: [], // Monday empty
      2: [],
      3: [{ id: "blk-1", startMin: 600, endMin: 720 }], // Wed has hours
      4: [],
      5: [{ id: "blk-2", startMin: 540, endMin: 660 }], // Fri has hours
      6: [],
    };
    // today = Mon, Mon empty, walk weekday list (which starts at Mon)
    // and land on first non-empty day: Wed (3).
    expect(defaultSelectedDay(draft, 1)).toBe(3);
  });

  it("falls back to today when every day is empty", () => {
    const draft = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    // No configured day to land on — show today's empty state so the
    // CTA ("Add a window to open Tue") matches what the producer
    // probably wants to do first.
    expect(defaultSelectedDay(draft, 2)).toBe(2);
  });

  it("handles Sunday (todayDow=0) consistently with weekday days", () => {
    const draft = {
      0: [{ id: "blk-1", startMin: 600, endMin: 720 }], // Sun has hours
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };
    expect(defaultSelectedDay(draft, 0)).toBe(0); // Sun → land on Sun
  });
});
