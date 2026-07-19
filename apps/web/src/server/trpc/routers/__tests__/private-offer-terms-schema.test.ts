import { describe, expect, it } from "vitest";

import { privateOfferTermsSchema } from "../private-offers";

function boundedTerms() {
  return {
    name: "N".repeat(200),
    tagline: "T".repeat(300),
    service: "S".repeat(200),
    deliverables: Array.from({ length: 20 }, () => "D".repeat(500)),
    cashPriceCents: 0,
    currency: "ILS",
    taxMode: "tax_free" as const,
    taxRatePct: 0,
    includedSongSpaces: 0,
    session: null,
    revisionRule: null,
    royaltyTerms: {
      master: { mode: "none" as const },
      composition: {
        mode: "percentage" as const,
        bps: 1,
        collectingSociety: "C".repeat(200),
      },
      notes: "R".repeat(4_000),
    },
    rights: Array.from({ length: 20 }, () => "R".repeat(1_000)),
    enabledPaymentPlans: [],
    agreementText: "A".repeat(50_000),
  };
}

describe("privateOfferTermsSchema", () => {
  it("accepts the same upper bounds as the private-offer domain", () => {
    expect(privateOfferTermsSchema.safeParse(boundedTerms()).success).toBe(true);
  });

  it("rejects empty required lists, zero percentage royalties, and over-limit text", () => {
    expect(privateOfferTermsSchema.safeParse({ ...boundedTerms(), deliverables: [] }).success).toBe(
      false,
    );
    expect(privateOfferTermsSchema.safeParse({ ...boundedTerms(), rights: [] }).success).toBe(
      false,
    );
    expect(
      privateOfferTermsSchema.safeParse({
        ...boundedTerms(),
        royaltyTerms: {
          master: { mode: "percentage", bps: 0 },
          composition: { mode: "none" },
        },
      }).success,
    ).toBe(false);
    expect(
      privateOfferTermsSchema.safeParse({ ...boundedTerms(), agreementText: "A".repeat(50_001) })
        .success,
    ).toBe(false);
  });
});
