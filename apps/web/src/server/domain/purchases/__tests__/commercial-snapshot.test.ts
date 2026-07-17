import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { describe, expect, it } from "vitest";

import { assertCommercialSnapshotMatchesAcceptance } from "../commercial-snapshot";

function snapshot(agreementText: string): PurchaseCommercialSnapshot {
  return {
    version: 1,
    productOrOfferName: "Mix",
    deliverables: ["Stereo mix"],
    lineItems: [
      {
        label: "Mix",
        quantity: 1,
        listUnitPriceCents: 10_000,
        unitPriceCents: 10_000,
        totalCents: 10_000,
      },
    ],
    listSubtotalCents: 10_000,
    discountCents: 0,
    subtotalCents: 10_000,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents: 10_000,
    currency: "ILS",
    includedSongSpaces: 1,
    session: null,
    revisionRule: null,
    royaltyTerms: null,
    rights: [],
    selectedPaymentPlan: { kind: "full" },
    offeredPaymentPlans: [{ kind: "full" }],
    agreementText,
  };
}

describe("commercial snapshot agreement", () => {
  it("requires non-empty final agreement text", () => {
    for (const agreementText of ["", "   ", "\n\t"]) {
      expect(() => {
        assertCommercialSnapshotMatchesAcceptance(snapshot(agreementText), 10_000, {
          kind: "full",
        });
      }).toThrow(/agreementText.*non-empty/i);
    }
  });

  it("preserves meaningful final agreement text", () => {
    expect(() => {
      assertCommercialSnapshotMatchesAcceptance(
        snapshot("Final terms accepted by the artist"),
        10_000,
        { kind: "full" },
      );
    }).not.toThrow();
  });
});
