import { describe, expect, it } from "vitest";
import { slugFromDisplayName, currencyFromCountry } from "./derive";

describe("slugFromDisplayName", () => {
  it("lowercases and dash-separates", () => {
    expect(slugFromDisplayName("DJ Smith", "8f2a")).toBe("dj-smith-8f2a");
  });

  it("strips diacritics + non-ASCII", () => {
    expect(slugFromDisplayName("  El Café   ", "0001")).toBe("el-cafe-0001");
  });

  it("falls back to 'studio' when displayName collapses to empty", () => {
    expect(slugFromDisplayName("////", "abcd")).toBe("studio-abcd");
  });

  it("collapses multiple separators", () => {
    expect(slugFromDisplayName("Foo  -- Bar!!", "1234")).toBe("foo-bar-1234");
  });

  it("truncates the body so total ≤ 48 chars", () => {
    const name = "A".repeat(60);
    const out = slugFromDisplayName(name, "ffff");
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.endsWith("-ffff")).toBe(true);
  });

  it("matches the slug regex", () => {
    const out = slugFromDisplayName("DJ Smith", "8f2a");
    expect(out).toMatch(/^[a-z0-9-]{3,48}$/);
  });
});

describe("currencyFromCountry", () => {
  it.each([
    ["US", "USD"],
    ["CA", "USD"],
    ["AU", "USD"],
    ["NZ", "USD"],
    ["GB", "GBP"],
    ["UK", "GBP"],
    ["IL", "ILS"],
    ["DE", "EUR"],
    ["FR", "EUR"],
    ["NL", "EUR"],
    ["IE", "EUR"],
    ["ES", "EUR"],
    ["JP", "USD"],
    ["CN", "USD"],
    ["BR", "USD"],
  ])("maps %s → %s", (country, expected) => {
    expect(currencyFromCountry(country)).toBe(expected);
  });

  it("falls back to USD on null/undefined/empty", () => {
    expect(currencyFromCountry(null)).toBe("USD");
    expect(currencyFromCountry(undefined)).toBe("USD");
    expect(currencyFromCountry("")).toBe("USD");
  });
});
