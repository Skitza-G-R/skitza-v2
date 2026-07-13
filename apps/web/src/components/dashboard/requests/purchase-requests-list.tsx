import Link from "next/link";

import { formatMoney } from "~/lib/format/money";

export type PendingPurchaseRequestRow = {
  id: string;
  refNumber: string;
  artistName: string;
  artistEmail: string;
  productNameSnapshot: string;
  priceCents: number;
  currency: string;
  createdAt: Date;
};

export function PurchaseRequestsList({
  requests,
}: {
  requests: readonly PendingPurchaseRequestRow[];
}) {
  if (requests.length === 0) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-10 text-center">
        <h2 className="font-display text-lg font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          You&rsquo;re all caught up
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          New purchase requests will appear here with the artist&rsquo;s locked commercial terms.
        </p>
        <Link
          href="/dashboard"
          className="sk-press mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-default))]"
        >
          Back to dashboard
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="pending-purchase-requests">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2
          id="pending-purchase-requests"
          className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase"
        >
          Awaiting review
        </h2>
        <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.12)] px-2 py-1 font-mono text-[10px] font-semibold text-[rgb(var(--brand-primary-text))]">
          {requests.length} {requests.length === 1 ? "request" : "requests"}
        </span>
      </div>

      <ul className="space-y-2">
        {requests.map((request) => (
          <li key={request.id}>
            <Link
              href={`/dashboard/requests/${request.id}`}
              className="sk-press group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 transition-colors hover:border-[rgb(var(--brand-primary)/0.5)] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
            >
              <Avatar name={request.artistName} />

              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="min-w-0 truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                    {request.artistName}
                  </p>
                  <p className="font-mono text-[10px] font-medium tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                    {request.refNumber}
                  </p>
                </div>
                <p className="mt-1 truncate text-sm text-[rgb(var(--fg-secondary))]">
                  {request.productNameSnapshot}
                </p>
                <p className="mt-1 truncate text-xs text-[rgb(var(--fg-muted))]">
                  {request.artistEmail} · {formatSubmittedDate(request.createdAt)}
                </p>
              </div>

              <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end">
                <p className="font-mono text-sm font-bold text-[rgb(var(--fg-default))] tabular-nums">
                  {formatMoney(request.priceCents, request.currency, {
                    withCents: request.priceCents % 100 !== 0,
                  })}
                </p>
                <span className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-3 text-xs font-bold text-[rgb(var(--bg-sidebar))] transition-[filter] group-hover:brightness-105">
                  Review
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] font-mono text-[11px] font-bold text-[rgb(var(--brand-primary-text))]"
    >
      {initials || "A"}
    </span>
  );
}

function formatSubmittedDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
