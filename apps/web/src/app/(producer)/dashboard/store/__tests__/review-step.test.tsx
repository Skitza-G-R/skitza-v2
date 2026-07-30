import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewStep } from "../editor-steps/review-step";

describe("ReviewStep", () => {
  it("summarizes every section and provides edit links", () => {
    const html = renderToStaticMarkup(
      <ReviewStep
        name="Midnight mix package"
        tagline="Release-ready clarity without losing the pulse."
        typeLabel="Mix"
        showTypeEdit={true}
        includes={["Stereo mix", "Instrumental", "Stems"]}
        pricingModel="flat"
        priceCents={100_03}
        currency="USD"
        includesSessions={true}
        sessions={2}
        unlimitedSessions={false}
        bookingEnabled={true}
        paymentPlans={[
          { kind: "full" },
          { kind: "split_50_50" },
          { kind: "monthly", installments: 4 },
        ]}
        duration="120 min"
        revisions={3}
        unlimitedRevisions={false}
        royaltyTerms={{
          master: { mode: "percentage", bps: 250 },
          composition: {
            mode: "percentage",
            bps: 1250,
            role: "composer",
            collectingSociety: "ACUM",
          },
        }}
        agreementMode="text"
        agreementText="Payment and credit terms."
        producerName="Gili Studio"
        onEdit={() => undefined}
      />,
    );

    expect(html).toContain("Exact artist preview");
    expect(html).toContain("Signed-in Store focal card for Gili Studio.");
    expect(html).toContain("View service");
    expect(html).toContain("Gili Studio");
    expect(html).toContain("Product type");
    expect(html).toContain("Product details");
    expect(html).toContain("Short description");
    expect(html).toContain("Release-ready clarity without losing the pulse.");
    expect(html).toContain("Price");
    expect(html).toContain("Payment");
    expect(html).toContain("Delivery");
    expect(html).toContain("2 bookable sessions");
    expect(html).not.toContain("Artist booking enabled");
    expect(html).toContain("Rights &amp; agreement");
    expect(html).toContain("Stereo mix");
    expect(html).toContain("Monthly installments");
    expect(html).toContain("2.5% master royalty");
    expect(html).toContain("12.5% composition royalty");
    expect(html).toContain("Payment and credit terms.");
    expect(html.match(/>Edit</g)).toHaveLength(6);
    expect(html).toContain("[overflow-wrap:anywhere]");
  });

  it("renders null royalty terms safely for legacy edits", () => {
    const html = renderToStaticMarkup(
      <ReviewStep
        name="Legacy master"
        tagline="Platform-ready master."
        typeLabel="Master"
        includes={[]}
        pricingModel="flat"
        priceCents={20_000}
        currency="USD"
        includesSessions={false}
        sessions={1}
        unlimitedSessions={false}
        bookingEnabled={false}
        paymentPlans={[{ kind: "full" }]}
        duration="60 min"
        revisions={0}
        unlimitedRevisions={false}
        royaltyTerms={null}
        agreementMode="none"
        agreementText=""
        onEdit={() => undefined}
      />,
    );

    expect(html).toContain("Not specified");
    expect(html).toContain("No bookable sessions included");
    expect(html).not.toContain("No artist booking");
    expect(html).toContain("No agreement added");
  });

  it("renders the exact secondary Store row when the product is not focal", () => {
    const html = renderToStaticMarkup(
      <ReviewStep
        name="Long-form vocal production package"
        tagline="Focused sessions for a polished vocal release."
        typeLabel="Production"
        includes={["Vocal production"]}
        pricingModel="flat"
        priceCents={10_000}
        currency="ILS"
        includesSessions={true}
        sessions={1}
        unlimitedSessions={false}
        bookingEnabled={true}
        paymentPlans={[{ kind: "full" }]}
        duration="60 min"
        revisions={1}
        unlimitedRevisions={false}
        royaltyTerms={null}
        agreementMode="none"
        agreementText=""
        producerName="Gili Studio"
        taxMode="tax_added"
        taxRatePct={18}
        previewPlacement="secondary"
        onEdit={() => undefined}
      />,
    );

    expect(html).toContain("Signed-in Store secondary row for Gili Studio.");
    expect(html).toContain("More services");
    expect(html).toContain("+ 18% tax");
    expect(html).not.toContain("Signature");
  });

  it("distinguishes the saved list price from the post-tax artist total", () => {
    const html = renderToStaticMarkup(
      <ReviewStep
        name="Taxed mix"
        tagline="A focused mix for release day."
        typeLabel="Mix"
        includes={[]}
        pricingModel="flat"
        priceCents={10_000}
        artistPaysCents={11_800}
        taxNote="+ 18% tax"
        currency="USD"
        includesSessions={true}
        sessions={1}
        unlimitedSessions={false}
        bookingEnabled={true}
        paymentPlans={[{ kind: "full" }]}
        duration="60 min"
        revisions={1}
        unlimitedRevisions={false}
        royaltyTerms={null}
        agreementMode="none"
        agreementText=""
        onEdit={() => undefined}
      />,
    );

    expect(html).toContain("$100");
    expect(html).toContain("+ 18% tax");
    expect(html).toContain("Artist total: $118");
    expect(html).toContain("Pay in full · $118");
  });

  it("summarizes the complete per-song ladder", () => {
    const html = renderToStaticMarkup(
      <ReviewStep
        name="EP mix"
        tagline="One consistent sound across the full EP."
        typeLabel="Mix"
        includes={["Mixes"]}
        pricingModel="per_song"
        volumeTiers={[
          { minQty: 1, pricePerUnitCents: 20_000 },
          { minQty: 5, pricePerUnitCents: 17_000 },
          { minQty: 10, pricePerUnitCents: 15_000 },
        ]}
        priceCents={20_000}
        currency="USD"
        includesSessions={true}
        sessions={1}
        unlimitedSessions={false}
        bookingEnabled={true}
        paymentPlans={[{ kind: "full" }]}
        duration="60 min"
        revisions={2}
        unlimitedRevisions={false}
        royaltyTerms={null}
        agreementMode="none"
        agreementText=""
        onEdit={() => undefined}
      />,
    );

    expect(html).toContain("1 song");
    expect(html).toContain("5+ songs");
    expect(html).toContain("10+ songs");
    expect(html).toContain("$170 / song");
  });
});
