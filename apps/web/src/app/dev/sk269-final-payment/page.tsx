import { notFound } from "next/navigation";

import {
  PaymentsTab,
  type ProjectPaymentsTabData,
} from "~/components/dashboard/project/album-tabs/project-payments-tab";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import type { PaymentHistoryViewData } from "~/components/payments/payment-history-view";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

// SK-269 visual check — the exact stuck state the producer reported: imported
// 50/50 work whose first half is paid and whose last half waits for an artist
// approval that can never happen, so the tab said "Nothing is waiting for
// payment" and hid "Record a payment". The finished-work control now sits
// above it. The second purchase is ordinary store work with the same plan and
// must never offer the control. Pressing it calls the real server action and
// fails with "Please sign in", which is expected here.

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
    sourceKind: "imported_existing_work",
    sourceLabel: "Album — 6 songs",
    lifecycleStatus: "active",
    totalCents: 500_000,
    currency: "ILS",
    reference: "SK-2088",
    provenanceNotice: "Added by producer from an existing agreement",
    finalPaymentRequest: {
      installmentId: "aaaaaaaa-2222-4222-8222-222222222222",
      amountCents: 250_000,
    },
    installments: [
      {
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        position: 1,
        amountCents: 250_000,
        currency: "ILS",
        dueAtIso: "2026-05-01T09:00:00.000Z",
        status: "confirmed",
        remainingCents: 0,
        hasPendingProof: false,
        payableNow: false,
      },
      {
        id: "aaaaaaaa-2222-4222-8222-222222222222",
        position: 2,
        amountCents: 250_000,
        currency: "ILS",
        dueAtIso: null,
        status: "not_paid",
        remainingCents: 250_000,
        hasPendingProof: false,
        payableNow: false,
      },
    ],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    sourceKind: "store_product",
    sourceLabel: "Single — mix and master",
    lifecycleStatus: "active",
    totalCents: 120_000,
    currency: "ILS",
    reference: "SK-2089",
    installments: [
      {
        id: "bbbbbbbb-1111-4111-8111-111111111111",
        position: 1,
        amountCents: 60_000,
        currency: "ILS",
        dueAtIso: "2026-08-01T09:00:00.000Z",
        status: "confirmed",
        remainingCents: 0,
        hasPendingProof: false,
        payableNow: false,
      },
      {
        id: "bbbbbbbb-2222-4222-8222-222222222222",
        position: 2,
        amountCents: 60_000,
        currency: "ILS",
        dueAtIso: null,
        status: "not_paid",
        remainingCents: 60_000,
        hasPendingProof: false,
        payableNow: false,
      },
    ],
  },
];

export default function Sk269FinalPaymentVisualCheck() {
  if (!isDevGalleryAvailable()) notFound();
  return (
    <main className="mx-auto max-w-[860px] px-4 py-8">
      <h1 className="font-display mb-4 text-[22px] font-extrabold text-[rgb(var(--fg-default))]">
        SK-269 · Ask for the final payment
      </h1>
      <PaymentsTab
        projectId="44444444-4444-4444-8444-444444444444"
        payments={PAYMENTS}
        purchases={PURCHASES}
      />
    </main>
  );
}
