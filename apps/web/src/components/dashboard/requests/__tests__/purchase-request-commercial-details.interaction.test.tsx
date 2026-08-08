// @vitest-environment jsdom

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

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
  selectedPaymentPlan: null,
  offeredPaymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
  agreementText: "Exact proposed agreement.",
};

afterEach(() => {
  cleanup();
});

describe("producer request commercial disclosures", () => {
  it("starts all five rows closed and keeps only one row open", async () => {
    const user = userEvent.setup();
    render(<PurchaseRequestCommercialDetails commercialTerms={{ kind: "proposal", snapshot }} />);

    const price = screen.getByRole("button", { name: "Price details" });
    const payment = screen.getByRole("button", { name: "Payment choices" });
    const disclosures = [
      price,
      screen.getByRole("button", { name: "What the Artist gets" }),
      payment,
      screen.getByRole("button", { name: "Rights and royalties" }),
      screen.getByRole("button", { name: "Full agreement" }),
    ];

    expect(disclosures.every((button) => button.getAttribute("aria-expanded") === "false")).toBe(
      true,
    );

    await user.click(price);
    expect(price.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("commercial-price-panel")?.hidden).toBe(false);

    await user.click(payment);
    expect(price.getAttribute("aria-expanded")).toBe("false");
    expect(payment.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("commercial-price-panel")?.hidden).toBe(true);
    expect(document.getElementById("commercial-payment-panel")?.hidden).toBe(false);

    await user.click(payment);
    expect(payment.getAttribute("aria-expanded")).toBe("false");
  });
});
