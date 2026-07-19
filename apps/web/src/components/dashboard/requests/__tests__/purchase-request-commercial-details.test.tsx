import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PurchaseRequestCommercialDetails } from "../purchase-request-commercial-details";

const snapshot: PurchaseCommercialSnapshot = {
  version: 1,
  productOrOfferName: "Three-song production",
  deliverables: ["Three mixed masters", "Instrumentals"],
  lineItems: [
    {
      label: "Production per song",
      quantity: 3,
      listUnitPriceCents: 90_000,
      unitPriceCents: 80_000,
      totalCents: 240_000,
    },
  ],
  listSubtotalCents: 270_000,
  discountCents: 30_000,
  subtotalCents: 240_000,
  tax: { mode: "tax_added", ratePct: 18, amountCents: 43_200 },
  totalCents: 283_200,
  currency: "ILS",
  includedSongSpaces: 3,
  session: null,
  revisionRule: { kind: "fixed", count: 2 },
  royaltyTerms: {
    master: { mode: "none" },
    composition: { mode: "percentage", bps: 500, role: "composer" },
  },
  rights: ["Artist owns the approved masters."],
  selectedPaymentPlan: { kind: "split_50_50" },
  offeredPaymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
  agreementText: "Exact accepted agreement.\nExact installment schedule.",
};

describe("producer request commercial details", () => {
  it("renders authoritative frozen quantity, price, plan, and agreement after acceptance", () => {
    const html = renderToStaticMarkup(
      <PurchaseRequestCommercialDetails
        commercialTerms={{
          kind: "accepted",
          purchaseId: "00000000-0000-4000-8000-000000000081",
          acceptedAt: new Date("2026-07-20T09:30:00.000Z"),
          snapshot,
        }}
        brief="Keep the lead vocal intimate."
        submittedAt={new Date("2026-07-20T08:00:00.000Z")}
      />,
    );

    expect(html).toContain("Frozen at acceptance");
    expect(html).toContain("Production per song");
    expect(html).toContain("3 ×");
    expect(html).toContain("₪2,832");
    expect(html).toContain("50/50");
    expect(html).toContain("Exact accepted agreement.");
    expect(html).toContain("Keep the lead vocal intimate.");
    expect(html).not.toMatch(/proof of payment|confirm payment|reject proof/i);
  });

  it("labels unaccepted product data as a current proposal", () => {
    const html = renderToStaticMarkup(
      <PurchaseRequestCommercialDetails
        commercialTerms={{
          kind: "proposal",
          snapshot: { ...snapshot, selectedPaymentPlan: null },
        }}
        brief={null}
        submittedAt={new Date("2026-07-20T08:00:00.000Z")}
      />,
    );

    expect(html).toContain("Current proposal");
    expect(html).toContain("Not chosen yet");
    expect(html).toContain("Nothing is frozen until the artist accepts");
    expect(html).not.toContain("Frozen at acceptance");
  });

  it("preserves an invalid draft request for decline without inventing commercial truth", () => {
    const html = renderToStaticMarkup(
      <PurchaseRequestCommercialDetails
        commercialTerms={{ kind: "unavailable", productName: "Three-song production" }}
        brief="Keep the lead vocal intimate."
        submittedAt={new Date("2026-07-20T08:00:00.000Z")}
      />,
    );

    expect(html).toContain("Commercial details unavailable");
    expect(html).toContain("This request is preserved");
    expect(html).toContain("You can still decline it");
    expect(html).toContain("Keep the lead vocal intimate.");
    expect(html).not.toMatch(/proof of payment|confirm payment|reject proof/i);
  });
});
