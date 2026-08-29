import { describe, expect, it } from "vitest";

import {
  formatCurrencyForEmail,
  formatSessionDatePartsForEmail,
  formatSessionLengthForEmail,
  formatSessionTimeForEmail,
} from "./format";

describe("formatSessionTimeForEmail", () => {
  it("renders the date in the producer's tz", () => {
    // 2026-04-18T19:30:00Z = 2026-04-18 12:30 PM in America/Los_Angeles.
    const out = formatSessionTimeForEmail(
      new Date("2026-04-18T19:30:00Z"),
      "America/Los_Angeles",
    );
    expect(out).toContain("Apr");
    expect(out).toContain("18");
    expect(out).toContain("12:30");
  });

  it("falls back to UTC when the timezone is invalid", () => {
    // Should not throw.
    const out = formatSessionTimeForEmail(
      new Date("2026-04-18T19:30:00Z"),
      "Not/A_Real_Zone",
    );
    expect(out).toContain("Apr");
    expect(out).toContain("18");
  });
});

describe("formatCurrencyForEmail", () => {
  it("formats USD cents as a dollar string", () => {
    expect(formatCurrencyForEmail(50000, "USD")).toContain("500");
    expect(formatCurrencyForEmail(50000, "USD")).toContain("$");
  });

  it("formats other ISO codes", () => {
    const out = formatCurrencyForEmail(12345, "EUR");
    expect(out).toMatch(/123/);
  });

  it("returns em-dash for invalid amounts", () => {
    expect(formatCurrencyForEmail(Number.NaN, "USD")).toBe("—");
    expect(formatCurrencyForEmail(-1, "USD")).toBe("—");
  });

  it("falls back to bare code when ISO is unknown", () => {
    const out = formatCurrencyForEmail(12300, "ZZZ");
    expect(out).toMatch(/123\.00/);
  });
});

describe("formatSessionDatePartsForEmail", () => {
  it("splits the instant into weekday, date and time in the producer's tz", () => {
    // 2026-08-30T11:34:00Z = 2:34 PM in Asia/Jerusalem (UTC+3).
    const out = formatSessionDatePartsForEmail(
      new Date("2026-08-30T11:34:00Z"),
      "Asia/Jerusalem",
    );
    expect(out.weekday).toBe("Sunday");
    expect(out.date).toBe("August 30, 2026");
    expect(out.time).toBe("2:34 PM");
  });

  it("can land on a different calendar day than UTC", () => {
    // 23:30 UTC is already the next morning in Tokyo.
    const out = formatSessionDatePartsForEmail(new Date("2026-08-30T23:30:00Z"), "Asia/Tokyo");
    expect(out.weekday).toBe("Monday");
    expect(out.date).toBe("August 31, 2026");
  });

  it("falls back to UTC on an unknown zone rather than throwing", () => {
    const out = formatSessionDatePartsForEmail(new Date("2026-08-30T11:34:00Z"), "Not/AZone");
    expect(out.time).toBe("11:34 AM");
    expect(out.date).toBe("August 30, 2026");
  });
});

describe("formatSessionLengthForEmail", () => {
  it("renders whole hours", () => {
    expect(formatSessionLengthForEmail(120)).toBe("2 hours");
    expect(formatSessionLengthForEmail(60)).toBe("1 hour");
  });

  it("renders a mixed length", () => {
    expect(formatSessionLengthForEmail(90)).toBe("1 hour 30 min");
  });

  it("renders sub-hour lengths as minutes", () => {
    expect(formatSessionLengthForEmail(45)).toBe("45 min");
  });

  it("returns null when there is nothing to show, so the row is dropped", () => {
    // A pure-deliverable purchase has no studio time at all.
    expect(formatSessionLengthForEmail(0)).toBeNull();
    expect(formatSessionLengthForEmail(-30)).toBeNull();
    expect(formatSessionLengthForEmail(Number.NaN)).toBeNull();
  });
});
