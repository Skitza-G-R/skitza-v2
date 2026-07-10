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
      <section className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-12 text-center">
        <h2 className="font-display text-xl font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          No purchase requests waiting
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          New artist requests will appear here with their locked price and agreement details.
        </p>
        <Link
          href="/dashboard"
          className="sk-press mt-5 inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-sm font-semibold text-[rgb(var(--brand-primary))]"
        >
          Back to overview
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="pending-purchase-requests"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[rgb(var(--border-subtle))] px-4 py-3 sm:px-5">
        <h2
          id="pending-purchase-requests"
          className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Awaiting your decision
        </h2>
        <span className="pill pill-brand">{requests.length} pending</span>
      </div>
      <ul className="divide-y divide-[rgb(var(--border-subtle))]">
        {requests.map((request) => (
          <li key={request.id}>
            <Link
              href={`/dashboard/requests/${request.id}`}
              className="sk-press flex min-h-[76px] items-center gap-3 px-4 py-3 sm:px-5"
            >
              <Avatar name={request.artistName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                  {request.artistName}
                </p>
                <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
                  {request.artistEmail}
                </p>
                <p className="mt-1 truncate text-xs text-[rgb(var(--fg-muted))]">
                  {request.productNameSnapshot} · {request.refNumber}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs font-bold text-[rgb(var(--fg-default))]">
                  {formatMoney(request.priceCents, request.currency)}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--brand-primary))]">
                  Review →
                </p>
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
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] font-mono text-[11px] font-bold text-[rgb(var(--brand-primary))]"
    >
      {initials || "A"}
    </span>
  );
}
