import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PaymentHistoryPurchase } from "~/components/payments/payment-history-view";

import {
  PaymentSummaryScreen,
  type ArtistProofUploadAvailability,
} from "../payment-summary-screen";

const PURCHASE_RECORD = {
  id: "purchase-1",
  studioId: "producer-1",
  reference: "SK-P-101",
  title: "Single production",
  counterpartyLabel: "North Room",
  currency: "ILS",
  status: { label: "Due now", tone: "warning" },
  recordStatus: "open",
  defaultOpen: false,
  totalCents: 120_000,
  paidCents: 60_000,
  dueNowCents: 0,
  totalRemainingCents: 60_000,
  delivery: {
    key: "locked",
    label: "Downloads locked",
    description: "Full verified payment is still required.",
    paidCents: 60_000,
    waivedCents: 0,
    remainingCents: 60_000,
    overdue: false,
    activeOverrideVersionLabels: [],
    googleDriveLinks: [],
    withheldGoogleDriveLinkCount: 0,
  },
  frozenTerms: {
    frozenAtIso: "2026-07-01T09:00:00.000Z",
    productName: "Single production",
    deliverables: ["Approved master"],
    lineItems: [
      {
        id: "line-1",
        label: "Production",
        quantity: 1,
        unitPriceCents: 120_000,
        totalCents: 120_000,
      },
    ],
    subtotalCents: 120_000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 120_000,
    detailRows: [{ label: "Royalty terms", value: "5% composition" }],
    rights: ["Artist owns the approved master"],
    agreementText: "Credit North Room in the release metadata.",
  },
  acceptance: {
    acceptedAtIso: "2026-07-01T09:00:00.000Z",
    acceptedByLabel: "Maya Cohen accepted the exact terms",
    statement: "The exact agreement and payment plan are frozen.",
  },
  plan: {
    label: "50 / 50",
    description: "The final installment follows artist approval.",
  },
  schedule: [
    {
      id: "installment-1",
      position: 1,
      label: "Payment 1",
      amountCents: 60_000,
      paidCents: 60_000,
      waivedCents: 0,
      remainingCents: 0,
      dueAtIso: "2026-07-01T09:00:00.000Z",
      trigger: "At acceptance",
      status: { label: "Paid", tone: "success" },
    },
    {
      id: "installment-2",
      position: 2,
      label: "Payment 2",
      amountCents: 60_000,
      paidCents: 0,
      waivedCents: 0,
      remainingCents: 60_000,
      dueAtIso: null,
      trigger: "When the artist approves the final version",
      status: { label: "Not paid", tone: "warning" },
    },
  ],
  nextPayment: {
    amountCents: 60_000,
    dueAtIso: null,
    trigger: "When the artist approves the final version",
  },
  showPayNextPayment: false,
  currentInstructions: {
    title: "Current producer payment instructions",
    updatedAtIso: null,
    fields: [],
    note: "North Room sends Bank or Bit details directly.",
  },
  proofs: [
    {
      id: "proof-1",
      installmentLabel: "Payment 1",
      amountCents: 60_000,
      currency: "ILS",
      status: "confirmed",
      originalFileName: "receipt.pdf",
      submittedAtIso: "2026-07-02T08:00:00.000Z",
      reviewedAtIso: "2026-07-02T09:00:00.000Z",
      note: "Bank transfer receipt.",
      rejectionNote: null,
      detailAvailable: true,
    },
  ],
  payments: [
    {
      id: "payment-1",
      installmentLabel: "Payment 1",
      amountCents: 60_000,
      currency: "ILS",
      paidAtIso: "2026-07-02T09:00:00.000Z",
      sourceLabel: "Recorded manually",
      note: "Cash received at the studio.",
    },
  ],
  corrections: [
    {
      id: "correction-1",
      label: "Payment corrected",
      amountDeltaCents: -5_000,
      currency: "ILS",
      occurredAtIso: "2026-07-03T09:00:00.000Z",
      reason: "Corrected the recorded cash amount.",
    },
  ],
  waivers: [
    {
      id: "waiver-1",
      installmentLabel: "Payment 2",
      amountCents: 5_000,
      currency: "ILS",
      occurredAtIso: "2026-07-04T09:00:00.000Z",
      reason: "Waived the unused session balance.",
    },
  ],
  cancellations: [
    {
      id: "cancellation-1",
      occurredAtIso: "2026-07-05T09:00:00.000Z",
      reason: "Canceled after the first milestone.",
    },
  ],
  pauseHistory: [],
  downloadOverrideHistory: [],
} satisfies PaymentHistoryPurchase;

function renderSummary(
  proofUploadAvailability: ArtistProofUploadAvailability | null,
  options: {
    recordStatus?: PaymentHistoryPurchase["recordStatus"];
    totalCents?: number;
    verifiedCents?: number;
    remainingCents?: number;
  } = {},
): string {
  const recordStatus = options.recordStatus ?? "open";
  return renderToStaticMarkup(
    <PaymentSummaryScreen
      purchaseId="purchase-1"
      studioId="producer-1"
      productName="Single production"
      producerName="North Room"
      currency="ILS"
      totalCents={options.totalCents ?? 120_000}
      verifiedCents={options.verifiedCents ?? 0}
      remainingCents={options.remainingCents ?? 120_000}
      currentInstallmentPosition={proofUploadAvailability ? 1 : null}
      recordStatus={recordStatus}
      proofUploadAvailability={proofUploadAvailability}
      proofs={[]}
      purchaseRecord={{ ...PURCHASE_RECORD, recordStatus }}
    />,
  );
}

describe("artist payment summary entry", () => {
  it("keeps payment instructions reachable when Bank and Bit details are missing", () => {
    const html = renderSummary({ status: "available" });

    expect(html).toContain("Pay &amp; upload proof");
    expect(html).toContain("will send those details directly");
  });

  it("explains an approval-triggered final installment without pretending the uploader is missing", () => {
    const html = renderSummary({
      status: "not_due",
      installmentPosition: 2,
      dueTrigger: "artist_approval",
      dueAt: null,
    });

    expect(html).toContain("Next payment isn’t due yet");
    expect(html).toContain("opens after you approve the required final version");
    expect(html).not.toContain("Proof upload is not available yet");
    expect(html).not.toContain("Pay &amp; upload proof");
  });

  it("keeps a canceled purchase closed instead of offering another proof", () => {
    const html = renderSummary(
      { status: "purchase_canceled" },
      { recordStatus: "canceled", remainingCents: 0 },
    );

    expect(html).toContain("This purchase is closed");
    expect(html).not.toContain("Payment fully verified");
    expect(html).not.toContain("Pay &amp; upload proof");
  });

  it("does not call a waived zero balance verified payment", () => {
    const html = renderSummary(null, {
      recordStatus: "settled_by_waiver",
      verifiedCents: 0,
      remainingCents: 0,
    });

    expect(html).toContain("Balance settled by waiver");
    expect(html).toContain("A waiver is not a verified payment");
    expect(html).not.toContain("Payment fully verified");
  });

  it("shows verified payment only from the authoritative purchase record status", () => {
    const paid = renderSummary(null, {
      recordStatus: "paid_in_full",
      verifiedCents: 120_000,
      remainingCents: 0,
    });
    const staleAvailability = renderSummary({ status: "paid_in_full" }, { recordStatus: "open" });

    expect(paid).toContain("Payment fully verified");
    expect(staleAvailability).not.toContain("Payment fully verified");
  });

  it("keeps a zero-total accepted record reachable without an installment uploader", () => {
    const html = renderSummary(null, {
      recordStatus: "no_payment_required",
      totalCents: 0,
      verifiedCents: 0,
      remainingCents: 0,
    });

    expect(html).toContain("No payment required");
    expect(html).toContain("View the frozen accepted terms below");
    expect(html).not.toContain("Payment fully verified");
    expect(html).not.toContain("Pay &amp; upload proof");
  });

  it("keeps the complete accepted plan, schedule, and audit history reachable", () => {
    const html = renderSummary({ status: "available" });

    expect(html).toContain("Full purchase record");
    expect(html).toContain("Frozen terms");
    expect(html).toContain("50 / 50");
    expect(html).toContain("Payment 2");
    expect(html).toContain("receipt.pdf");
    expect(html).toContain("Recorded manually");
    expect(html).toContain("Corrected the recorded cash amount.");
    expect(html).toContain("Waived the unused session balance.");
    expect(html).toContain("Canceled after the first milestone.");
  });

  it("uses the standing Artist shell spacing instead of nesting another main landmark", () => {
    const html = renderSummary({ status: "available" });

    expect(html).not.toContain("<main");
    expect(html).toContain('href="/artist/payments?studio=producer-1"');
  });
});
