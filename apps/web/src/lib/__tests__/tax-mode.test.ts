import { describe, expect, it } from "vitest";

import {
  TAX_MODES,
  applyTaxToCents,
  coerceTaxMode,
  isTaxMode,
  taxCheckoutMultiplier,
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
    expect(taxModeFootnote("tax_added", 18)).toBe("+ 18% tax at checkout");
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

describe("taxCheckoutMultiplier", () => {
  it("returns 1 for tax_free + tax_included (no math change)", () => {
    expect(taxCheckoutMultiplier("tax_free", 18)).toBe(1);
    expect(taxCheckoutMultiplier("tax_included", 18)).toBe(1);
  });
  it("returns 1 + rate/100 for tax_added", () => {
    expect(taxCheckoutMultiplier("tax_added", 0)).toBe(1);
    expect(taxCheckoutMultiplier("tax_added", 18)).toBe(1.18);
    expect(taxCheckoutMultiplier("tax_added", 20)).toBe(1.2);
  });
  it("clamps negative + > 100 rates defensively", () => {
    expect(taxCheckoutMultiplier("tax_added", -5)).toBe(1);
    expect(taxCheckoutMultiplier("tax_added", 200)).toBe(2);
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
    expect(applyTaxToCents(0, "tax_added", 18)).toBe(0);
  });
});
