// Pure tests for the design-test Calendar tab's availability-editor
// state ↔ booking.availability.setWeek block format conversion.
//
// hoursByDay (UI shape) is one row per weekday with on/off + HH:MM
// start + HH:MM end. The router's AvailabilityWeekInput is an array
// of {weekday, startMin, endMin} blocks. Helpers convert both ways
// so the editor can pre-populate from server data and submit back.

import { describe, expect, it } from "vitest";

import {
  blocksToHoursByDay,
  hoursByDayToBlocks,
  parseHHMM,
} from "../availability-shape";

describe("parseHHMM", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("09:00")).toBe(540);
    expect(parseHHMM("10:30")).toBe(630);
    expect(parseHHMM("18:00")).toBe(1080);
    expect(parseHHMM("23:30")).toBe(1410);
    expect(parseHHMM("24:00")).toBe(1440);
  });

  it("handles malformed input by returning 0", () => {
    expect(parseHHMM("")).toBe(0);
    expect(parseHHMM("garbage")).toBe(0);
  });
});

describe("hoursByDayToBlocks", () => {
  it("skips days with on=false", () => {
    const blocks = hoursByDayToBlocks({
      Sun: { on: false, start: "10:00", end: "18:00" },
      Mon: { on: true, start: "10:00", end: "20:00" },
      Tue: { on: false, start: "10:00", end: "18:00" },
      Wed: { on: false, start: "10:00", end: "18:00" },
      Thu: { on: false, start: "10:00", end: "18:00" },
      Fri: { on: false, start: "10:00", end: "18:00" },
      Sat: { on: false, start: "10:00", end: "18:00" },
    });
    expect(blocks).toEqual([{ weekday: 1, startMin: 600, endMin: 1200 }]);
  });

  it("maps Sun=0..Sat=6", () => {
    const blocks = hoursByDayToBlocks({
      Sun: { on: true, start: "09:00", end: "10:00" },
      Mon: { on: true, start: "09:00", end: "10:00" },
      Tue: { on: true, start: "09:00", end: "10:00" },
      Wed: { on: true, start: "09:00", end: "10:00" },
      Thu: { on: true, start: "09:00", end: "10:00" },
      Fri: { on: true, start: "09:00", end: "10:00" },
      Sat: { on: true, start: "09:00", end: "10:00" },
    });
    expect(blocks.map((b) => b.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("drops blocks where start >= end (router would reject anyway)", () => {
    const blocks = hoursByDayToBlocks({
      Sun: { on: false, start: "10:00", end: "18:00" },
      Mon: { on: true, start: "20:00", end: "10:00" }, // invalid: end before start
      Tue: { on: true, start: "10:00", end: "10:00" }, // invalid: zero-length
      Wed: { on: true, start: "10:00", end: "11:00" }, // valid
      Thu: { on: false, start: "10:00", end: "18:00" },
      Fri: { on: false, start: "10:00", end: "18:00" },
      Sat: { on: false, start: "10:00", end: "18:00" },
    });
    expect(blocks).toEqual([{ weekday: 3, startMin: 600, endMin: 660 }]);
  });
});

describe("blocksToHoursByDay", () => {
  it("returns all-off when blocks is empty", () => {
    const out = blocksToHoursByDay([]);
    expect(out.Sun.on).toBe(false);
    expect(out.Mon.on).toBe(false);
    expect(out.Sat.on).toBe(false);
  });

  it("populates a day from its first block", () => {
    const out = blocksToHoursByDay([
      { weekday: 1, startMin: 600, endMin: 1200 }, // Mon 10:00-20:00
      { weekday: 5, startMin: 600, endMin: 900 }, // Fri 10:00-15:00
    ]);
    expect(out.Mon).toEqual({ on: true, start: "10:00", end: "20:00" });
    expect(out.Fri).toEqual({ on: true, start: "10:00", end: "15:00" });
    // Days with no block stay off, but with sane defaults so the
    // toggle-on flow doesn't immediately submit invalid data.
    expect(out.Sun.on).toBe(false);
    expect(out.Sun.start).toBe("10:00");
    expect(out.Sun.end).toBe("18:00");
  });

  it("when a day has multiple blocks, takes the earliest start through the latest end", () => {
    // The mockup's UI is one range per day, so multi-block weekdays
    // (a producer who set two windows server-side) collapse into the
    // outer envelope. Saving overwrites with a single block — the
    // user is told this trade-off via the editor's mockup label.
    const out = blocksToHoursByDay([
      { weekday: 1, startMin: 600, endMin: 720 }, // Mon 10:00-12:00
      { weekday: 1, startMin: 840, endMin: 1200 }, // Mon 14:00-20:00
    ]);
    expect(out.Mon).toEqual({ on: true, start: "10:00", end: "20:00" });
  });
});
