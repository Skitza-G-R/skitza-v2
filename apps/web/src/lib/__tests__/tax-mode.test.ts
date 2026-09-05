import { describe, expect, it } from "vitest";

import {
  TAX_MODES,
  applyTaxToCents,
  subtotalCentsFromTotal,
  coerceTaxMode,
  isTaxMode,
  taxTotalMultiplier,
  taxModeFootnote,
  taxModeHint,
  taxModeOptionLabel,
  taxModePricingNote,
} from "../tax-mode";

describe("TAX_MODES", () => {
  it("lists exactly three v2 modes (tax_free / tax_included / tax_added)", () => {
    expect([...TAX_MODES]).toEqual(["tax_free", "tax_included", "tax_added"]);
  });
});

describe("isTaxMode", () => {
  it("accepts each canonical mode string", () => {
    for (const mode of TAX_MODES) {
      expect(isTaxMode(mode)).toBe(true);
    }
  });
  it("rejects legacy values from before migration 0019", () => {
    expect(isTaxMode("none")).toBe(false);
    expect(isTaxMode("vat_included")).toBe(false);
    expect(isTaxMode("vat_exempt")).toBe(false);
  });
  it("rejects non-strings + close-but-wrong strings", () => {
    expect(isTaxMode(null)).toBe(false);
    expect(isTaxMode(undefined)).toBe(false);
    expect(isTaxMode(0)).toBe(false);
    expect(isTaxMode({})).toBe(false);
    expect(isTaxMode("TAX_FREE")).toBe(false);
  });
});

describe("coerceTaxMode", () => {
  it("returns canonical modes unchanged", () => {
    expect(coerceTaxMode("tax_free")).toBe("tax_free");
    expect(coerceTaxMode("tax_included")).toBe("tax_included");
    expect(coerceTaxMode("tax_added")).toBe("tax_added");
  });
  it("folds the legacy 'none' and 'vat_exempt' values into 'tax_free'", () => {
    expect(coerceTaxMode("none")).toBe("tax_free");
    expect(coerceTaxMode("vat_exempt")).toBe("tax_free");
  });
  it("maps legacy 'vat_included' to 'tax_included'", () => {
    expect(coerceTaxMode("vat_included")).toBe("tax_included");
  });
  it("collapses anything else to 'tax_free'", () => {
    expect(coerceTaxMode("nonsense")).toBe("tax_free");
    expect(coerceTaxMode(null)).toBe("tax_free");
    expect(coerceTaxMode(undefined)).toBe("tax_free");
  });
});

describe("taxModeOptionLabel", () => {
  it("returns a non-empty string for every mode", () => {
    for (const mode of TAX_MODES) {
      expect(taxModeOptionLabel(mode).length).toBeGreaterThan(0);
    }
  });
  it("uses short noun phrases without parens or em-dashes", () => {
    expect(taxModeOptionLabel("tax_free")).toBe("Tax-free");
    expect(taxModeOptionLabel("tax_included")).toBe("Tax included");
    expect(taxModeOptionLabel("tax_added")).toBe("Plus tax");
  });
});

describe("taxModeHint", () => {
  it("returns a sentence including the rate for the two rate-bearing modes", () => {
    expect(taxModeHint("tax_included", 18)).toMatch(/18%/);
    expect(taxModeHint("tax_added", 20)).toMatch(/20%/);
  });
  it("returns a hint without a rate for tax_free", () => {
    expect(taxModeHint("tax_free", 18)).not.toMatch(/%/);
  });
});

describe("taxModeFootnote", () => {
  it("returns the canonical short tag for tax_free", () => {
    expect(taxModeFootnote("tax_free", 18)).toBe("Tax-free");
  });
  it("interpolates the rate for tax_included", () => {
    expect(taxModeFootnote("tax_included", 18)).toBe("Includes 18% tax");
    expect(taxModeFootnote("tax_included", 20)).toBe("Includes 20% tax");
  });
  it("interpolates the rate for tax_added", () => {
    expect(taxModeFootnote("tax_added", 18)).toBe("+ 18% tax");
  });
});

describe("taxModePricingNote", () => {
  it("uses the pre-tax display for tax_free + tax_included", () => {
    expect(taxModePricingNote("tax_free", 18, "$100", "$118")).toMatch(/\$100/);
    expect(taxModePricingNote("tax_included", 18, "$100", "$118")).toMatch(
      /\$100/,
    );
  });
  it("uses the post-tax display for tax_added", () => {
    expect(taxModePricingNote("tax_added", 18, "$100", "$118")).toMatch(/\$118/);
  });
});

describe("taxTotalMultiplier", () => {
  it("returns 1 for tax_free + tax_included (no math change)", () => {
    expect(taxTotalMultiplier("tax_free", 18)).toBe(1);
    expect(taxTotalMultiplier("tax_included", 18)).toBe(1);
  });
  it("returns 1 + rate/100 for tax_added", () => {
    expect(taxTotalMultiplier("tax_added", 0)).toBe(1);
    expect(taxTotalMultiplier("tax_added", 18)).toBe(1.18);
    expect(taxTotalMultiplier("tax_added", 20)).toBe(1.2);
  });
  it("clamps negative + > 100 rates defensively", () => {
    expect(taxTotalMultiplier("tax_added", -5)).toBe(1);
    expect(taxTotalMultiplier("tax_added", 200)).toBe(2);
  });
});

describe("applyTaxToCents", () => {
  it("leaves cents unchanged for non-additive modes", () => {
    expect(applyTaxToCents(10_000, "tax_free", 18)).toBe(10_000);
    expect(applyTaxToCents(10_000, "tax_included", 18)).toBe(10_000);
  });
  it("multiplies by 1 + rate/100 and rounds to nearest cent for tax_added", () => {
    expect(applyTaxToCents(10_000, "tax_added", 18)).toBe(11_800);
    expect(applyTaxToCents(9_999, "tax_added", 18)).toBe(11_799); // 11798.82 → 11799
    expect(applyTaxToCents(3, "tax_added", 50)).toBe(5); // 1.5 cents tax → 2
    expect(applyTaxToCents(0, "tax_added", 18)).toBe(0);
  });

  it("fails closed for non-integer preview inputs instead of floating-point drift", () => {
    expect(applyTaxToCents(10_000.5, "tax_added", 18)).toBe(0);
    expect(applyTaxToCents(10_000, "tax_added", 18.5)).toBe(10_000);
  });
});

describe("subtotalCentsFromTotal", () => {
  it("returns the typed total unchanged for non-additive modes", () => {
    // tax_free has no tax line; tax_included already IS the total. In both the
    // producer's number is the subtotal the snapshot stores.
    expect(subtotalCentsFromTotal(500_000, "tax_free", 18)).toEqual({
      subtotalCents: 500_000,
      totalCents: 500_000,
      exact: true,
    });
    expect(subtotalCentsFromTotal(500_000, "tax_included", 17)).toEqual({
      subtotalCents: 500_000,
      totalCents: 500_000,
      exact: true,
    });
  });

  it("divides the tax back out for tax_added", () => {
    expect(subtotalCentsFromTotal(11_800, "tax_added", 18)).toEqual({
      subtotalCents: 10_000,
      totalCents: 11_800,
      exact: true,
    });
    // ₪5,000.00 at Israeli VAT — the example in SK-299.
    expect(subtotalCentsFromTotal(500_000, "tax_added", 17)).toEqual({
      subtotalCents: 427_350,
      totalCents: 500_000,
      exact: true,
    });
    expect(subtotalCentsFromTotal(0, "tax_added", 18)).toEqual({
      subtotalCents: 0,
      totalCents: 0,
      exact: true,
    });
  });

  it("is a true inverse of applyTaxToCents wherever a total is reachable", () => {
    for (const rate of [0, 5, 17, 18, 20, 23, 99]) {
      for (const subtotal of [1, 7, 99, 333, 10_000, 123_457, 999_999]) {
        const total = applyTaxToCents(subtotal, "tax_added", rate);
        const back = subtotalCentsFromTotal(total, "tax_added", rate);
        // Adding tax is strictly increasing, so the trip back is lossless.
        expect(back).toEqual({ subtotalCents: subtotal, totalCents: total, exact: true });
      }
    }
  });

  it("flags an everyday total no subtotal can produce", () => {
    // Not exotic: at 17% VAT added on top, about one in seven whole-shekel
    // totals has no subtotal behind it. ₪1.00 is one — 85 rounds up to 99 and
    // 86 to 101, so 100 is skipped. The lower one wins and `exact` says so.
    expect(subtotalCentsFromTotal(100, "tax_added", 17)).toEqual({
      subtotalCents: 85,
      totalCents: 99,
      exact: false,
    });
    // Every reachable total still reports exact, so the flag stays meaningful.
    expect(subtotalCentsFromTotal(99, "tax_added", 17).exact).toBe(true);
  });

  it("flags a total no subtotal can produce, and never charges above it", () => {
    // At 100% every total is even, so 5 is unreachable. 2 → 4 and 3 → 6 are
    // equally close; the lower one wins so the artist is never billed more
    // than the producer typed.
    expect(subtotalCentsFromTotal(5, "tax_added", 100)).toEqual({
      subtotalCents: 2,
      totalCents: 4,
      exact: false,
    });
  });

  it("fails closed on inputs applyTaxToCents would reject", () => {
    expect(subtotalCentsFromTotal(10_000.5, "tax_added", 18).subtotalCents).toBe(0);
    expect(subtotalCentsFromTotal(-1, "tax_added", 18).subtotalCents).toBe(0);
    // A fractional rate is not supported, exactly as applyTaxToCents treats it.
    expect(subtotalCentsFromTotal(11_800, "tax_added", 18.5)).toEqual({
      subtotalCents: 11_800,
      totalCents: 11_800,
      exact: true,
    });
  });
});
