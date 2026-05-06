import { describe, expect, it } from "vitest";

import {
  producerGradient,
  producerHue,
  producerInitials,
} from "../producer-color";

describe("producerInitials", () => {
  it("uppercases first chars of the first two words", () => {
    expect(producerInitials("Gili Studio")).toBe("GS");
    expect(producerInitials("Ravid Mix Room")).toBe("RM");
  });

  it("uses the first two characters when only one word", () => {
    expect(producerInitials("Gili")).toBe("GI");
    expect(producerInitials("ab")).toBe("AB");
  });

  it("trims and ignores extra whitespace", () => {
    expect(producerInitials("  Gili   Studio  ")).toBe("GS");
  });

  it("falls back to ?? for empty input", () => {
    expect(producerInitials("")).toBe("??");
    expect(producerInitials("   ")).toBe("??");
  });

  it("handles single-character single word without crashing", () => {
    expect(producerInitials("X")).toBe("X");
  });
});

describe("producerHue", () => {
  it("returns a value in [0, 360)", () => {
    for (const name of ["Gili Studio", "A", "x".repeat(64), "ñé"]) {
      const h = producerHue(name);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("is deterministic for the same input", () => {
    expect(producerHue("Gili Studio")).toBe(producerHue("Gili Studio"));
    expect(producerHue("Ravid")).toBe(producerHue("Ravid"));
  });

  it("differentiates similar names", () => {
    // Not a strong claim, just guarding against a degenerate hash that
    // collapses everything to 0 — these specific names should diverge.
    expect(producerHue("Gili Studio")).not.toBe(producerHue("Ravid Mix Room"));
  });
});

describe("producerGradient", () => {
  it("returns a CSS linear-gradient with two oklch stops", () => {
    const css = producerGradient("Gili Studio");
    expect(css).toMatch(/^linear-gradient\(135deg,\s*oklch\([^)]+\),\s*oklch\([^)]+\)\)$/);
  });

  it("is deterministic for the same input", () => {
    expect(producerGradient("Mira Sound")).toBe(producerGradient("Mira Sound"));
  });
});
