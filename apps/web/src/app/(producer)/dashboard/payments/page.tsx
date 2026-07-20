import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { PaymentHistoryView } from "~/components/payments/payment-history-view";
import { toPaymentHistoryViewData } from "~/components/payments/payment-history-adapter";
import { ProofQueueRefresh } from "~/components/dashboard/payments/proof-queue-refresh";
import { appRouter } from "~/server/trpc/routers/_app";

export const metadata = { title: "Payments" };

const SECTIONS = {
  needs_review: {
    id: "needs-review",
    eyebrow: "Payments",
    title: "Needs review",
    description:
      "Private payment proofs that need your decision, grouped with their exact project and purchase.",
    emptyTitle: "No proofs need review",
    emptyDescription: "New artist proofs will appear here. Requests stays only for new work.",
  },
  due_or_overdue: {
    id: "due-overdue",
    eyebrow: "Active balances",
    title: "Due and overdue",
    description: "Confirmed balances that need attention now. Each currency stays separate.",
    emptyTitle: "Nothing due",
    emptyDescription: "Due and overdue installments will appear here.",
  },
  upcoming: {
    id: "upcoming",
    eyebrow: "Active balances",
    title: "Upcoming",
    description: "Open purchases whose next payment date or trigger is still ahead.",
    emptyTitle: "No upcoming payments",
    emptyDescription: "Future installment schedules will appear here.",
  },
  history: {
    id: "history",
    eyebrow: "Immutable records",
    title: "History",
    description:
      "Fully paid and canceled purchases stay here with their agreements and complete money history.",
    emptyTitle: "No payment history yet",
    emptyDescription: "Paid and canceled purchases will remain here.",
  },
} as const;

export default async function PaymentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const model = await appRouter.createCaller({ userId }).purchaseLedger.overview();

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-9">
      <ProofQueueRefresh enabled={model.producerBuckets.needs_review.projects.length > 0} />
      <header className="mb-7">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
          Private off-app payments
        </p>
        <h1 className="font-display mt-2 text-[clamp(2rem,6vw,3.4rem)] leading-none font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Payments
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          Review proofs, follow balances, and keep every accepted purchase record in one place.
          Requests remains only for new-work decisions.
        </p>
      </header>

      <div className="space-y-9">
        <PaymentHistoryView
          role="producer"
          data={toPaymentHistoryViewData(
            model.producerBuckets.needs_review,
            SECTIONS.needs_review,
            "producer",
          )}
        />
        <PaymentHistoryView
          role="producer"
          data={toPaymentHistoryViewData(
            model.producerBuckets.due_or_overdue,
            SECTIONS.due_or_overdue,
            "producer",
          )}
        />
        <PaymentHistoryView
          role="producer"
          data={toPaymentHistoryViewData(
            model.producerBuckets.upcoming,
            SECTIONS.upcoming,
            "producer",
          )}
        />
        <PaymentHistoryView
          role="producer"
          data={toPaymentHistoryViewData(
            model.producerBuckets.history,
            SECTIONS.history,
            "producer",
          )}
        />
      </div>
    </main>
  );
}
