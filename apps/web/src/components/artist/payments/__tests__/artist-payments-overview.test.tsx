import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
  PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

import { ArtistPaymentsOverview } from "../artist-payments-overview";

const purchase = {
  id: "00000000-0000-4000-8000-000000000101",
  studioId: "00000000-0000-4000-8000-000000000201",
  title: "Single production",
  counterpartyLabel: "North Room",
  currency: "ILS",
  status: { label: "Due now", tone: "warning" },
  recordStatus: "open",
  paidCents: 5_015,
  dueNowCents: 5_015,
  totalRemainingCents: 5_015,
  showPayNextPayment: true,
  proofs: [{ id: "proof-1" }, { id: "proof-2" }],
} as unknown as PaymentHistoryPurchase;

const zeroTotalPurchase = {
  ...purchase,
  id: "00000000-0000-4000-8000-000000000102",
  title: "Royalty-only production",
  status: { label: "No payment required", tone: "neutral" },
  recordStatus: "no_payment_required",
  paidCents: 0,
  dueNowCents: 0,
  totalRemainingCents: 0,
  showPayNextPayment: false,
  proofs: [],
  schedule: [],
} as unknown as PaymentHistoryPurchase;

const canceledPurchase = {
  ...purchase,
  id: "00000000-0000-4000-8000-000000000103",
  title: "Canceled production",
  status: { label: "Canceled", tone: "neutral" },
  recordStatus: "canceled",
  dueNowCents: 0,
  totalRemainingCents: 0,
  // Deliberately inconsistent legacy input: the UI must still fail closed.
  showPayNextPayment: true,
  proofs: [],
} as unknown as PaymentHistoryPurchase;

const activeData = {
  section: {
    id: "active",
    eyebrow: "Active",
    title: "To pay",
    description: "",
    emptyTitle: "Nothing to pay",
    emptyDescription: "",
  },
  currencyTotals: [],
  projects: [
    {
      id: "project-1",
      title: "Debut single",
      purchases: [purchase],
    } as unknown as PaymentHistoryProject,
  ],
} satisfies PaymentHistoryViewData;

const emptyData = {
  ...activeData,
  section: { ...activeData.section, id: "history", title: "History" },
  projects: [],
} satisfies PaymentHistoryViewData;

function sectionWithPurchase(row: PaymentHistoryPurchase): PaymentHistoryViewData {
  const project = activeData.projects[0];
  if (!project) throw new Error("Active payment fixture needs a project");
  return { ...activeData, projects: [{ ...project, purchases: [row] }] };
}

describe("ArtistPaymentsOverview", () => {
  it("shows one compact purchase row with the exact payment action and history count", () => {
    const html = renderToStaticMarkup(
      <ArtistPaymentsOverview sections={[activeData, emptyData]} />,
    );

    expect(html).toContain("Single production");
    expect(html).toContain("Debut single");
    expect(html).toContain("Due now");
    expect(html).toContain("Remaining");
    expect(html).toContain("2 proof records");
    expect(html).toContain("Pay &amp; upload proof");
    expect(html).toContain(
      'href="/artist/payments/00000000-0000-4000-8000-000000000101?studio=00000000-0000-4000-8000-000000000201"',
    );
    expect(html).not.toContain("Frozen terms");
    expect(html).not.toContain("<details");
  });

  it("keeps the empty history state quiet and explicit", () => {
    const html = renderToStaticMarkup(<ArtistPaymentsOverview sections={[emptyData]} />);

    expect(html).toContain("Nothing to pay");
  });

  it("routes a zero-total record to its accepted terms instead of a proof-only dead end", () => {
    const html = renderToStaticMarkup(
      <ArtistPaymentsOverview sections={[sectionWithPurchase(zeroTotalPurchase)]} />,
    );

    expect(html).toContain("Royalty-only production");
    expect(html).toContain("View accepted terms");
    expect(html).toContain(
      'href="/artist/payments/00000000-0000-4000-8000-000000000102?studio=00000000-0000-4000-8000-000000000201"',
    );
    expect(html).not.toContain("Pay &amp; upload proof");
  });

  it("never advertises proof upload for a canceled purchase", () => {
    const html = renderToStaticMarkup(
      <ArtistPaymentsOverview sections={[sectionWithPurchase(canceledPurchase)]} />,
    );

    expect(html).toContain("View closed record");
    expect(html).not.toContain("Pay &amp; upload proof");
  });
});
