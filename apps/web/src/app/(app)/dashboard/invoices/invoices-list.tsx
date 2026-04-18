"use client";

export interface InvoiceRow {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  amountCents: number;
  currency: string;
  description: string | null;
  kind: string;
  status: "draft" | "sent" | "paid" | "refunded" | "void" | "uncollectible";
  paidAt: string | null;
  createdAt: string;
}

// Compact, dashboard-style table. We keep everything client-side for
// now — no row actions yet, but the client component lets us layer in
// row clicks (drawer / Stripe deep-link) without round-tripping. The
// empty state is a producer nudge: "no invoices yet, here's how to
// start one" rather than a generic "no data".
export function InvoicesList({ invoices }: { invoices: InvoiceRow[] }) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-10 text-center">
        <p className="font-display text-lg tracking-tight">No invoices yet.</p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Connect Stripe in <a href="/dashboard/settings" className="underline">Settings</a> to start
          collecting deposits and final payments. Booking requests will create an invoice
          automatically once Stripe is connected.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      <table className="w-full text-sm">
        <thead className="border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
          <tr>
            <th className="px-4 py-2.5 font-normal">Date</th>
            <th className="px-4 py-2.5 font-normal">Client</th>
            <th className="px-4 py-2.5 font-normal">Description</th>
            <th className="px-4 py-2.5 font-normal">Kind</th>
            <th className="px-4 py-2.5 text-right font-normal">Amount</th>
            <th className="px-4 py-2.5 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr
              key={inv.id}
              className="border-t border-[rgb(var(--border-subtle))] hover:bg-[rgb(var(--bg-overlay))]"
            >
              <td className="px-4 py-3 font-mono text-xs text-[rgb(var(--fg-secondary))]">
                {formatDate(inv.createdAt)}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-[rgb(var(--fg-primary))]">
                  {inv.customerName ?? "—"}
                </div>
                {inv.customerEmail && (
                  <div className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                    {inv.customerEmail}
                  </div>
                )}
              </td>
              <td className="max-w-[220px] truncate px-4 py-3 text-[rgb(var(--fg-secondary))]">
                {inv.description ?? "—"}
              </td>
              <td className="px-4 py-3 capitalize text-[rgb(var(--fg-secondary))]">
                {inv.kind}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">
                {formatAmount(inv.amountCents, inv.currency)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={inv.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: InvoiceRow["status"] }) {
  const map: Record<InvoiceRow["status"], { cls: string; label: string }> = {
    paid: {
      cls:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      label: "Paid",
    },
    sent: {
      cls: "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))]",
      label: "Sent",
    },
    draft: {
      cls: "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-muted))]",
      label: "Draft",
    },
    refunded: {
      cls: "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-muted))]",
      label: "Refunded",
    },
    void: {
      cls: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
      label: "Void",
    },
    uncollectible: {
      cls: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
      label: "Uncollectible",
    },
  };
  const v = map[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>
      {v.label}
    </span>
  );
}

function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
