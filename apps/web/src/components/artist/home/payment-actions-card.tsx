import Link from "next/link";

import { formatMoney } from "~/lib/format/money";
import { withArtistStudio } from "~/lib/artist-studio-context";

export type ArtistPaymentAction = Readonly<{
  purchaseId: string;
  studioId?: string;
  projectTitle: string;
  purchaseTitle: string;
  producerName: string;
  currency: string;
  dueNowCents: number;
  totalRemainingCents: number;
  statusLabel: string;
  payNextAvailable: boolean;
}>;

export function ArtistPaymentActionsCard({
  payments,
  activeStudioId,
}: {
  payments: readonly ArtistPaymentAction[];
  activeStudioId?: string | null;
}) {
  if (payments.length === 0) return null;
  return (
    <section aria-labelledby="artist-payment-actions-heading">
      <header className="flex items-end justify-between gap-3 border-b border-[rgb(var(--border-subtle))] pb-2">
        <div>
          <p className="font-mono text-[9.5px] font-bold tracking-[0.13em] text-[rgb(var(--brand-primary-text))] uppercase">
            Accepted purchases
          </p>
          <h2
            id="artist-payment-actions-heading"
            className="font-display mt-0.5 text-[15px] font-extrabold text-[rgb(var(--fg-default))]"
          >
            Payments
          </h2>
        </div>
        <Link
          href={withArtistStudio("/artist/payments", activeStudioId)}
          className="inline-flex min-h-11 min-w-11 items-center text-[12px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-0 sm:min-w-0"
        >
          View all →
        </Link>
      </header>
      <ul className="divide-y divide-[rgb(var(--border-subtle))]">
        {payments.slice(0, 3).map((payment) => (
          <li
            key={payment.purchaseId}
            className="grid min-w-0 grid-cols-1 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold break-words text-[rgb(var(--fg-default))]">
                {payment.purchaseTitle}
              </p>
              <p className="mt-0.5 text-[11.5px] break-words text-[rgb(var(--fg-muted))]">
                {payment.producerName} · {payment.projectTitle} · {payment.statusLabel}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-3">
                <Amount label="Due now" cents={payment.dueNowCents} currency={payment.currency} />
                <Amount
                  label="Total remaining"
                  cents={payment.totalRemainingCents}
                  currency={payment.currency}
                />
              </dl>
            </div>
            <Link
              href={withArtistStudio(
                payment.payNextAvailable
                  ? `/artist/payments/${encodeURIComponent(payment.purchaseId)}`
                  : "/artist/payments",
                payment.payNextAvailable ? payment.studioId : activeStudioId,
              )}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[12px] font-bold text-[rgb(var(--brand-primary))] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-w-24"
            >
              {payment.payNextAvailable ? "Pay next" : "View"}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Amount({ label, cents, currency }: { label: string; cents: number; currency: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-[12px] font-bold break-words text-[rgb(var(--fg-default))] tabular-nums">
        {formatMoney(cents, currency, { withCents: true })}{" "}
        <span className="text-[9px] text-[rgb(var(--fg-muted))]">{currency}</span>
      </dd>
    </div>
  );
}
