import { describe, expect, it } from "vitest";

import type {
  PaymentHistoryPurchase,
  PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

import { findArtistPaymentRecord, recordUsesProofFlow } from "../artist-payment-record";

const zeroPurchase = {
  id: "00000000-0000-4000-8000-000000000101",
  recordStatus: "no_payment_required",
  schedule: [],
} as unknown as PaymentHistoryPurchase;

const data = {
  section: {
    id: "history",
    eyebrow: "History",
    title: "History",
    description: "",
    emptyTitle: "Empty",
    emptyDescription: "",
  },
  currencyTotals: [],
  projects: [
    {
      id: "project-1",
      title: "Royalty single",
      status: { label: "Active", tone: "active" },
      currencyTotals: [],
      purchases: [zeroPurchase],
    },
  ],
} satisfies PaymentHistoryViewData;

describe("artist payment record route model", () => {
  it("resolves a zero-total accepted record without entering the installment proof flow", () => {
    const record = findArtistPaymentRecord([data], "00000000-0000-4000-8000-000000000101");

    expect(record?.project.title).toBe("Royalty single");
    expect(record?.purchase).toBe(zeroPurchase);
    expect(recordUsesProofFlow(record?.purchase ?? null)).toBe(false);
  });

  it("uses proof state only for records that have an installment", () => {
    expect(
      recordUsesProofFlow({
        ...zeroPurchase,
        recordStatus: "open",
        schedule: [{ id: "installment-1" }],
      } as unknown as PaymentHistoryPurchase),
    ).toBe(true);
  });
});
