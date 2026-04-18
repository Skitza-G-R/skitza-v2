import { describe, expect, it } from "vitest";

import { formatCurrencyForEmail, formatSessionTimeForEmail } from "./format";

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
