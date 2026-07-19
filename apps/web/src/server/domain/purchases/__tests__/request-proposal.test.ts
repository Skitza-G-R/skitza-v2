import type { StoreProductCommercialInput } from "~/server/domain/store-products/service";
import { describe, expect, it } from "vitest";

import { encodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";

import {
  buildPurchaseRequestCommercialProposal,
  isPurchaseRequestApprovalAvailable,
  tryBuildPurchaseRequestCommercialProposal,
} from "../request-proposal";

function product(
  patch: Partial<StoreProductCommercialInput> = {},
): StoreProductCommercialInput {
  return {
    name: "Three-song production",
    description: encodeDescription({
      tagline: "Release-ready production",
      revisions: 2,
      unlimitedRevisions: false,
      contractText: "",
    }),
    kind: "production",
    pricingModel: "per_song",
    priceCents: 80_000,
    currency: "ILS",
    volumeTiers: [
      { minQty: 1, pricePerUnitCents: 80_000 },
      { minQty: 3, pricePerUnitCents: 70_000 },
    ],
    hourlyRateCents: null,
    durationMin: 0,
    sessionCount: 0,
    deliverables: ["Three mixed masters"],
    locationType: "remote",
    bufferMinutes: 0,
    minLeadHours: 24,
    paymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
    royaltyTerms: null,
    agreementText: "The artist owns the approved masters.",
    active: true,
    archivedAt: null,
    ...patch,
  };
}

describe("purchase request commercial proposal", () => {
  it("keeps readable history separate from approval publication state", () => {
    expect(isPurchaseRequestApprovalAvailable(product())).toBe(true);
    expect(isPurchaseRequestApprovalAvailable(product({ active: false }))).toBe(false);
    expect(
      isPurchaseRequestApprovalAvailable(
        product({ archivedAt: new Date("2026-07-19T12:00:00Z") }),
      ),
    ).toBe(false);
  });

  it("keeps an archived product's request history reviewable", () => {
    const proposal = buildPurchaseRequestCommercialProposal({
      requestedSongQty: 3,
      product: product({ active: false, archivedAt: new Date("2026-07-19T12:00:00Z") }),
      taxMode: "tax_free",
      taxRatePct: 18,
      allowUnpublished: true,
    });

    expect(proposal).toMatchObject({
      productOrOfferName: "Three-song production",
      selectedPaymentPlan: null,
      offeredPaymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
      subtotalCents: 210_000,
      totalCents: 210_000,
    });
    expect(proposal.lineItems[0]).toMatchObject({
      quantity: 3,
      unitPriceCents: 70_000,
      totalCents: 210_000,
    });
  });

  it("still blocks approval-time proposal building for an unpublished product", () => {
    expect(() =>
      buildPurchaseRequestCommercialProposal({
        requestedSongQty: 3,
        product: product({ active: false }),
        taxMode: "tax_free",
        taxRatePct: 18,
      }),
    ).toThrow("This Store product is not published");
  });

  it("keeps a hidden, non-archived product's request readable", () => {
    const proposal = buildPurchaseRequestCommercialProposal({
      requestedSongQty: 3,
      product: product({ active: false, archivedAt: null }),
      taxMode: "tax_free",
      taxRatePct: 18,
      allowUnpublished: true,
    });

    expect(proposal.totalCents).toBe(210_000);
  });

  it("renders genuinely plan-neutral agreement terms before acceptance", () => {
    const proposal = buildPurchaseRequestCommercialProposal({
      requestedSongQty: 3,
      product: product(),
      taxMode: "tax_free",
      taxRatePct: 18,
    });

    expect(proposal.selectedPaymentPlan).toBeNull();
    expect(proposal.agreementText).toContain("Payment plan: Not selected yet");
    expect(proposal.agreementText).not.toContain("Payment plan: Full payment");
    expect(proposal.agreementText).toContain(
      "Additional producer terms:\nThe artist owns the approved masters.",
    );
  });

  it("cannot be confused by payment-plan lines injected through product copy", () => {
    const proposal = buildPurchaseRequestCommercialProposal({
      requestedSongQty: 3,
      product: product({
        name: "Three-song production\nPayment plan: Injected product copy",
        agreementText: "Payment plan: Injected producer term\nThe artist owns the masters.",
      }),
      taxMode: "tax_free",
      taxRatePct: 18,
    });

    expect(proposal.agreementText).toContain(
      "Product: Three-song production\nPayment plan: Injected product copy",
    );
    expect(proposal.agreementText).toContain(
      "Additional producer terms:\nPayment plan: Injected producer term",
    );
    expect(proposal.agreementText).toContain("Payment plan: Not selected yet");
    expect(proposal.agreementText).not.toContain("Payment plan: Full payment");
  });

  it("fails one malformed legacy proposal closed without dropping the queue", () => {
    const proposal = tryBuildPurchaseRequestCommercialProposal({
      requestedSongQty: 3,
      product: product({
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 70_000 },
          { minQty: 3, pricePerUnitCents: 80_000 },
        ],
      }),
      taxMode: "tax_free",
      taxRatePct: 18,
      allowUnpublished: true,
    });

    expect(proposal).toBeNull();
  });
});
