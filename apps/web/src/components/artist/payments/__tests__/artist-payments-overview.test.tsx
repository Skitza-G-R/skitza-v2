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
  paidCents: 5_015,
  dueNowCents: 5_015,
  totalRemainingCents: 5_015,
  showPayNextPayment: true,
  proofs: [{ id: "proof-1" }, { id: "proof-2" }],
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
});
