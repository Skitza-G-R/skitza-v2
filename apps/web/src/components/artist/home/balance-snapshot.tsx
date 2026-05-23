// Server component — one-line outstanding-balance snapshot for the
// right rail. Shows the sum of unpaid invoices across all studios,
// or a quiet "All paid up" when there's nothing outstanding.
//
// Different from the per-payment rows in AlsoWaitingList: this is
// the TOTAL across producers, surfaced as a single glanceable
// number. Useful for the artist who works with multiple producers
// and wants their wallet-state at a glance without scrolling
// through individual line items.

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function formatCents(cents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const amount = cents / 100;
  const hasCents = amount % 1 !== 0;
  return `${symbol}${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

export function BalanceSnapshot({
  balance,
}: {
  balance: { totalCents: number; currency: string } | null;
}) {
  const hasOutstanding = balance !== null && balance.totalCents > 0;

  return (
    <section aria-labelledby="balance-snapshot-heading">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Wallet
      </p>
      <h3
        id="balance-snapshot-heading"
        className="mt-1 text-[14px] font-medium text-[rgb(var(--fg-default))]"
      >
        {hasOutstanding ? "Outstanding" : "All paid up"}
      </h3>
      {hasOutstanding ? (
        <p
          className="mt-2 font-display text-[24px] font-bold leading-none tracking-[-0.02em]"
          style={{ color: "rgb(var(--brand-copper))" }}
        >
          {formatCents(balance.totalCents, balance.currency)}
        </p>
      ) : (
        <p className="mt-2 text-[12.5px] text-[rgb(var(--fg-muted))]">
          Nothing waiting on payment.
        </p>
      )}
    </section>
  );
}
