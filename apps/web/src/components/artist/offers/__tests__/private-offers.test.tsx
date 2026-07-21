import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PrivateOfferResponse } from "../private-offer-response";
import { PrivateOffersList } from "../private-offers-list";
import { PrivateOfferTerms } from "../private-offer-terms";

const snapshot: PurchaseCommercialSnapshot = {
  version: 1,
  productOrOfferName: "Debut EP production",
  tagline: "Four songs, ready for release.",
  service: "Production and mixing",
  deliverables: ["Four final masters", "Instrumental versions"],
  lineItems: [
    {
      label: "EP production",
      quantity: 4,
      listUnitPriceCents: 100_000,
      unitPriceCents: 90_000,
      totalCents: 360_000,
    },
  ],
  listSubtotalCents: 400_000,
  discountCents: 40_000,
  subtotalCents: 360_000,
  tax: { mode: "tax_added", ratePct: 18, amountCents: 64_800 },
  totalCents: 424_800,
  currency: "ILS",
  includedSongSpaces: 4,
  session: {
    limit: { kind: "fixed", count: 3 },
    durationMin: 120,
    locationType: "Producer studio",
    bufferMinutes: 15,
    minLeadHours: 48,
  },
  revisionRule: { kind: "fixed", count: 2 },
  royaltyTerms: {
    master: { mode: "percentage", bps: 250 },
    composition: {
      mode: "percentage",
      bps: 1_250,
      role: "composer",
      collectingSociety: "ACUM",
    },
    notes: "Producer credit appears in release metadata.",
  },
  rights: ["Artist owns the approved final masters."],
  selectedPaymentPlan: null,
  offeredPaymentPlans: [
    { kind: "full" },
    { kind: "split_50_50" },
    { kind: "monthly", installments: 3 },
  ],
  agreementText: "These exact private-offer terms are binding after acceptance.",
};

describe("PrivateOffersList", () => {
  it("links each server-approved active offer to its private detail", () => {
    const html = renderToStaticMarkup(
      <PrivateOffersList
        offers={[
          {
            id: "00000000-0000-4000-8000-000000000096",
            producerId: "00000000-0000-4000-8000-000000000099",
            producerName: "Gili Studio",
            commercialDraft: snapshot,
            expiresAt: new Date("2026-08-02T12:00:00.000Z"),
          },
        ]}
      />,
    );

    expect(html).toContain("Offers for you");
    expect(html).toContain("Debut EP production");
    expect(html).toContain("Gili Studio");
    expect(html).toContain("Expires 2 Aug 2026");
    expect(html).toContain("ILS");
    expect(html).toContain(
      "/artist/offers/00000000-0000-4000-8000-000000000096?studio=00000000-0000-4000-8000-000000000099",
    );
  });

  it("does not render an empty surface", () => {
    expect(renderToStaticMarkup(<PrivateOffersList offers={[]} />)).toBe("");
  });
});

describe("PrivateOfferTerms", () => {
  it("renders every captured commercial term and the supplied target", () => {
    const html = renderToStaticMarkup(
      <PrivateOfferTerms snapshot={snapshot} targetLabel="Existing project · Debut EP" />,
    );

    expect(html).toContain("Debut EP production");
    expect(html).toContain("Four songs, ready for release.");
    expect(html).toContain("Production and mixing");
    expect(html).toContain("Existing project · Debut EP");
    expect(html).toContain("Four final masters");
    expect(html).toContain("Instrumental versions");
    expect(html).toContain("4 song spaces");
    expect(html).toContain("3 sessions");
    expect(html).toContain("120 minutes each");
    expect(html).toContain("Producer studio");
    expect(html).toContain("48 hours");
    expect(html).toContain("2 revisions");
    expect(html).toContain("EP production");
    expect(html).toContain("18% tax added");
    expect(html).toContain("ILS");
    expect(html).toContain("Pay in full");
    expect(html).toContain("Split 50 / 50");
    expect(html).toContain("3 monthly payments");
    expect(html).toContain("2.5% master royalty");
    expect(html).toContain("12.5% composition royalty");
    expect(html).toContain("Artist owns the approved final masters.");
    expect(html).toContain("Producer credit appears in release metadata.");
    expect(html).toContain("These exact private-offer terms are binding after acceptance.");
  });

  it("states the zero-price and no-plan terms explicitly", () => {
    const zeroSnapshot: PurchaseCommercialSnapshot = {
      ...snapshot,
      lineItems: [
        {
          label: "Royalty-only production",
          quantity: 1,
          listUnitPriceCents: 0,
          unitPriceCents: 0,
          totalCents: 0,
        },
      ],
      listSubtotalCents: 0,
      discountCents: 0,
      subtotalCents: 0,
      tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
      totalCents: 0,
      includedSongSpaces: 0,
      session: {
        limit: { kind: "unlimited" },
        durationMin: 120,
        locationType: "Producer studio",
        bufferMinutes: 15,
        minLeadHours: 48,
      },
      revisionRule: { kind: "unlimited" },
      offeredPaymentPlans: [],
    };
    const html = renderToStaticMarkup(
      <PrivateOfferTerms snapshot={zeroSnapshot} targetLabel="New project (default)" />,
    );

    expect(html).toContain("New project (default)");
    expect(html).toContain("Tax free");
    expect(html).toContain("No payment plan or payment is required");
    expect(html).toContain("Unlimited sessions");
    expect(html).toContain("Unlimited revisions");
    expect(html).toContain("0 song spaces");
  });

  it("keeps both surfaces mobile-safe and follows the text-rectangle radius rule", () => {
    const source = ["private-offers-list.tsx", "private-offer-terms.tsx"]
      .map((file) => readFileSync(join(__dirname, "..", file), "utf8"))
      .join("\n");

    expect(source).toContain("min-w-0");
    expect(source).toContain("[overflow-wrap:anywhere]");
    expect(source).toMatch(/sm:grid-cols|sm:flex-row/);
    expect(source).not.toContain("rounded-full");
  });
});

describe("PrivateOfferResponse", () => {
  it("requires a second, explicit confirmation before rejecting an offer", () => {
    const source = readFileSync(join(__dirname, "..", "private-offer-response.tsx"), "utf8");

    expect(source).toContain("setConfirmingReject(true)");
    expect(source).toContain("Keep offer");
    expect(source).toContain("Confirm rejection");
  });

  it("previews the exact authoritative monthly schedule when cents do not divide evenly", () => {
    const oddMonthlySnapshot: PurchaseCommercialSnapshot = {
      ...snapshot,
      totalCents: 11,
      currency: "USD",
      offeredPaymentPlans: [{ kind: "monthly", installments: 3 }],
    };

    const html = renderToStaticMarkup(
      <PrivateOfferResponse
        offerId="00000000-0000-4000-8000-000000000096"
        studioId="00000000-0000-4000-8000-000000000099"
        updatedAt={new Date("2026-07-19T12:00:00.000Z")}
        targetProjectTitle={null}
        snapshot={oddMonthlySnapshot}
      />,
    );

    expect(html).toContain("First payment due at acceptance");
    expect(html).toContain("Triggered by offer acceptance");
    expect(html).toContain("Monthly payment 2");
    expect(html).toContain("Triggered on a monthly anniversary after acceptance");
    expect(html).toContain("$0.05");
    expect(html.match(/\$0\.03/g)).toHaveLength(2);
  });
});
