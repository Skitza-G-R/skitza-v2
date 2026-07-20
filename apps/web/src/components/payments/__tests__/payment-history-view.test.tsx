import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PaymentHistoryView,
  type PaymentHistoryProject,
  type PaymentHistoryPurchase,
  type PaymentHistoryViewData,
} from "../payment-history-view";

const purchase: PaymentHistoryPurchase = {
  id: "purchase-1",
  reference: "SK-P-1001",
  title: "Debut EP production",
  counterpartyLabel: "Maya Stone",
  currency: "USD",
  status: { label: "Due", tone: "warning" },
  defaultOpen: true,
  totalCents: 120_000,
  paidCents: 40_000,
  dueNowCents: 20_000,
  totalRemainingCents: 80_000,
  delivery: {
    key: "overdue_locked",
    label: "Overdue · downloads locked",
    description: "Listening remains available, but downloads require full payment.",
    paidCents: 40_000,
    waivedCents: 20_000,
    remainingCents: 80_000,
    overdue: true,
    activeOverrideVersionLabels: [],
    googleDriveLinks: [],
    withheldGoogleDriveLinkCount: 0,
  },
  frozenTerms: {
    frozenAtIso: "2026-07-01T09:00:00.000Z",
    productName: "Three-song production",
    deliverables: ["Three mixed masters", "Instrumentals"],
    lineItems: [
      {
        id: "line-1",
        label: "Production per song",
        quantity: 3,
        unitPriceCents: 40_000,
        totalCents: 120_000,
      },
    ],
    subtotalCents: 120_000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 120_000,
    detailRows: [
      { label: "Song spaces", value: "3" },
      { label: "Session allowance", value: "Two 4-hour sessions" },
      { label: "Revisions", value: "2 rounds" },
      { label: "Royalty terms", value: "5% composition · no master royalty" },
    ],
    rights: ["Artist owns the approved masters"],
    agreementText: "Credit the producer in release metadata.",
  },
  acceptance: {
    acceptedAtIso: "2026-07-01T09:00:00.000Z",
    acceptedByLabel: "Accepted by Maya Stone",
    statement: "Exact agreement and payment plan accepted.",
  },
  plan: {
    label: "Three installments",
    description: "One payment now, then two milestone payments.",
  },
  schedule: [
    {
      id: "installment-1",
      position: 1,
      label: "Deposit",
      amountCents: 40_000,
      paidCents: 40_000,
      waivedCents: 0,
      remainingCents: 0,
      dueAtIso: "2026-07-01T09:00:00.000Z",
      trigger: "At acceptance",
      status: { label: "Paid", tone: "success" },
    },
    {
      id: "installment-2",
      position: 2,
      label: "Recording complete",
      amountCents: 40_000,
      paidCents: 0,
      waivedCents: 20_000,
      remainingCents: 20_000,
      dueAtIso: "2026-07-20T09:00:00.000Z",
      trigger: "Recording approved",
      status: { label: "Due", tone: "warning" },
    },
  ],
  nextPayment: {
    amountCents: 20_000,
    dueAtIso: "2026-07-20T09:00:00.000Z",
    trigger: "Recording approved",
  },
  showPayNextPayment: true,
  currentInstructions: {
    title: "Bank transfer",
    updatedAtIso: "2026-07-18T09:00:00.000Z",
    fields: [
      { label: "Recipient", value: "Skitza Studio" },
      { label: "Reference", value: "SK-P-1001" },
    ],
    note: "Use the exact purchase reference.",
  },
  proofs: [
    {
      id: "proof-1",
      installmentLabel: "Deposit",
      amountCents: 40_000,
      currency: "USD",
      status: "pending",
      originalFileName: "transfer-receipt.pdf",
      submittedAtIso: "2026-07-02T09:00:00.000Z",
      reviewedAtIso: null,
      note: "Transfer sent this morning.",
      rejectionNote: null,
      detailAvailable: true,
    },
  ],
  payments: [
    {
      id: "payment-1",
      installmentLabel: "Deposit",
      amountCents: 40_000,
      currency: "USD",
      paidAtIso: "2026-07-03T09:00:00.000Z",
      sourceLabel: "Confirmed from proof",
      note: "Matched to the deposit.",
    },
  ],
  corrections: [
    {
      id: "correction-1",
      label: "Price correction",
      amountDeltaCents: -10_000,
      currency: "USD",
      occurredAtIso: "2026-07-04T09:00:00.000Z",
      reason: "Removed unused studio time.",
    },
  ],
  waivers: [
    {
      id: "waiver-1",
      installmentLabel: "Recording complete",
      amountCents: 20_000,
      currency: "USD",
      occurredAtIso: "2026-07-05T09:00:00.000Z",
      reason: "Goodwill waiver.",
    },
  ],
  cancellations: [
    {
      id: "cancellation-1",
      occurredAtIso: "2026-07-06T09:00:00.000Z",
      reason: "Canceled after the current milestone.",
    },
  ],
  pauseHistory: [
    {
      id: "pause-1",
      actionLabel: "Payments paused",
      occurredAtIso: "2026-07-07T09:00:00.000Z",
      reason: "Artist requested one week.",
    },
    {
      id: "pause-2",
      actionLabel: "Payments resumed",
      occurredAtIso: "2026-07-14T09:00:00.000Z",
      reason: null,
    },
  ],
  downloadOverrideHistory: [
    {
      id: "override-1",
      actionLabel: "Early download allowed",
      trackVersionLabel: "Final mix v3",
      occurredAtIso: "2026-07-15T09:00:00.000Z",
      reason: "Release deadline approved.",
      expiresAtIso: null,
    },
  ],
};

const usdProject: PaymentHistoryProject = {
  id: "project-usd",
  title: "Debut EP",
  status: { label: "Archived with balance", tone: "warning" },
  currencyTotals: [{ currency: "USD", dueNowCents: 20_000, totalRemainingCents: 80_000 }],
  purchases: [purchase],
};

const ilsPurchase: PaymentHistoryPurchase = {
  ...purchase,
  id: "purchase-2",
  reference: "SK-P-1002",
  title: "Single production",
  counterpartyLabel: "Noa Green",
  currency: "ILS",
  status: { label: "Upcoming", tone: "active" },
  totalCents: 360_000,
  paidCents: 140_000,
  dueNowCents: 120_000,
  totalRemainingCents: 220_000,
  frozenTerms: {
    ...purchase.frozenTerms,
    productName: "Single production",
    lineItems: [],
    subtotalCents: 360_000,
    totalCents: 360_000,
  },
  schedule: [],
  nextPayment: null,
  showPayNextPayment: false,
  currentInstructions: null,
  proofs: [],
  payments: [],
  corrections: [],
  waivers: [],
  cancellations: [],
  pauseHistory: [],
  downloadOverrideHistory: [],
};

const data: PaymentHistoryViewData = {
  section: {
    id: "due-overdue",
    eyebrow: "Payments",
    title: "Due and overdue",
    description: "Amounts that need attention now, grouped by project and purchase.",
    emptyTitle: "Nothing due",
    emptyDescription: "Due purchases will appear here.",
  },
  currencyTotals: [
    { currency: "USD", dueNowCents: 20_000, totalRemainingCents: 80_000 },
    { currency: "ILS", dueNowCents: 120_000, totalRemainingCents: 220_000 },
  ],
  projects: [
    usdProject,
    {
      id: "project-ils",
      title: "Summer Single",
      status: { label: "Active", tone: "active" },
      currencyTotals: [{ currency: "ILS", dueNowCents: 120_000, totalRemainingCents: 220_000 }],
      purchases: [ilsPurchase],
    },
  ],
};

describe("PaymentHistoryView", () => {
  it("keeps Due now and Total remaining separate for every supplied currency", () => {
    const html = renderToStaticMarkup(<PaymentHistoryView role="producer" data={data} />);

    expect(html).toContain('aria-label="USD totals"');
    expect(html).toContain('aria-label="ILS totals"');
    expect(html).toContain("$200.00");
    expect(html).toContain("$800.00");
    expect(html).toContain("₪1,200.00");
    expect(html).toContain("₪2,200.00");
    expect(html).toMatch(/Due now[\s\S]*Total remaining/);
  });

  it("renders project then purchase grouping and the complete immutable history", () => {
    const html = renderToStaticMarkup(<PaymentHistoryView role="producer" data={data} />);

    expect(html.indexOf("Debut EP")).toBeLessThan(html.indexOf("Debut EP production"));
    expect(html.indexOf("Summer Single")).toBeLessThan(html.indexOf("Single production"));
    expect(html).toContain("Credit the producer in release metadata.");
    expect(html).toContain("Song spaces");
    expect(html).toContain("Two 4-hour sessions");
    expect(html).toContain("2 rounds");
    expect(html).toContain("5% composition · no master royalty");
    expect(html).toContain("Exact agreement and payment plan accepted.");
    expect(html).toContain("Three installments");
    expect(html).toContain("Recording approved");
    expect(html).toContain("Bank transfer");
    expect(html).toContain("transfer-receipt.pdf");
    expect(html).toContain("Confirmed payment");
    expect(html).toContain("Price correction");
    expect(html).toContain("Payment waived");
    expect(html).toContain("Purchase canceled");
    expect(html).toContain("Payments paused");
    expect(html).toContain("Payments resumed");
    expect(html).toContain("Download override history");
    expect(html).toContain("Early download allowed");
    expect(html).toContain("Final mix v3");
    expect(html).toContain("Overdue · downloads locked");
    expect(html).toContain("Purchase delivery state");
  });

  it("shows exact role-safe links without adding any mutation controls", () => {
    const producerHtml = renderToStaticMarkup(<PaymentHistoryView role="producer" data={data} />);
    const artistHtml = renderToStaticMarkup(<PaymentHistoryView role="artist" data={data} />);

    expect(producerHtml).toContain('href="/dashboard/payments/proof-1"');
    expect(producerHtml).not.toContain("/artist/payments/purchase-1");
    expect(artistHtml).toContain('href="/artist/payments/purchase-1"');
    expect(artistHtml).toContain("Complete payment");
    expect(artistHtml).not.toContain("/dashboard/payments/proof-1");
    expect(artistHtml).not.toMatch(/confirm payment|reject proof|cancel purchase/i);
  });

  it("reveals paid Google Drive delivery links and never renders withheld links", () => {
    const driveHref = "https://drive.google.com/file/d/stems/view";
    const paidPurchase: PaymentHistoryPurchase = {
      ...purchase,
      delivery: {
        ...purchase.delivery,
        key: "paid",
        label: "Paid · downloads available",
        description: "Every still-stored owned version is downloadable.",
        remainingCents: 0,
        overdue: false,
        googleDriveLinks: [{ label: "Stems", href: driveHref }],
        withheldGoogleDriveLinkCount: 0,
      },
    };
    const paidHtml = renderToStaticMarkup(
      <PaymentHistoryView
        role="artist"
        data={{ ...data, projects: [{ ...usdProject, purchases: [paidPurchase] }] }}
      />,
    );
    expect(paidHtml).toContain(`href="${driveHref}"`);

    const earlyHtml = renderToStaticMarkup(
      <PaymentHistoryView
        role="artist"
        data={{
          ...data,
          projects: [
            {
              ...usdProject,
              purchases: [
                {
                  ...purchase,
                  delivery: {
                    ...purchase.delivery,
                    key: "early_override",
                    label: "Early access · V2 only",
                    activeOverrideVersionLabels: ["V2"],
                    googleDriveLinks: [],
                    withheldGoogleDriveLinkCount: 1,
                  },
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(earlyHtml).not.toContain(driveHref);
    expect(earlyHtml).toContain("stay locked until this purchase is fully paid");
  });

  it("keeps resolved proof evidence reachable only to the producer", () => {
    const baseProof = purchase.proofs[0];
    if (!baseProof) throw new Error("Proof fixture is missing");
    const resolvedProof = {
      ...baseProof,
      status: "confirmed" as const,
      reviewedAtIso: "2026-07-03T09:00:00.000Z",
    };
    const resolvedData: PaymentHistoryViewData = {
      ...data,
      projects: [{ ...usdProject, purchases: [{ ...purchase, proofs: [resolvedProof] }] }],
    };

    const producerHtml = renderToStaticMarkup(
      <PaymentHistoryView role="producer" data={resolvedData} />,
    );
    const artistHtml = renderToStaticMarkup(
      <PaymentHistoryView role="artist" data={resolvedData} />,
    );

    expect(producerHtml).toContain('href="/dashboard/payments/proof-1"');
    expect(producerHtml).toContain("View proof");
    expect(artistHtml).not.toContain("/dashboard/payments/proof-1");
  });

  it("ignores private repository metadata even when an unsafe adapter passes extra fields", () => {
    const unsafeProof = {
      ...purchase.proofs[0],
      storageObjectKey: "private/payment-proof/object-key",
      evidenceToken: "private-evidence-token",
    };
    const unsafePurchase = {
      ...purchase,
      rawClientEmail: "private-client@example.com",
      proofs: [unsafeProof],
    } as PaymentHistoryPurchase;
    const unsafeData: PaymentHistoryViewData = {
      ...data,
      projects: [{ ...usdProject, purchases: [unsafePurchase] }],
    };

    const html = renderToStaticMarkup(<PaymentHistoryView role="artist" data={unsafeData} />);

    expect(html).not.toContain("private/payment-proof/object-key");
    expect(html).not.toContain("private-evidence-token");
    expect(html).not.toContain("private-client@example.com");
  });

  it("renders caller-supplied empty copy without inventing a bucket", () => {
    const html = renderToStaticMarkup(
      <PaymentHistoryView role="artist" data={{ ...data, currencyTotals: [], projects: [] }} />,
    );

    expect(html).toContain("Nothing due");
    expect(html).toContain("Due purchases will appear here.");
  });
});
