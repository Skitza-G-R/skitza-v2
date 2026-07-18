import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductDetailScreen } from "../product-detail-screen";
import { ReviewAgreeScreen } from "../review-agree-screen";
import type { Producer, PurchaseProduct } from "../purchase-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const product: PurchaseProduct = {
  id: "00000000-0000-4000-8000-000000000073",
  name: "Three-song production",
  priceCents: 240_050,
  currency: "USD",
  durationLabel: "3 sessions · 2h each",
  includes: ["Production", "Mix", "Master"],
  tagline: "From demo to release.",
  sessions: 3,
  revisions: 2,
  paymentPlans: [{ kind: "full" }, { kind: "split_50_50" }, { kind: "monthly", installments: 6 }],
  royaltyTerms: {
    master: { mode: "percentage", bps: 250 },
    composition: {
      mode: "percentage",
      bps: 1250,
      role: "composer",
      collectingSociety: "ACUM",
    },
    notes: "Producer credit must appear in release metadata.",
  },
  agreementText: "These inline terms are proposed with the request.",
};

const producer: Producer = {
  name: "Gili Studio",
  initials: "GS",
  hue: 30,
  agreement: {
    filename: "commercial-terms.pdf",
    url: "https://example.com/commercial-terms.pdf",
    kind: "pdf",
  },
};

describe("artist commercial-term rendering", () => {
  it("shows every offered plan and concise rights before the request", () => {
    const html = renderToStaticMarkup(
      <ProductDetailScreen product={product} producer={producer} productId={product.id} />,
    );

    expect(html).toContain("$2,400.50");
    expect(html).toContain("Full");
    expect(html).toContain("50/50");
    expect(html).toContain("6 monthly payments");
    expect(html).toContain("2.5% master royalty");
    expect(html).toContain("12.5% composition royalty");
    expect(html).toContain("Producer credit must appear in release metadata.");
  });

  it("renders the royalty notes and inline/link agreement being proposed", () => {
    const html = renderToStaticMarkup(
      <ReviewAgreeScreen product={product} producer={producer} terms={[]} />,
    );

    expect(html).toContain("$2,400.50");
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain("Producer credit must appear in release metadata.");
    expect(html).toContain("These inline terms are proposed with the request.");
    expect(html).toContain("commercial-terms.pdf");
    expect(html).toContain("I&#x27;ve reviewed the proposed price");
  });
});
