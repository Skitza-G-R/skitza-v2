import { describe, expect, it } from "vitest";

import {
  artistGreeting,
  formatArtistDateTime,
  formatArtistTimeRange,
  isSameArtistDay,
} from "../home-timezone";

describe("artist Home timezone labels", () => {
  it("uses the saved IANA timezone for the greeting", () => {
    const now = new Date("2026-07-30T04:00:00.000Z");
    expect(artistGreeting(now, "Gili", "Asia/Jerusalem")).toBe("Good morning, Gili.");
    expect(artistGreeting(now, "Gili", "America/Los_Angeles")).toBe("Good evening, Gili.");
  });

  it("compares calendar days in the artist timezone", () => {
    const beforeMidnightUtc = new Date("2026-07-30T21:30:00.000Z");
    const afterMidnightUtc = new Date("2026-07-31T01:00:00.000Z");
    expect(isSameArtistDay(beforeMidnightUtc, afterMidnightUtc, "Asia/Jerusalem")).toBe(true);
    expect(isSameArtistDay(beforeMidnightUtc, afterMidnightUtc, "UTC")).toBe(false);
  });

  it("formats session labels in the artist timezone", () => {
    const start = new Date("2026-07-30T12:30:00.000Z");
    expect(formatArtistTimeRange(start, 90, "Asia/Jerusalem")).toBe("15:30–17:00");
    expect(formatArtistDateTime(start, "Asia/Jerusalem")).toContain("3:30 PM");
  });
});
