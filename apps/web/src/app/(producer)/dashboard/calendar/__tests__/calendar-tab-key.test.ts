import { describe, expect, it } from "vitest";

import {
  CALENDAR_TAB_KEYS,
  isCalendarTab,
  resolveCalendarTab,
} from "../calendar-tab-key";

// Producer Calendar redesign moves from 2 tabs (meetings, availability)
// to 3 tabs (schedule, sessions, availability) to match the locked design
// spec. The resolver tolerates legacy "meetings" links by mapping them
// to the new "schedule" surface — same content, new name — so deep links
// from older emails / bookmarks / Sentry breadcrumbs don't 404.

describe("CALENDAR_TAB_KEYS", () => {
  it("declares the three tabs in display order", () => {
    expect(CALENDAR_TAB_KEYS).toEqual([
      "schedule",
      "sessions",
      "availability",
    ]);
  });
});

describe("isCalendarTab", () => {
  it.each(["schedule", "sessions", "availability"])("accepts %s", (key) => {
    expect(isCalendarTab(key)).toBe(true);
  });

  it.each([undefined, "", "garbage", "Schedule", " schedule", "meetings"])(
    "rejects %p",
    (key) => {
      expect(isCalendarTab(key)).toBe(false);
    },
  );
});

describe("resolveCalendarTab", () => {
  it.each([
    ["schedule", "schedule"],
    ["sessions", "sessions"],
    ["availability", "availability"],
  ])("returns %p when raw is %p", (raw, expected) => {
    expect(resolveCalendarTab(raw)).toBe(expected);
  });

  it("defaults to schedule for undefined", () => {
    expect(resolveCalendarTab(undefined)).toBe("schedule");
  });

  it("defaults to schedule for unknown strings", () => {
    expect(resolveCalendarTab("garbage")).toBe("schedule");
    expect(resolveCalendarTab("")).toBe("schedule");
  });

  it("maps legacy ?tab=meetings to schedule (back-compat)", () => {
    expect(resolveCalendarTab("meetings")).toBe("schedule");
  });

  it("uses the first array entry when Next.js delivers searchParams as string[]", () => {
    expect(resolveCalendarTab(["sessions", "availability"])).toBe("sessions");
    expect(resolveCalendarTab(["garbage", "availability"])).toBe("schedule");
  });

  it("maps legacy meetings inside an array too", () => {
    expect(resolveCalendarTab(["meetings"])).toBe("schedule");
  });

  it("defaults to schedule for an empty array", () => {
    expect(resolveCalendarTab([])).toBe("schedule");
  });
});
