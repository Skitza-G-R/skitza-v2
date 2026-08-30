import { notFound } from "next/navigation";

import {
  PaymentsTab,
  type ProjectPaymentsTabData,
} from "~/components/dashboard/project/album-tabs/project-payments-tab";
import type {
  ProjectPurchaseInstallment,
  ProjectPurchaseSummary,
} from "~/components/dashboard/projects/project-purchases-panel";
import type { PaymentHistoryViewData } from "~/components/payments/payment-history-view";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

// SK-293 visual check — the stuck state a live client produced: a 50/50
// purchase sold through Skitza whose client approved over WhatsApp and paid by
// transfer, so the final half never triggered. The tab used to say "Nothing is
// waiting for payment" and hide "Record a payment" entirely.
//
// Three panels, so the change and its two guard rails are visible together:
// the newly recordable half, imported work whose finished-work card is
// unchanged, and a payment that is genuinely not due yet and must stay
// refused. Submitting hits the real server action and fails with "Please sign
// in", which is expected here.

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

function paidFirstHalf(id: string): ProjectPurchaseInstallment {
  return {
    id,
    position: 1,
    amountCents: 250_000,
    currency: "ILS",
    dueAtIso: "2026-05-01T09:00:00.000Z",
    status: "confirmed",
    remainingCents: 0,
    hasPendingProof: false,
    payableNow: false,
  };
}

/** The half that waits on an approval the client will never give in Skitza. */
function waitingSecondHalf(
  id: string,
  finalMilestonePending: boolean,
): ProjectPurchaseInstallment {
  return {
    id,
    position: 2,
    amountCents: 250_000,
    currency: "ILS",
    dueAtIso: null,
    status: "not_paid",
    remainingCents: 250_000,
    hasPendingProof: false,
    payableNow: false,
    finalMilestonePending,
  };
}

const SOLD_THROUGH_SKITZA: ProjectPurchaseSummary[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    sourceKind: "store_product",
    sourceLabel: "Full production — 4 songs",
    lifecycleStatus: "active",
    totalCents: 500_000,
    currency: "ILS",
    reference: "SK-2093",
    installments: [
      paidFirstHalf("aaaaaaaa-1111-4111-8111-111111111111"),
      waitingSecondHalf("aaaaaaaa-2222-4222-8222-222222222222", true),
    ],
  },
];

const IMPORTED_WORK: ProjectPurchaseSummary[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    sourceKind: "imported_existing_work",
    sourceLabel: "Album — 6 songs",
    lifecycleStatus: "active",
    totalCents: 500_000,
    currency: "ILS",
    reference: "SK-2088",
    provenanceNotice: "Added by producer from an existing agreement",
    finalPaymentRequest: {
      installmentId: "bbbbbbbb-2222-4222-8222-222222222222",
      amountCents: 250_000,
    },
    installments: [
      paidFirstHalf("bbbbbbbb-1111-4111-8111-111111111111"),
      waitingSecondHalf("bbbbbbbb-2222-4222-8222-222222222222", true),
    ],
  },
];

const NOT_DUE_YET: ProjectPurchaseSummary[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    sourceKind: "store_product",
    sourceLabel: "Single — mix and master (monthly plan)",
    lifecycleStatus: "active",
    totalCents: 300_000,
    currency: "ILS",
    reference: "SK-2094",
    installments: [
      {
        id: "cccccccc-1111-4111-8111-111111111111",
        position: 1,
        amountCents: 150_000,
        currency: "ILS",
        dueAtIso: "2026-08-01T09:00:00.000Z",
        status: "confirmed",
        remainingCents: 0,
        hasPendingProof: false,
        payableNow: false,
      },
      {
        id: "cccccccc-2222-4222-8222-222222222222",
        position: 2,
        amountCents: 150_000,
        currency: "ILS",
        dueAtIso: "2026-12-01T09:00:00.000Z",
        status: "not_paid",
        remainingCents: 150_000,
        hasPendingProof: false,
        payableNow: false,
      },
    ],
  },
];

function Panel({
  id,
  title,
  note,
  purchases,
}: {
  id: string;
  title: string;
  note: string;
  purchases: readonly ProjectPurchaseSummary[];
}) {
  return (
    <section id={id} className="mb-10">
      <h2 className="font-display text-[17px] font-extrabold text-[rgb(var(--fg-default))]">
        {title}
      </h2>
      <p className="mt-1 mb-3 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">{note}</p>
      <PaymentsTab
        projectId="44444444-4444-4444-8444-444444444444"
        payments={PAYMENTS}
        purchases={purchases}
      />
    </section>
  );
}

export default function Sk293FinalHalfVisualCheck() {
  if (!isDevGalleryAvailable()) notFound();
  return (
    <main className="mx-auto max-w-[860px] px-4 py-8">
      <h1 className="font-display mb-6 text-[22px] font-extrabold text-[rgb(var(--fg-default))]">
        SK-293 · Record a final half the client never approved
      </h1>
      <Panel
        id="sold-through-skitza"
        title="1 · Sold through Skitza, client never approved"
        note="The reported case. Half paid, the rest waiting on an approval that will never come in the app. The producer can now record it — and the tab says the money is not due rather than counting it as owed."
        purchases={SOLD_THROUGH_SKITZA}
      />
      <Panel
        id="imported-work"
        title="2 · Imported work — unchanged"
        note="The SK-269 finished-work card still appears here, and only here. Healthy in-flight projects are never nudged to collect before their client approves."
        purchases={IMPORTED_WORK}
      />
      <Panel
        id="not-due-yet"
        title="3 · Genuinely not due — still refused"
        note="A monthly installment dated in the future. Nothing about SK-293 makes this recordable: the escape hatch only covers a missing approval milestone."
        purchases={NOT_DUE_YET}
      />
    </main>
  );
}
