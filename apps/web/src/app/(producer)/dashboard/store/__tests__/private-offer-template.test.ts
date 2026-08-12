import { describe, expect, it } from "vitest";

import { encodeDescription } from "../description-encoding";
import {
  buildPrivateOfferTemplateProduct,
  type PrivateOfferTemplateSource,
} from "../private-offer-template";

function source(
  patch: Partial<PrivateOfferTemplateSource> = {},
): PrivateOfferTemplateSource {
  return {
    id: "2b79653a-8aac-4b03-9fc6-bdf19487e4b8",
    name: "Single production",
    description: encodeDescription({
      tagline: "From demo to release-ready master.",
      revisions: 3,
      unlimitedRevisions: false,
      contractText: "Legacy exact terms",
    }),
    kind: "production",
    priceCents: 10_000,
    hourlyRateCents: null,
    currency: "ILS",
    durationMin: 120,
    sessionCount: 3,
    bookingEnabled: true,
    paymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
    locationType: "studio",
    bufferMinutes: 15,
    minLeadHours: 24,
    agreementPdf: null,
    legacyAgreementLinkPresent: false,
    royaltyTerms: {
      master: { mode: "percentage", bps: 500 },
      composition: { mode: "none" },
    },
    agreementText: "Exact product terms",
    deliverables: ["Production", "Mix", "Master"],
    pricingModel: "flat",
    volumeTiers: null,
    ...patch,
  };
}

const SETTINGS = {
  taxMode: "tax_added" as const,
  taxRatePct: 18,
};

describe("buildPrivateOfferTemplateProduct", () => {
  it("copies the raw pre-tax subtotal instead of the Store card's tax-added display", () => {
    const template = buildPrivateOfferTemplateProduct(source(), SETTINGS);

    expect(template.terms.cashPriceCents).toBe(10_000);
    expect(template.terms.taxMode).toBe("tax_added");
    expect(template.terms.taxRatePct).toBe(18);
    expect(template.terms.currency).toBe("ILS");
  });

  it("keeps tier data and starts a per-song private quote at one explicit song", () => {
    const template = buildPrivateOfferTemplateProduct(
      source({
        pricingModel: "per_song",
        priceCents: 20_000,
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 20_000 },
          { minQty: 5, pricePerUnitCents: 17_000 },
        ],
      }),
      SETTINGS,
    );

    expect(template.pricing).toEqual({
      kind: "per_song",
      initialQuantity: 1,
      volumeTiers: [
        { minQty: 1, pricePerUnitCents: 20_000 },
        { minQty: 5, pricePerUnitCents: 17_000 },
      ],
    });
    expect(template.terms.cashPriceCents).toBe(20_000);
    expect(template.terms.includedSongSpaces).toBe(1);
  });

  it("derives song-space defaults without inventing spaces for session or hourly work", () => {
    expect(
      buildPrivateOfferTemplateProduct(
        source({ bookingEnabled: false, kind: "mixing", pricingModel: "flat" }),
        SETTINGS,
      ).terms.includedSongSpaces,
    ).toBe(1);
    expect(
      buildPrivateOfferTemplateProduct(
        source({ bookingEnabled: true, kind: "session", pricingModel: "flat" }),
        SETTINGS,
      ).terms.includedSongSpaces,
    ).toBe(0);
    expect(
      buildPrivateOfferTemplateProduct(
        source({ bookingEnabled: true, kind: "production", pricingModel: "hourly" }),
        SETTINGS,
      ).terms.includedSongSpaces,
    ).toBe(0);
  });

  it("preserves unlimited allowances and a valid legacy ISO currency", () => {
    const template = buildPrivateOfferTemplateProduct(
      source({
        currency: "CAD",
        sessionCount: 0,
        description: encodeDescription({
          tagline: "Open-ended support",
          revisions: 0,
          unlimitedRevisions: true,
          contractText: "Exact fallback terms",
        }),
      }),
      SETTINGS,
    );

    expect(template.terms.currency).toBe("CAD");
    expect(template.terms.session?.limit).toEqual({ kind: "unlimited" });
    expect(template.terms.revisionRule).toEqual({ kind: "unlimited" });
  });

  it("requires an explicit fixed quote for an hourly product while retaining its rate context", () => {
    const template = buildPrivateOfferTemplateProduct(
      source({
        pricingModel: "hourly",
        priceCents: 0,
        hourlyRateCents: 35_000,
        bookingEnabled: true,
      }),
      SETTINGS,
    );

    expect(template.terms.cashPriceCents).toBe(35_000);
    expect(template.pricing).toEqual({ kind: "hourly", hourlyRateCents: 35_000 });
    expect(template.terms.includedSongSpaces).toBe(0);
  });

  it("leaves an invalid legacy currency empty so the editor must resolve it", () => {
    const template = buildPrivateOfferTemplateProduct(source({ currency: "not-money" }), SETTINGS);

    expect(template.terms.currency).toBe("");
  });

  it("copies session, revision, royalty, rights, plan, and agreement snapshots", () => {
    const template = buildPrivateOfferTemplateProduct(source(), SETTINGS);

    expect(template.terms.session).toEqual({
      limit: { kind: "fixed", count: 3 },
      durationMin: 120,
      locationType: "studio",
      bufferMinutes: 15,
      minLeadHours: 24,
    });
    expect(template.terms.revisionRule).toEqual({ kind: "fixed", count: 3 });
    expect(template.terms.royaltyTerms?.master).toEqual({
      mode: "percentage",
      bps: 500,
    });
    expect(template.terms.rights[0]).toContain("5% master royalty");
    expect(template.terms.enabledPaymentPlans).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
    ]);
    expect(template.terms.agreementText).toBe("Exact product terms");
    expect(template.agreementNeedsCompletion).toBe(false);
  });

  it("marks PDF-only or agreement-free products for completion without inventing text", () => {
    const template = buildPrivateOfferTemplateProduct(
      source({
        description: "A focused production package.",
        agreementText: null,
        agreementPdf: { documentId: "458c42fb-4f42-41ea-9dc3-eaeecfddc21c" },
      }),
      SETTINGS,
    );

    expect(template.terms.agreementText).toBe("");
    expect(template.agreementNeedsCompletion).toBe(true);
  });

  it("treats missing canonical rights as incomplete instead of inventing rights text", () => {
    const template = buildPrivateOfferTemplateProduct(
      source({
        royaltyTerms: null,
        agreementText: "Exact agreement text is present.",
      }),
      SETTINGS,
    );

    expect(template.terms.royaltyTerms).toBeNull();
    expect(template.terms.rights).toEqual([]);
    expect(template.terms.agreementText).toBe("Exact agreement text is present.");
    expect(template.agreementNeedsCompletion).toBe(true);
  });
});
