import { notFound } from "next/navigation";

import {
  PaymentsTab,
  type ProjectPaymentsTabData,
} from "~/components/dashboard/project/album-tabs/project-payments-tab";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import type { PaymentHistoryViewData } from "~/components/payments/payment-history-view";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

// SK-260 visual check — the project Payments tab with mock purchases so the
// "Record a payment" bar, drop overlay, and form can be inspected without a
// signed-in producer. Submitting hits the real server action and fails with
// "Please sign in", which is expected here.

function emptyView(id: string, title: string): PaymentHistoryViewData {
  return {
    section: {
      id,
      eyebrow: "Payments",
      title,
      description: title,
      emptyTitle: "Nothing here",
      emptyDescription: "Nothing here",
    },
    currencyTotals: [],
    projects: [],
  };
}

const PAYMENTS: ProjectPaymentsTabData = {
  needsReview: emptyView("needs-review", "Pending proofs"),
  dueOrOverdue: emptyView("due", "Outstanding payments"),
  history: emptyView("history", "Completed payment history"),
};

const PURCHASES: ProjectPurchaseSummary[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    sourceKind: "store_product",
    sourceLabel: "Full production — 3 songs",
    lifecycleStatus: "active",
    totalCents: 600_000,
    currency: "ILS",
    reference: "SK-2041",
    installments: [
      {
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        position: 1,
        amountCents: 300_000,
        currency: "ILS",
        dueAtIso: "2026-08-01T09:00:00.000Z",
        status: "confirmed",
        remainingCents: 0,
        hasPendingProof: false,
        payableNow: false,
      },
      {
        id: "aaaaaaaa-2222-4222-8222-222222222222",
        position: 2,
        amountCents: 150_000,
        currency: "ILS",
        dueAtIso: "2026-09-01T09:00:00.000Z",
        status: "partially_paid",
        remainingCents: 100_000,
        hasPendingProof: false,
        payableNow: true,
      },
      {
        id: "aaaaaaaa-3333-4333-8333-333333333333",
        position: 3,
        amountCents: 150_000,
        currency: "ILS",
        dueAtIso: null,
        status: "not_paid",
        remainingCents: 150_000,
        hasPendingProof: false,
        payableNow: false,
      },
    ],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    sourceKind: "paid_add_on",
    sourceLabel: "Extra mix revision",
    lifecycleStatus: "waiting_for_payment",
    totalCents: 40_000,
    currency: "ILS",
    installments: [
      {
        id: "bbbbbbbb-1111-4111-8111-111111111111",
        position: 1,
        amountCents: 40_000,
        currency: "ILS",
        dueAtIso: "2026-08-20T09:00:00.000Z",
        status: "overdue",
        remainingCents: 40_000,
        hasPendingProof: false,
        payableNow: true,
      },
    ],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    sourceKind: "session_product",
    sourceLabel: "Vocal session · 4h",
    lifecycleStatus: "active",
    totalCents: 120_000,
    currency: "ILS",
    installments: [
      {
        id: "cccccccc-1111-4111-8111-111111111111",
        position: 1,
        amountCents: 120_000,
        currency: "ILS",
        dueAtIso: "2026-08-15T09:00:00.000Z",
        status: "awaiting_review",
        remainingCents: 120_000,
        hasPendingProof: true,
        payableNow: false,
      },
    ],
  },
];

export default function Sk260RecordPaymentVisualCheck() {
  if (!isDevGalleryAvailable()) notFound();
  return (
    <main className="mx-auto max-w-[860px] px-4 py-8">
      <h1 className="font-display mb-4 text-[22px] font-extrabold text-[rgb(var(--fg-default))]">
        SK-260 · Payments tab visual check
      </h1>
      <PaymentsTab
        projectId="44444444-4444-4444-8444-444444444444"
        payments={PAYMENTS}
        purchases={PURCHASES}
      />
    </main>
  );
}
