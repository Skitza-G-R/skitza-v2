import { describe, expect, it } from "vitest";

import {
  TAX_MODES,
  isTaxMode,
  taxModeFootnote,
  taxModeOptionLabel,
  taxModeOptionSubLabel,
} from "../tax-mode";

describe("TAX_MODES", () => {
  it("lists exactly three modes (v1)", () => {
    expect([...TAX_MODES]).toEqual(["none", "vat_included", "vat_exempt"]);
  });
});

describe("isTaxMode", () => {
  it("accepts each canonical mode string", () => {
    for (const mode of TAX_MODES) {
      expect(isTaxMode(mode)).toBe(true);
    }
  });
  it("rejects strings that look close but aren't members", () => {
    expect(isTaxMode("vat")).toBe(false);
    expect(isTaxMode("none ")).toBe(false);
    expect(isTaxMode("VAT_INCLUDED")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isTaxMode(null)).toBe(false);
    expect(isTaxMode(undefined)).toBe(false);
    expect(isTaxMode(0)).toBe(false);
    expect(isTaxMode({})).toBe(false);
  });
});

describe("taxModeOptionLabel", () => {
  it("returns a non-empty string for every mode", () => {
    for (const mode of TAX_MODES) {
      expect(taxModeOptionLabel(mode).length).toBeGreaterThan(0);
    }
  });
  it("mentions VAT in the IL-relevant modes", () => {
    expect(taxModeOptionLabel("vat_included")).toMatch(/VAT/);
    expect(taxModeOptionLabel("vat_exempt")).toMatch(/VAT/);
  });
  it("uses the Israeli term 'Osek Patur' on the exempt option", () => {
    expect(taxModeOptionLabel("vat_exempt")).toMatch(/osek patur/i);
  });
});

describe("taxModeOptionSubLabel", () => {
  it("returns a non-empty hint for every mode", () => {
    for (const mode of TAX_MODES) {
      expect(taxModeOptionSubLabel(mode).length).toBeGreaterThan(0);
    }
  });
});

describe("taxModeFootnote", () => {
  it("returns null for 'none' (no footnote rendered)", () => {
    expect(taxModeFootnote("none")).toBeNull();
  });
  it("returns the inclusive-VAT line for 'vat_included'", () => {
    expect(taxModeFootnote("vat_included")).toBe("Includes 18% VAT");
  });
  it("returns the Osek-Patur line for 'vat_exempt'", () => {
    expect(taxModeFootnote("vat_exempt")).toBe(
      "Exempt from VAT (Osek Patur)",
    );
  });
});
