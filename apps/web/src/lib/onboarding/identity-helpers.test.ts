import { describe, expect, it } from "vitest";

import {
  MONOGRAM_GRADIENTS,
  initialsFromName,
  isMonogramGradient,
  taglineWithinLimit,
  TAGLINE_MAX_LENGTH,
} from "./identity-helpers";

// Pure helpers for Step 1 (Identity / "Your hall"). All deterministic,
// no DB / network — same RSC-boundary discipline as the other step
// helpers so the page module can use these from either the server or
// client side without a "use client" hop.

describe("MONOGRAM_GRADIENTS", () => {
  it("has 6 gradient class names matching the redesign palette", () => {
    expect(MONOGRAM_GRADIENTS).toEqual([
      "grad-amber",
      "grad-rose",
      "grad-emerald",
      "grad-violet",
      "grad-indigo",
      "grad-slate",
    ]);
  });
});

describe("isMonogramGradient", () => {
  it("returns true for any of the 6 valid gradient class names", () => {
    for (const g of MONOGRAM_GRADIENTS) {
      expect(isMonogramGradient(g)).toBe(true);
    }
  });

  it("returns false for unknown values", () => {
    expect(isMonogramGradient("grad-cyan")).toBe(false);
    expect(isMonogramGradient("amber")).toBe(false);
    expect(isMonogramGradient("")).toBe(false);
    expect(isMonogramGradient("GRAD-AMBER")).toBe(false);
  });
});

describe("initialsFromName", () => {
  it("returns the first letter of the first two whitespace-separated words", () => {
    expect(initialsFromName("Yael Naim Studio")).toBe("YN");
    expect(initialsFromName("Ada Lovelace")).toBe("AL");
  });

  it("uppercases the result", () => {
    expect(initialsFromName("ada lovelace")).toBe("AL");
    expect(initialsFromName("éli Vlad")).toBe("ÉV");
  });

  it("handles single-word names by returning just one letter", () => {
    expect(initialsFromName("Skitza")).toBe("S");
    expect(initialsFromName("a")).toBe("A");
  });

  it("returns the placeholder 'YS' when input is empty / whitespace", () => {
    expect(initialsFromName("")).toBe("YS");
    expect(initialsFromName("   ")).toBe("YS");
    expect(initialsFromName("\t\n")).toBe("YS");
  });

  it("ignores extra whitespace + collapses multiple spaces", () => {
    expect(initialsFromName("  Yael    Naim   Studio  ")).toBe("YN");
  });

  it("ignores third+ words (max 2 initials, matches design)", () => {
    expect(initialsFromName("Ada Bell Lovelace Smith")).toBe("AB");
  });
});

describe("taglineWithinLimit", () => {
  it("TAGLINE_MAX_LENGTH is 80 characters (matches design + DB column intent)", () => {
    expect(TAGLINE_MAX_LENGTH).toBe(80);
  });

  it("returns true for empty / null / undefined (tagline is optional)", () => {
    expect(taglineWithinLimit("")).toBe(true);
    expect(taglineWithinLimit(null)).toBe(true);
    expect(taglineWithinLimit(undefined)).toBe(true);
  });

  it("returns true for strings up to TAGLINE_MAX_LENGTH chars", () => {
    expect(taglineWithinLimit("Short tagline")).toBe(true);
    expect(taglineWithinLimit("a".repeat(80))).toBe(true);
  });

  it("returns false when the tagline exceeds 80 chars", () => {
    expect(taglineWithinLimit("a".repeat(81))).toBe(false);
    expect(taglineWithinLimit("a".repeat(200))).toBe(false);
  });
});
