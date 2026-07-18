import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewStep } from "../editor-steps/review-step";

describe("ReviewStep", () => {
  it("summarizes every section and provides edit links", () => {
    const html = renderToStaticMarkup(
      <ReviewStep
        name="Midnight mix package"
        typeLabel="Mix"
        showTypeEdit={true}
        includes={["Stereo mix", "Instrumental", "Stems"]}
        pricingModel="flat"
        priceCents={100_03}
        currency="USD"
        sessions={2}
        unlimitedSessions={false}
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
        contractUrl=""
        agreementText="Payment and credit terms."
        onEdit={() => undefined}
      />,
    );

    expect(html).toContain("Product type");
    expect(html).toContain("Product details");
    expect(html).toContain("Price");
    expect(html).toContain("Payment");
    expect(html).toContain("Delivery");
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
        typeLabel="Master"
        includes={[]}
        pricingModel="flat"
        priceCents={20_000}
        currency="USD"
        sessions={1}
        unlimitedSessions={false}
        paymentPlans={[{ kind: "full" }]}
        duration="60 min"
        revisions={0}
        unlimitedRevisions={false}
        royaltyTerms={null}
        agreementMode="none"
        contractUrl=""
        agreementText=""
        onEdit={() => undefined}
      />,
    );

    expect(html).toContain("Not specified");
    expect(html).toContain("No agreement added");
  });

  it("distinguishes the saved list price from the post-tax artist total", () => {
    const html = renderToStaticMarkup(
      <ReviewStep
        name="Taxed mix"
        typeLabel="Mix"
        includes={[]}
        pricingModel="flat"
        priceCents={10_000}
        artistPaysCents={11_800}
        taxNote="+ 18% tax"
        currency="USD"
        sessions={1}
        unlimitedSessions={false}
        paymentPlans={[{ kind: "full" }]}
        duration="60 min"
        revisions={1}
        unlimitedRevisions={false}
        royaltyTerms={null}
        agreementMode="none"
        contractUrl=""
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
        sessions={1}
        unlimitedSessions={false}
        paymentPlans={[{ kind: "full" }]}
        duration="60 min"
        revisions={2}
        unlimitedRevisions={false}
        royaltyTerms={null}
        agreementMode="none"
        contractUrl=""
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
