import { describe, expect, it } from "vitest";
import {
  currencyFromAcceptLanguage,
  currencyFromCountry,
  inferCurrency,
  slugFromDisplayName,
} from "./derive";

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

// Accept-Language fallback — added 2026-04-26 because the original
// `x-vercel-ip-country`-only path defaulted Israeli producers to USD
// when the geo header was missing in the request (preview environments,
// some proxy paths). Returns null when the language tag doesn't carry
// a clear currency signal so the caller can compose with other heuristics.
describe("currencyFromAcceptLanguage", () => {
  it.each([
    ["he-IL,he;q=0.9,en-US;q=0.8", "ILS"],
    ["he", "ILS"],
    ["en-GB,en;q=0.9", "GBP"],
    ["de-DE,de;q=0.9,en;q=0.8", "EUR"],
    ["fr-FR", "EUR"],
    ["es", "EUR"],
    ["it-IT,it;q=0.9", "EUR"],
    ["nl,en;q=0.9", "EUR"],
  ])("maps primary tag of %s → %s", (header, expected) => {
    expect(currencyFromAcceptLanguage(header)).toBe(expected);
  });

  it("returns null for empty/null/undefined", () => {
    expect(currencyFromAcceptLanguage(null)).toBeNull();
    expect(currencyFromAcceptLanguage(undefined)).toBeNull();
    expect(currencyFromAcceptLanguage("")).toBeNull();
  });

  it("returns null for non-mappable languages (e.g. en-US, ja, zh)", () => {
    // en-US doesn't disambiguate — could be a US producer or anyone with
    // English browser. Returning null lets the caller fall through to USD
    // rather than committing to a wrong inference.
    expect(currencyFromAcceptLanguage("en-US,en;q=0.9")).toBeNull();
    expect(currencyFromAcceptLanguage("ja-JP")).toBeNull();
    expect(currencyFromAcceptLanguage("zh-CN")).toBeNull();
    expect(currencyFromAcceptLanguage("ar-AE")).toBeNull();
  });

  it("trims whitespace + handles missing q-weights", () => {
    expect(currencyFromAcceptLanguage("  he-IL  ")).toBe("ILS");
    expect(currencyFromAcceptLanguage("de")).toBe("EUR");
  });
});

// Combined inference: country header is canonical (most specific),
// accept-language is fallback (next-best signal), USD is final fallback.
// This is the single helper completeStudio calls.
describe("inferCurrency", () => {
  it("prefers country header when present", () => {
    // Even if accept-language disagrees, country wins (it's the more
    // specific geo signal).
    expect(inferCurrency("US", "he-IL,he;q=0.9")).toBe("USD");
    expect(inferCurrency("DE", "en-US")).toBe("EUR");
  });

  it("falls back to accept-language when country is null/undefined/empty", () => {
    expect(inferCurrency(null, "he-IL")).toBe("ILS");
    expect(inferCurrency(undefined, "de-DE")).toBe("EUR");
    expect(inferCurrency("", "en-GB")).toBe("GBP");
  });

  it("falls back to USD when neither signal is informative", () => {
    expect(inferCurrency(null, null)).toBe("USD");
    expect(inferCurrency(null, "en-US")).toBe("USD");
    expect(inferCurrency("", "")).toBe("USD");
  });

  it("Israel-from-Hebrew-browser scenario (the bug we are fixing)", () => {
    // Producer in Israel browsing with Hebrew browser: country header
    // missing in some preview environments → must still infer ILS, not
    // default to USD.
    expect(inferCurrency(null, "he-IL,he;q=0.9,en;q=0.8")).toBe("ILS");
  });
});
