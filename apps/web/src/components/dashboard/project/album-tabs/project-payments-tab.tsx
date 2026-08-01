"use client";

import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { ProjectPurchasesPanel } from "~/components/dashboard/projects/project-purchases-panel";
import {
  PaymentHistoryView,
  type PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

export interface ProjectPaymentsTabData {
  needsReview: PaymentHistoryViewData;
  dueOrOverdue: PaymentHistoryViewData;
  history: PaymentHistoryViewData;
}

interface PaymentsTabProps {
  projectId: string;
  payments: ProjectPaymentsTabData;
  purchases: readonly ProjectPurchaseSummary[];
}

function hasPurchases(data: PaymentHistoryViewData): boolean {
  return data.projects.some((project) => project.purchases.length > 0);
}

export function PaymentsTab({ projectId, payments, purchases }: PaymentsTabProps) {
  const hasNeedsReview = hasPurchases(payments.needsReview);
  const hasDueOrOverdue = hasPurchases(payments.dueOrOverdue);
  const hasHistory = hasPurchases(payments.history);

  return (
    <section
      role="tabpanel"
      id="panel-payments"
      aria-labelledby="tab-payments"
      className="space-y-4"
    >
      {hasNeedsReview ? <PaymentHistoryView role="producer" data={payments.needsReview} /> : null}
      {hasDueOrOverdue ? <PaymentHistoryView role="producer" data={payments.dueOrOverdue} /> : null}

      {!hasNeedsReview && !hasDueOrOverdue ? (
        <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.18)] bg-[rgb(var(--fg-success)/0.06)] px-4 py-3">
          <p className="text-[13px] font-bold text-[rgb(var(--fg-success-text))]">
            No payments need attention.
          </p>
          <p className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
            Purchases and completed records remain available below.
          </p>
        </div>
      ) : null}

      <ProjectPurchasesPanel projectId={projectId} purchases={purchases} />

      {hasHistory ? (
        <details className="group rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <summary className="sk-press flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] px-4 text-[13px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            Completed payment history
            <span
              aria-hidden
              className="text-[18px] leading-none text-[rgb(var(--fg-muted))] transition-transform group-open:rotate-45 motion-reduce:transition-none"
            >
              +
            </span>
          </summary>
          <div className="border-t border-[rgb(var(--border-subtle))] p-3 sm:p-4">
            <PaymentHistoryView role="producer" data={payments.history} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
