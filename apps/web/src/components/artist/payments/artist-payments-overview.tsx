import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { formatMoney } from "~/lib/format/money";
import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
  PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

export function ArtistPaymentsOverview({
  sections,
}: {
  sections: readonly PaymentHistoryViewData[];
}) {
  return (
    <div className="space-y-8">
      {sections.map((data) => (
        <ArtistPaymentSection key={data.section.id} data={data} />
      ))}
    </div>
  );
}

function ArtistPaymentSection({ data }: { data: PaymentHistoryViewData }) {
  const rows = data.projects.flatMap((project) =>
    project.purchases.map((purchase) => ({ project, purchase })),
  );
  const headingId = `artist-payments-${data.section.id}`;

  return (
    <section aria-labelledby={headingId}>
      <header className="mb-3 flex items-baseline justify-between gap-3 border-b border-[rgb(var(--border-subtle))] pb-2.5">
        <h2
          id={headingId}
          className="font-display text-[19px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
        >
          {data.section.title}
        </h2>
        <span className="font-mono text-[10px] font-semibold text-[rgb(var(--fg-muted))]">
          {String(rows.length)} {rows.length === 1 ? "purchase" : "purchases"}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-6">
          <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
            {data.section.emptyTitle}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {data.section.emptyDescription}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <ul className="list-none divide-y divide-[rgb(var(--border-subtle))]">
            {rows.map(({ project, purchase }) => (
              <ArtistPaymentRow
                key={`${project.id}-${purchase.id}`}
                project={project}
                purchase={purchase}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ArtistPaymentRow({
  project,
  purchase,
}: {
  project: PaymentHistoryProject;
  purchase: PaymentHistoryPurchase;
}) {
  const proofCount = purchase.proofs.length;

  return (
    <li>
      <Link
        href={withArtistStudio(
          `/artist/payments/${encodeURIComponent(purchase.id)}`,
          purchase.studioId,
        )}
        className="sk-press block px-4 py-4 transition-colors hover:bg-[rgb(var(--bg-background)/0.55)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset sm:px-5"
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[10.5px] font-semibold text-[rgb(var(--fg-muted))]">
              {[project.title, purchase.counterpartyLabel].filter(Boolean).join(" · ")}
            </span>
            <span className="mt-1 block text-[15px] font-bold break-words text-[rgb(var(--fg-default))]">
              {purchase.title}
            </span>
          </span>
          <Badge className="shrink-0" dot variant={purchase.status.tone}>
            {purchase.status.label}
          </Badge>
        </span>

        <span className="mt-3 grid grid-cols-2 gap-4 border-t border-[rgb(var(--border-subtle))] pt-3">
          <Amount
            label="Due now"
            cents={purchase.dueNowCents}
            currency={purchase.currency}
            urgent={purchase.dueNowCents > 0}
          />
          <Amount
            label="Remaining"
            cents={purchase.totalRemainingCents}
            currency={purchase.currency}
          />
        </span>

        <span className="mt-3 flex min-w-0 items-center justify-between gap-3">
          <span className="text-[10.5px] text-[rgb(var(--fg-muted))]">
            {String(proofCount)} proof {proofCount === 1 ? "record" : "records"}
          </span>
          <span className="text-right text-[11.5px] font-bold text-[rgb(var(--brand-primary-text))]">
            {artistPaymentActionLabel(purchase)} →
          </span>
        </span>
      </Link>
    </li>
  );
}

function artistPaymentActionLabel(purchase: PaymentHistoryPurchase): string {
  if (purchase.recordStatus === "canceled") return "View closed record";
  if (purchase.recordStatus === "no_payment_required") return "View accepted terms";
  if (purchase.recordStatus === "settled_by_waiver") return "View settlement history";
  if (purchase.recordStatus === "paid_in_full") return "View payment history";
  return purchase.showPayNextPayment ? "Pay & upload proof" : "View payment record";
}

function Amount({
  label,
  cents,
  currency,
  urgent = false,
}: {
  label: string;
  cents: number;
  currency: string;
  urgent?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-[9px] font-semibold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </span>
      <span
        className="mt-0.5 block font-mono text-[14px] font-bold tabular-nums"
        style={{
          color: urgent ? "rgb(var(--fg-danger-text))" : "rgb(var(--fg-default))",
        }}
      >
        {formatMoney(cents, currency)}
      </span>
    </span>
  );
}
