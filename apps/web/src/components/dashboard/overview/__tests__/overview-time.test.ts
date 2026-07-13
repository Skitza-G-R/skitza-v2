import { describe, expect, it } from "vitest";

import {
  dateKeyInTimeZone,
  formatDashboardDate,
  formatDashboardTime,
  greetingFor,
} from "../overview-time";

describe("producer-local overview time", () => {
  const nearMidnight = new Date("2026-07-12T22:30:00.000Z");

  it("uses the producer timezone for the calendar day and greeting", () => {
    expect(dateKeyInTimeZone(nearMidnight, "Asia/Jerusalem")).toBe("2026-07-13");
    expect(dateKeyInTimeZone(nearMidnight, "UTC")).toBe("2026-07-12");
    expect(greetingFor(nearMidnight, "Asia/Jerusalem")).toBe("Good morning");
    expect(greetingFor(nearMidnight, "America/New_York")).toBe("Good evening");
  });

  it("formats session and upload values in the producer timezone", () => {
    expect(formatDashboardTime(nearMidnight, "Asia/Jerusalem")).toBe("1:30 AM");
    expect(formatDashboardDate(nearMidnight, "Asia/Jerusalem")).toBe("Jul 13");
  });

  it("falls back to UTC for an invalid stored timezone", () => {
    expect(dateKeyInTimeZone(nearMidnight, "not/a-timezone")).toBe("2026-07-12");
    expect(greetingFor(nearMidnight, "not/a-timezone")).toBe("Good evening");
  });
});
