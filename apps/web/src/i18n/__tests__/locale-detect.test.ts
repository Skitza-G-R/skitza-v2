import { describe, expect, it } from "vitest";

import { detectLocaleFromCountry } from "../locale-detect";

describe("detectLocaleFromCountry", () => {
  it("maps IL to he", () => {
    expect(detectLocaleFromCountry("IL")).toBe("he");
  });

  it("is case-insensitive on the country code", () => {
    expect(detectLocaleFromCountry("il")).toBe("he");
    expect(detectLocaleFromCountry("Il")).toBe("he");
  });

  it("returns the default locale (en) when country is undefined", () => {
    expect(detectLocaleFromCountry(undefined)).toBe("en");
  });

  it("returns the default locale (en) when country is null", () => {
    expect(detectLocaleFromCountry(null)).toBe("en");
  });

  it("returns the default locale (en) for unknown countries", () => {
    expect(detectLocaleFromCountry("ZZ")).toBe("en");
    expect(detectLocaleFromCountry("FR")).toBe("en");
  });

  it("falls back to default for Arabic-mapped countries until ar ships", () => {
    // AE/SA/EG/JO are pinned to "ar" in the table but `ar` isn't yet
    // a valid LOCALES entry — the type guard inside detectLocaleFromCountry
    // should drop us back to the default (en) rather than returning an
    // unshipped locale. When Arabic ships, these assertions flip.
    expect(detectLocaleFromCountry("AE")).toBe("en");
    expect(detectLocaleFromCountry("SA")).toBe("en");
    expect(detectLocaleFromCountry("EG")).toBe("en");
    expect(detectLocaleFromCountry("JO")).toBe("en");
  });

  it("returns default for an empty-string country", () => {
    expect(detectLocaleFromCountry("")).toBe("en");
  });
});
