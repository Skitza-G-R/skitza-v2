import { describe, expect, it } from "vitest";

import { encodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";

import { clampTaxRatePct, toSimulationInput, type CompletionProductRow } from "../simulation-input";

const PRODUCT: CompletionProductRow = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "Full production",
  description: encodeDescription({
    tagline: "Idea to master.",
    contractText: "Producer credit in metadata.",
    revisions: 3,
    unlimitedRevisions: false,
  }),
  priceCents: 500000,
  currency: "ILS",
  pricingModel: "flat",
  volumeTiers: null,
  durationMin: 120,
  sessionCount: 4,
  deliverables: ["Production", "Mix", "Master"],
  paymentPlans: [{ kind: "split_50_50" }],
  royaltyTerms: null,
  agreementText: null,
};

describe("toSimulationInput", () => {
  it("maps the live product, decoded description, and producer profile", () => {
    const result = toSimulationInput({
      product: PRODUCT,
      profile: {
        displayName: "North Room",
        taxMode: "tax_added",
        taxRatePct: 17.4,
        logoUrl: "https://example.invalid/logo.png",
        timezone: "Europe/Berlin",
      },
      paymentInstructions: { bitPhone: "052-123-4567" },
    });

    expect(result.producerName).toBe("North Room");
    expect(result.producerLogoUrl).toBe("https://example.invalid/logo.png");
    expect(result.timezone).toBe("Europe/Berlin");
    expect(result.product.tagline).toBe("Idea to master.");
    expect(result.product.agreementText).toBe("Producer credit in metadata.");
    expect(result.product.revisions).toBe(3);
    expect(result.product.pricingModel).toBe("flat");
    expect(result.product.volumeTiers).toEqual([]);
    expect(result.product.deliverables).toEqual(["Production", "Mix", "Master"]);
    expect(result.taxMode).toBe("tax_added");
    expect(result.taxRatePct).toBe(17);
    expect(result.paymentDetails).toEqual({
      bankTransfer: undefined,
      bitPhone: "052-123-4567",
      note: undefined,
    });
  });

  it("prefers the column agreement text, keeps per-song pricing, and drops empty instructions", () => {
    const result = toSimulationInput({
      product: {
        ...PRODUCT,
        pricingModel: "per_song",
        volumeTiers: [{ minQty: 1, pricePerUnitCents: 90000 }],
        agreementText: "Column agreement wins.",
        deliverables: null,
      },
      profile: {
        displayName: null,
        taxMode: "nonsense",
        taxRatePct: null,
        logoUrl: null,
        timezone: "  ",
      },
      paymentInstructions: { bankTransfer: "   ", bitPhone: "" },
    });

    expect(result.producerName).toBe("Your studio");
    // A blank or missing zone still has to book a session somewhere.
    expect(result.timezone).toBe("Asia/Jerusalem");
    expect(result.product.pricingModel).toBe("per_song");
    expect(result.product.volumeTiers).toEqual([{ minQty: 1, pricePerUnitCents: 90000 }]);
    expect(result.product.agreementText).toBe("Column agreement wins.");
    expect(result.product.deliverables).toEqual([]);
    expect(result.taxMode).toBe("tax_free");
    expect(result.taxRatePct).toBe(18);
    expect(result.paymentDetails).toBeNull();
  });

  it("clamps the tax rate into the producer setting range", () => {
    expect(clampTaxRatePct(undefined)).toBe(18);
    expect(clampTaxRatePct(Number.NaN)).toBe(18);
    expect(clampTaxRatePct(-4)).toBe(0);
    expect(clampTaxRatePct(140)).toBe(100);
    expect(clampTaxRatePct(17.6)).toBe(18);
  });
});
