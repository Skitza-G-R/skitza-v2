import { describe, expect, it } from "vitest";

import {
  bpsToPercentageString,
  buildPaymentPlans,
  hasPaymentOption,
  MAX_PRODUCT_TAGLINE_LENGTH,
  paymentPlanFeasibilityError,
  percentageStringToBps,
  productCashPriceError,
  productTaglineError,
  royaltyTermsToDraft,
  seedPaymentSelection,
  seedStoreAgreementDraft,
  validateAgreementDraft,
  validateRoyaltyDraft,
} from "../product-editor-draft";

describe("product authoring commercial validation", () => {
  it("requires a short, single-line artist-facing tagline", () => {
    expect(productTaglineError(" ")).toMatch(/tagline artists will see/i);
    expect(productTaglineError("Line one\nLine two")).toMatch(/one line/i);
    expect(productTaglineError("x".repeat(MAX_PRODUCT_TAGLINE_LENGTH + 1))).toMatch(
      /characters or fewer/i,
    );
    expect(productTaglineError("Release-ready clarity.")).toBeNull();
  });

  it("rejects zero flat prices and every zero per-song tier", () => {
    expect(productCashPriceError({ price: 0, pricingModel: "flat", volumeTiers: [] })).toMatch(
      /cash price above 0/i,
    );
    expect(
      productCashPriceError({
        price: 100,
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 10_000 },
          { minQty: 5, pricePerUnitCents: 0 },
        ],
      }),
    ).toMatch(/Every per-song tier/i);
  });

  it("accepts positive flat and per-song cash prices", () => {
    expect(
      productCashPriceError({ price: 0.01, pricingModel: "flat", volumeTiers: [] }),
    ).toBeNull();
    expect(
      productCashPriceError({
        price: 100,
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 10_000 },
          { minQty: 5, pricePerUnitCents: 8_500 },
        ],
      }),
    ).toBeNull();
  });

  it("rejects duplicate thresholds and rates that increase with volume", () => {
    expect(
      productCashPriceError({
        price: 100,
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 10_000 },
          { minQty: 5, pricePerUnitCents: 9_000 },
          { minQty: 5, pricePerUnitCents: 8_000 },
        ],
      }),
    ).toMatch(/threshold.*unique/i);
    expect(
      productCashPriceError({
        price: 100,
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 10_000 },
          { minQty: 5, pricePerUnitCents: 11_000 },
        ],
      }),
    ).toMatch(/higher-volume tier cannot cost more/i);
  });

  it("allows equal or decreasing rates and validates the sorted one-song base", () => {
    expect(
      productCashPriceError({
        price: 100,
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 5, pricePerUnitCents: 10_000 },
          { minQty: 1, pricePerUnitCents: 10_000 },
        ],
      }),
    ).toBeNull();
    expect(
      productCashPriceError({
        price: 99,
        pricingModel: "per_song",
        volumeTiers: [{ minQty: 1, pricePerUnitCents: 10_000 }],
      }),
    ).toMatch(/starting price/i);
  });
});

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

  it("rejects a plan whose cheapest subtotal cannot fund one cent per installment", () => {
    expect(
      paymentPlanFeasibilityError({
        price: 0.03,
        pricingModel: "flat",
        volumeTiers: [],
        payment: {
          full: false,
          split50: false,
          monthly: true,
          monthlyInstallments: 4,
        },
      }),
    ).toMatch(/every payment is at least 1 cent/i);
    expect(
      paymentPlanFeasibilityError({
        price: 0.04,
        pricingModel: "flat",
        volumeTiers: [],
        payment: {
          full: true,
          split50: true,
          monthly: true,
          monthlyInstallments: 4,
        },
      }),
    ).toBeNull();
  });

  it("checks every discounted per-song tier opening subtotal", () => {
    expect(
      paymentPlanFeasibilityError({
        price: 1,
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 100 },
          { minQty: 2, pricePerUnitCents: 1 },
        ],
        payment: {
          full: false,
          split50: false,
          monthly: true,
          monthlyInstallments: 4,
        },
      }),
    ).toMatch(/every payment is at least 1 cent/i);
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
  it("allows an omitted agreement", () => {
    expect(validateAgreementDraft("none", "")).toBeNull();
  });

  it("requires bounded exact inline terms when selected", () => {
    expect(validateAgreementDraft("text", "   ")).toMatch(/Write the agreement/);
    expect(validateAgreementDraft("text", "x".repeat(20_001))).toMatch(/20,000/);
    expect(validateAgreementDraft("text", "Exact terms.")).toBeNull();
  });

  it("forces a legacy external link into inline replacement mode", () => {
    expect(
      seedStoreAgreementDraft("", "https://example.com/changeable-terms"),
    ).toEqual({
      agreementMode: "text",
      agreementText: "",
      requiresLegacyLinkReplacement: true,
    });
    expect(
      seedStoreAgreementDraft("Exact saved terms.", "https://example.com/old"),
    ).toEqual({
      agreementMode: "text",
      agreementText: "Exact saved terms.",
      requiresLegacyLinkReplacement: false,
    });
  });
});
