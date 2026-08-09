import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductDetailScreen } from "../product-detail-screen";
import { ReviewAgreeScreen } from "../review-agree-screen";
import type { Producer, PurchaseAcceptancePreview, PurchaseProduct } from "../purchase-data";

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
  unlimitedSessions: false,
  revisions: 2,
  unlimitedRevisions: false,
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
  agreementText: "Credit the producer in release metadata.",
  pricingModel: "flat",
  volumeTiers: [],
};

const producer: Producer = {
  name: "Gili Studio",
  initials: "GS",
  hue: 30,
};

const preview: PurchaseAcceptancePreview = {
  productId: product.id,
  productName: product.name,
  producerName: producer.name,
  status: "approved",
  target: {
    kind: "existing",
    projectId: "00000000-0000-4000-8000-000000000099",
    projectTitle: "Debut EP",
    lifecycleStatus: "active",
    workflowStage: "mixing",
    updatedAtIso: "2026-07-18T09:00:00.000Z",
  },
  snapshotDigest: "0123456789abcdef0123456789abcdef",
  schedule: [
    { label: "Due at acceptance", amountCents: 270_000 },
    { label: "When the artist approves the final version", amountCents: 270_000 },
  ],
  snapshot: {
    version: 1,
    productOrOfferName: product.name,
    ...(product.tagline ? { tagline: product.tagline } : {}),
    deliverables: product.includes,
    lineItems: [
      {
        label: "Song production",
        quantity: 3,
        listUnitPriceCents: 200_000,
        unitPriceCents: 180_000,
        totalCents: 540_000,
      },
    ],
    listSubtotalCents: 600_000,
    discountCents: 60_000,
    subtotalCents: 540_000,
    tax: { mode: "tax_included", ratePct: 18, amountCents: 82_373 },
    totalCents: 540_000,
    currency: "USD",
    includedSongSpaces: 3,
    session: {
      limit: { kind: "fixed", count: 3 },
      durationMin: 120,
      locationType: "Studio",
      bufferMinutes: 15,
      minLeadHours: 48,
    },
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: product.royaltyTerms,
    rights: ["Artist owns the final approved master."],
    selectedPaymentPlan: { kind: "split_50_50" },
    offeredPaymentPlans: product.paymentPlans,
    agreementText: "This exact agreement is frozen at acceptance.",
    ...{
      agreementPdf: {
        documentId: "00000000-0000-4000-8000-000000000089",
        originalFileName: "private-terms.pdf",
        contentType: "application/pdf",
        sizeBytes: 1_024,
        objectEtag: '"private-etag"',
        sha256: "a".repeat(64),
      },
    },
  },
};

describe("artist commercial-term rendering", () => {
  it("shows the live proposal and every enabled plan before request", () => {
    const html = renderToStaticMarkup(
      <ProductDetailScreen product={product} producer={producer} productId={product.id} />,
    );
    expect(html).toContain("$2,400.50");
    expect(html).toContain("Pay in full");
    expect(html).toContain("50/50");
    expect(html).toContain("Monthly — 6 payments");
    expect(html).toContain("2.5% master royalty");
    expect(html).toContain("Start a new project");
  });

  it("uses the tax-inclusive total for tax-added proposal and plan amounts", () => {
    const html = renderToStaticMarkup(
      <ProductDetailScreen
        product={product}
        producer={producer}
        productId={product.id}
        taxMode="tax_added"
        taxRatePct={18}
      />,
    );
    expect(html).toContain("$2,832.59");
    expect(html).toContain("$2,400.50 before tax");
    expect(html).toContain("Pay in full — $2,832.59 at acceptance");
    expect(html).toContain("$1,416.30 at acceptance");
    expect(html).toContain("$1,416.29 when the artist approves the final version");
  });

  it("renders explicit unlimited session and revision rules", () => {
    const html = renderToStaticMarkup(
      <ProductDetailScreen
        product={{
          ...product,
          sessions: 0,
          unlimitedSessions: true,
          revisions: 0,
          unlimitedRevisions: true,
          durationLabel: "Unlimited sessions · 2h each",
        }}
        producer={producer}
        productId={product.id}
      />,
    );
    expect(html).toContain("Unlimited sessions · 2h each");
    expect(html).toContain("Unlimited revisions");
    expect(html).not.toContain("1 project");
  });

  it("renders the exact accepted target, price, schedule, rights, rules, and agreement", () => {
    const html = renderToStaticMarkup(
      <ReviewAgreeScreen
        preview={preview}
        purchaseRequestId="00000000-0000-4000-8000-000000000088"
        paymentPlan={{ kind: "split_50_50" }}
      />,
    );
    expect(html).toContain("Debut EP");
    expect(html).toContain("Active · Mixing · Updated 18 Jul 2026");
    expect(html).toContain("3 × $1,800");
    expect(html).toContain("Volume discount");
    expect(html).toContain("$5,400");
    expect(html).toContain("Split 50 / 50");
    expect(html).toContain("Due at acceptance");
    expect(html).toContain("Artist owns the final approved master.");
    expect(html).toContain("3 included song spaces");
    const exactAgreementDetails = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0];
    expect(exactAgreementDetails).toBeDefined();
    expect(exactAgreementDetails).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(exactAgreementDetails).toContain("<summary");
    expect(exactAgreementDetails).toContain("View full exact agreement");
    expect(exactAgreementDetails).toContain("This exact agreement is frozen at acceptance.");
    expect(html).toContain("Open PDF agreement · private-terms.pdf");
    expect(html).toContain(
      "purchaseRequestId=00000000-0000-4000-8000-000000000088&amp;documentId=00000000-0000-4000-8000-000000000089",
    );
    expect(html).not.toContain("private-etag");
    expect(html).not.toMatch(/agreement-pdfs\/[a-f0-9]{64}/);
    expect(html).toContain("I accept this exact agreement and payment plan.");
  });
});
