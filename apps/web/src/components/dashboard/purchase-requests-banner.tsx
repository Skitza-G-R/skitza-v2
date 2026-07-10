import Link from "next/link";

import { formatMoney } from "~/lib/format/money";

type PendingPurchaseRequest = {
  id: string;
  refNumber: string;
  artistName: string;
  productNameSnapshot: string;
  priceCents: number;
  currency: string;
  createdAt: Date;
};

export function PurchaseRequestsBanner({
  requests,
}: {
  requests: readonly PendingPurchaseRequest[];
}) {
  const visible = requests.slice(0, 3);

  return (
    <section
      aria-labelledby="purchase-requests-heading"
      className="rounded-[var(--radius-lg)] border-[1.5px] border-[rgb(var(--brand-primary)/0.45)] bg-[rgb(var(--bg-elevated))] p-4 shadow-[0_4px_24px_rgb(var(--brand-primary)/0.08)] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]">
            Needs your approval
          </p>
          <h2
            id="purchase-requests-heading"
            className="mt-1 font-display text-lg font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
          >
            {requests.length} purchase {requests.length === 1 ? "request" : "requests"}
          </h2>
        </div>
        <Link
          href="/dashboard/requests"
          className="sk-press inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-3 text-xs font-bold text-[rgb(var(--brand-primary))] lg:min-h-0"
        >
          Review all
        </Link>
      </div>

      <ul className="mt-4 divide-y divide-[rgb(var(--border-subtle))]">
        {visible.map((request) => (
          <li key={request.id}>
            <Link
              href={`/dashboard/requests/${request.id}`}
              className="sk-press flex min-h-[58px] items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <Avatar name={request.artistName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                  {request.artistName}
                </p>
                <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
                  {request.productNameSnapshot} · {request.refNumber}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs font-bold text-[rgb(var(--fg-default))]">
                  {formatMoney(request.priceCents, request.currency)}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--brand-primary))]">
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
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] font-mono text-[10px] font-bold text-[rgb(var(--brand-primary))]"
    >
      {initials || "A"}
    </span>
  );
}
