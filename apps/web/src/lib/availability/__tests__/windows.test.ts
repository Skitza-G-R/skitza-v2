import { describe, expect, it } from "vitest";

import {
  DAY_END_MIN,
  MAX_WINDOWS_PER_DAY,
  MIN_WINDOW_MINUTES,
  dayWindowsIssueMessage,
  findDayWindowsIssue,
  findWeekBlocksIssues,
  nextWindowSlot,
} from "../windows";

// SK-264 — one validation source for the onboarding step, the Calendar
// Availability tab, and the booking router. Before this module the three
// surfaces disagreed (3 windows vs unlimited vs 35 total) and invalid
// drafts surfaced only as an unreadable server error.

describe("availability window constants", () => {
  it("pins the shared limits", () => {
    expect(MAX_WINDOWS_PER_DAY).toBe(5);
    expect(MIN_WINDOW_MINUTES).toBe(30);
    expect(DAY_END_MIN).toBe(24 * 60);
  });
});

describe("findDayWindowsIssue", () => {
  it("accepts an empty day", () => {
    expect(findDayWindowsIssue([])).toBeNull();
  });

  it("accepts a single valid window", () => {
    expect(findDayWindowsIssue([{ startMin: 600, endMin: 840 }])).toBeNull();
  });

  it("accepts back-to-back windows that only touch", () => {
    expect(
      findDayWindowsIssue([
        { startMin: 600, endMin: 840 },
        { startMin: 840, endMin: 1080 },
      ]),
    ).toBeNull();
  });

  it("flags a window whose end equals its start", () => {
    expect(findDayWindowsIssue([{ startMin: 600, endMin: 600 }])).toBe("start_after_end");
  });

  it("flags a window whose end is before its start", () => {
    expect(findDayWindowsIssue([{ startMin: 1320, endMin: 360 }])).toBe("start_after_end");
  });

  it("flags a window shorter than 30 minutes", () => {
    expect(findDayWindowsIssue([{ startMin: 600, endMin: 610 }])).toBe("too_short");
  });

  it("flags overlapping windows", () => {
    expect(
      findDayWindowsIssue([
        { startMin: 600, endMin: 840 },
        { startMin: 700, endMin: 900 },
      ]),
    ).toBe("overlap");
  });

  it("flags duplicate windows as overlap", () => {
    expect(
      findDayWindowsIssue([
        { startMin: 1380, endMin: 1440 },
        { startMin: 1380, endMin: 1440 },
      ]),
    ).toBe("overlap");
  });

  it("flags overlap regardless of input order", () => {
    expect(
      findDayWindowsIssue([
        { startMin: 900, endMin: 1020 },
        { startMin: 600, endMin: 950 },
      ]),
    ).toBe("overlap");
  });

  it("accepts five windows and flags a sixth", () => {
    const five = [0, 1, 2, 3, 4].map((i) => ({
      startMin: i * 120,
      endMin: i * 120 + 60,
    }));
    expect(findDayWindowsIssue(five)).toBeNull();
    expect(findDayWindowsIssue([...five, { startMin: 600, endMin: 660 }])).toBe("too_many");
  });
});

describe("dayWindowsIssueMessage", () => {
  it("explains every issue in plain words", () => {
    expect(dayWindowsIssueMessage("start_after_end")).toBe("End time must be after start time.");
    expect(dayWindowsIssueMessage("too_short")).toBe("Each window needs at least 30 minutes.");
    expect(dayWindowsIssueMessage("overlap")).toBe("Time windows can't overlap.");
    expect(dayWindowsIssueMessage("too_many")).toBe("You can add up to 5 windows per day.");
  });
});

describe("nextWindowSlot", () => {
  it("suggests a 9:00–17:00 default for an empty day", () => {
    expect(nextWindowSlot([])).toEqual({ startMin: 540, endMin: 1020 });
  });

  it("appends a two-hour window after the last one", () => {
    expect(nextWindowSlot([{ startMin: 600, endMin: 840 }])).toEqual({
      startMin: 840,
      endMin: 960,
    });
  });

  it("caps the appended window at midnight", () => {
    expect(nextWindowSlot([{ startMin: 600, endMin: 1380 }])).toEqual({
      startMin: 1380,
      endMin: 1440,
    });
  });

  it("falls back to the first usable gap when the evening is full", () => {
    expect(
      nextWindowSlot([
        { startMin: 60, endMin: 120 },
        { startMin: 1380, endMin: 1440 },
      ]),
    ).toEqual({ startMin: 0, endMin: 60 });
  });

  it("uses the morning gap before the first window when nothing else fits", () => {
    expect(nextWindowSlot([{ startMin: 600, endMin: 1440 }])).toEqual({
      startMin: 0,
      endMin: 120,
    });
  });

  it("fits inside a gap that is exactly 30 minutes", () => {
    expect(
      nextWindowSlot([
        { startMin: 0, endMin: 870 },
        { startMin: 900, endMin: 1440 },
      ]),
    ).toEqual({ startMin: 870, endMin: 900 });
  });

  it("returns null when no gap can hold 30 minutes", () => {
    expect(nextWindowSlot([{ startMin: 0, endMin: 1440 }])).toBeNull();
    expect(
      nextWindowSlot([
        { startMin: 0, endMin: 700 },
        { startMin: 720, endMin: 1440 },
      ]),
    ).toBeNull();
  });

  it("treats a reversed window by its occupied span", () => {
    expect(nextWindowSlot([{ startMin: 1200, endMin: 600 }])).toEqual({
      startMin: 1200,
      endMin: 1320,
    });
  });
});

describe("findWeekBlocksIssues", () => {
  it("accepts a valid mixed week", () => {
    expect(
      findWeekBlocksIssues([
        { weekday: 0, startMin: 600, endMin: 840 },
        { weekday: 1, startMin: 600, endMin: 840 },
        { weekday: 1, startMin: 840, endMin: 1080 },
      ]),
    ).toEqual([]);
  });

  it("keeps the router's start-before-end message", () => {
    expect(findWeekBlocksIssues([{ weekday: 1, startMin: 840, endMin: 600 }])).toEqual([
      { index: 0, message: "start must be before end" },
    ]);
  });

  it("keeps the router's overlap message on the later block", () => {
    expect(
      findWeekBlocksIssues([
        { weekday: 1, startMin: 600, endMin: 900 },
        { weekday: 1, startMin: 840, endMin: 1080 },
      ]),
    ).toEqual([{ index: 1, message: "overlaps another block on the same weekday" }]);
  });

  it("allows identical times on different weekdays", () => {
    expect(
      findWeekBlocksIssues([
        { weekday: 1, startMin: 600, endMin: 900 },
        { weekday: 2, startMin: 600, endMin: 900 },
      ]),
    ).toEqual([]);
  });

  it("accepts five windows per day for the whole week", () => {
    const blocks = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let i = 0; i < 5; i++) {
        blocks.push({ weekday, startMin: i * 120, endMin: i * 120 + 60 });
      }
    }
    expect(findWeekBlocksIssues(blocks)).toEqual([]);
  });

  it("flags the sixth window on one weekday", () => {
    const blocks = [0, 1, 2, 3, 4, 5].map((i) => ({
      weekday: 1,
      startMin: i * 120,
      endMin: i * 120 + 60,
    }));
    expect(findWeekBlocksIssues(blocks)).toEqual([
      { index: 5, message: "more than 5 windows on the same weekday" },
    ]);
  });
});
