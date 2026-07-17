import { describe, expect, it } from "vitest";

import {
  bpsToPercentageString,
  buildPaymentPlans,
  hasPaymentOption,
  percentageStringToBps,
  royaltyTermsToDraft,
  seedPaymentSelection,
  validateAgreementDraft,
  validateRoyaltyDraft,
} from "../product-editor-draft";

describe("product editor payment draft", () => {
  it("seeds every saved payment option", () => {
    const draft = seedPaymentSelection([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 7 },
    ]);

    expect(draft).toEqual({
      full: true,
      split50: true,
      monthly: true,
      monthlyInstallments: 7,
    });
  });

  it("builds full, split, then monthly in deterministic order", () => {
    expect(
      buildPaymentPlans({
        full: true,
        split50: true,
        monthly: true,
        monthlyInstallments: 6,
      }),
    ).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 6 },
    ]);
  });

  it("removes a deselected plan", () => {
    const seeded = seedPaymentSelection([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 4 },
    ]);

    expect(buildPaymentPlans({ ...seeded, split50: false })).toEqual([
      { kind: "full" },
      { kind: "monthly", installments: 4 },
    ]);
  });

  it("rejects monthly counts outside 2 through 12", () => {
    const base = {
      full: false,
      split50: false,
      monthly: true,
    };
    expect(() =>
      buildPaymentPlans({ ...base, monthlyInstallments: 1 }),
    ).toThrow(/2.*12/);
    expect(() =>
      buildPaymentPlans({ ...base, monthlyInstallments: 13 }),
    ).toThrow(/2.*12/);
    expect(
      buildPaymentPlans({ ...base, monthlyInstallments: 2 }),
    ).toEqual([{ kind: "monthly", installments: 2 }]);
    expect(
      buildPaymentPlans({ ...base, monthlyInstallments: 12 }),
    ).toEqual([{ kind: "monthly", installments: 12 }]);
  });

  it("rejects a genuinely empty selection", () => {
    expect(
      hasPaymentOption({
        full: false,
        split50: false,
        monthly: false,
        monthlyInstallments: 4,
      }),
    ).toBe(false);
  });
});

describe("royalty percentage conversions", () => {
  it("round-trips exact basis-point decimals", () => {
    expect(percentageStringToBps("0.01")).toBe(1);
    expect(percentageStringToBps("2.5")).toBe(250);
    expect(percentageStringToBps(".5")).toBe(50);
    expect(percentageStringToBps("12.50")).toBe(1250);
    expect(percentageStringToBps("100")).toBe(10000);

    expect(bpsToPercentageString(1)).toBe("0.01");
    expect(bpsToPercentageString(250)).toBe("2.5");
    expect(bpsToPercentageString(1250)).toBe("12.5");
    expect(bpsToPercentageString(10000)).toBe("100");
  });

  it("rejects zero, out-of-range, and sub-basis-point values", () => {
    expect(percentageStringToBps("0")).toBeNull();
    expect(percentageStringToBps("100.01")).toBeNull();
    expect(percentageStringToBps("2.555")).toBeNull();
    expect(percentageStringToBps("not a number")).toBeNull();
  });

  it("keeps legacy null terms safe while requiring explicit new-product choices", () => {
    const legacy = royaltyTermsToDraft(null);
    expect(legacy.masterMode).toBeNull();
    expect(legacy.compositionMode).toBeNull();
    expect(validateRoyaltyDraft(legacy, false)).toEqual({});
    expect(validateRoyaltyDraft(legacy, true)).toEqual({
      master: "Choose a master-rights option.",
      composition: "Choose a composition-rights option.",
    });
    expect(
      validateRoyaltyDraft({ ...legacy, notes: "New terms" }, false),
    ).toMatchObject({
      master: "Choose a master-rights option.",
      composition: "Choose a composition-rights option.",
    });
  });

  it("matches the server limits for collecting society and rights notes", () => {
    const base = {
      ...royaltyTermsToDraft(null),
      masterMode: "none" as const,
      compositionMode: "percentage" as const,
      compositionPercentage: "1",
    };
    expect(
      validateRoyaltyDraft(
        { ...base, collectingSociety: "x".repeat(201) },
        true,
      ).composition,
    ).toMatch(/200/);
    expect(
      validateRoyaltyDraft({ ...base, notes: "x".repeat(4_001) }, true)
        .notes,
    ).toMatch(/4,000/);
  });
});

describe("agreement validation", () => {
  it("allows an omitted agreement and valid HTTP(S) links", () => {
    expect(validateAgreementDraft("none", "", "")).toBeNull();
    expect(
      validateAgreementDraft("link", "https://example.com/terms", ""),
    ).toBeNull();
  });

  it("blocks empty, invalid-scheme, and empty-text selections before Review", () => {
    expect(validateAgreementDraft("link", "", "")).toMatch(/Enter a public/);
    expect(
      validateAgreementDraft("link", "javascript:alert(1)", ""),
    ).toMatch(/http:\/\//);
    expect(validateAgreementDraft("text", "", "   ")).toMatch(/Write the agreement/);
  });
});
