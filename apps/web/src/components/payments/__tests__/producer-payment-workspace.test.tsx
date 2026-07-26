import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
} from "../payment-history-view";
import { ProducerPaymentWorkspace } from "../producer-payment-workspace";
import type { PaymentWorkspaceBucket } from "../producer-payment-workspace-model";

const usdPurchase: PaymentHistoryPurchase = {
  id: "purchase-usd",
  reference: "SK-USD-101",
  title: "Mix & master",
  counterpartyLabel: "Maya Stone",
  currency: "USD",
  status: { label: "Needs review", tone: "accent" },
  defaultOpen: true,
  totalCents: 150_000,
  paidCents: 100_000,
  dueNowCents: 25_000,
  totalRemainingCents: 50_000,
  delivery: {
    key: "locked",
    label: "Downloads locked",
    description: "Downloads unlock after payment.",
    paidCents: 100_000,
    waivedCents: 0,
    remainingCents: 50_000,
    overdue: false,
    activeOverrideVersionLabels: [],
    googleDriveLinks: [],
    withheldGoogleDriveLinkCount: 0,
  },
  frozenTerms: {
    frozenAtIso: "2026-07-01T09:00:00.000Z",
    productName: "Mix & master",
    deliverables: ["Final master"],
    lineItems: [
      {
        id: "line-usd",
        label: "Production",
        quantity: 1,
        unitPriceCents: 150_000,
        totalCents: 150_000,
      },
    ],
    subtotalCents: 150_000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 150_000,
    detailRows: [],
    rights: [],
    agreementText: "FULL DOSSIER SENTINEL",
  },
  acceptance: {
    acceptedAtIso: "2026-07-01T09:00:00.000Z",
    acceptedByLabel: "Maya Stone",
    statement: null,
  },
  plan: { label: "Two payments", description: null },
  schedule: [],
  nextPayment: {
    amountCents: 25_000,
    dueAtIso: "2026-08-01T09:00:00.000Z",
    trigger: null,
  },
  showPayNextPayment: false,
  currentInstructions: null,
  proofs: [
    {
      id: "proof-pending",
      installmentLabel: "Final payment",
      amountCents: 25_000,
      currency: "USD",
      status: "pending",
      originalFileName: "receipt.pdf",
      submittedAtIso: "2026-07-20T09:00:00.000Z",
      reviewedAtIso: null,
      note: null,
      rejectionNote: null,
      detailAvailable: true,
    },
  ],
  payments: [],
  corrections: [],
  waivers: [],
  cancellations: [],
  pauseHistory: [],
  downloadOverrideHistory: [],
};

const ilsPurchase: PaymentHistoryPurchase = {
  ...usdPurchase,
  id: "purchase-ils",
  reference: "SK-ILS-202",
  title: "Vocal production",
  counterpartyLabel: "Noa Green",
  currency: "ILS",
  status: { label: "Upcoming", tone: "active" },
  totalCents: 300_000,
  paidCents: 200_000,
  dueNowCents: 0,
  totalRemainingCents: 100_000,
  delivery: {
    ...usdPurchase.delivery,
    paidCents: 200_000,
    remainingCents: 100_000,
  },
  frozenTerms: {
    ...usdPurchase.frozenTerms,
    productName: "Vocal production",
    subtotalCents: 300_000,
    totalCents: 300_000,
  },
  nextPayment: {
    amountCents: 100_000,
    dueAtIso: null,
    trigger: "When the final vocal is approved",
  },
  proofs: [],
};

const usdProject: PaymentHistoryProject = {
  id: "project-usd",
  title: "Maya debut EP",
  status: { label: "Active", tone: "active" },
  currencyTotals: [
    { currency: "USD", dueNowCents: 25_000, totalRemainingCents: 50_000 },
  ],
  purchases: [usdPurchase],
};

const ilsProject: PaymentHistoryProject = {
  id: "project-ils",
  title: "Noa single",
  status: { label: "Active", tone: "active" },
  currencyTotals: [
    { currency: "ILS", dueNowCents: 0, totalRemainingCents: 100_000 },
  ],
  purchases: [ilsPurchase],
};

const buckets: readonly PaymentWorkspaceBucket[] = [
  { id: "needs_review", label: "Needs review", projects: [usdProject] },
  { id: "due_or_overdue", label: "Due now", projects: [] },
  { id: "upcoming", label: "Upcoming", projects: [ilsProject] },
  { id: "history", label: "History", projects: [] },
];

function count(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

describe("ProducerPaymentWorkspace", () => {
  it("renders one compact multi-currency ledger and a grouped producer table", () => {
    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace buckets={buckets} scope="global" />,
    );

    expect(count(html, /Money at a glance/g)).toBe(1);
    expect(count(html, /<table/g)).toBe(1);
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
    expect(count(html, /scope="rowgroup"/g)).toBe(2);
    expect(count(html, /<tbody/g)).toBe(2);

    expect(html).toContain("USD");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("ILS");
    expect(html).toContain("₪2,000.00");

    const projectLinkIndex = html.indexOf(
      'href="/dashboard/clients-projects/project-usd"',
    );
    const purchaseRowIndex = html.indexOf("Mix &amp; master", projectLinkIndex);
    expect(projectLinkIndex).toBeGreaterThan(-1);
    expect(purchaseRowIndex).toBeGreaterThan(projectLinkIndex);

    expect(html).toContain(">Client</th>");
    expect(html).toContain("Maya Stone");
    expect(html).toContain('aria-label="Payment views"');
    expect(html).toContain('aria-label="Search payment records"');
    expect(html).toContain('aria-label="Filter by currency"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('href="/dashboard/payments/proof-pending"');

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("FULL DOSSIER SENTINEL");
    expect(html).not.toContain("Frozen terms");
  });

  it("exposes client-only all-records and project filters", () => {
    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace
        buckets={buckets}
        scope="client"
        clientLabel="Maya Stone"
      />,
    );

    expect(html).toContain("All records");
    expect(html).toContain('aria-label="Filter by project"');
    expect(html).toContain("<option");
    expect(html).toContain("Maya debut EP");
    expect(html).toContain("Noa single");
  });

  it("offers history instead of an inert clear action when no payments are open", () => {
    const historyOnlyBuckets: readonly PaymentWorkspaceBucket[] = [
      { id: "needs_review", label: "Needs review", projects: [] },
      { id: "due_or_overdue", label: "Due now", projects: [] },
      { id: "upcoming", label: "Upcoming", projects: [] },
      { id: "history", label: "History", projects: [ilsProject] },
    ];

    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace buckets={historyOnlyBuckets} scope="global" />,
    );

    expect(html).toContain("No open payments");
    expect(html).toContain("View history");
    expect(html).not.toContain(">Clear filters</button>");
  });
});
