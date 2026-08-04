import { describe, expect, it } from "vitest";

import {
  formatGmtClockTime,
  formatResolvedTimeZoneLabel,
  formatTimeZoneSettingLabel,
} from "./timezone-display";

describe("shared GMT timezone display", () => {
  const instant = new Date("2026-01-15T12:30:00.000Z");

  it("uses the same GMT wording for Artist and Producer clocks", () => {
    const artistClock = formatGmtClockTime(instant, "UTC", "en-US");
    const producerClock = formatResolvedTimeZoneLabel("UTC", instant);

    expect(artistClock).toBe("12:30 PM GMT");
    expect(producerClock).toBe("UTC · GMT");
    expect(artistClock.endsWith(producerClock.split(" · ")[1] ?? "")).toBe(true);
  });

  it("keeps the exact instant and applies the requested IANA timezone", () => {
    expect(formatGmtClockTime(instant, "Asia/Jerusalem", "en-US")).toBe(
      "2:30 PM GMT+2",
    );
    expect(instant.toISOString()).toBe("2026-01-15T12:30:00.000Z");
  });

  it("shows GMT in Settings while preserving UTC as the stored value", () => {
    expect(formatTimeZoneSettingLabel("UTC")).toBe("GMT");
    expect(formatTimeZoneSettingLabel("America/New_York")).toBe("America/New York");
  });
});
