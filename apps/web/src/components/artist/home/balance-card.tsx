// Server component — outstanding-balance summary. Hidden entirely
// when there's nothing owed (null OR zero), per the spec ("Only
// renders if totalCents > 0"). Showing "$0.00 due" is noise.
//
// Polished to mirror the locked design's "single quiet line + Pay
// pill" hierarchy — the balance is a gentle reminder, not a stop
// sign. The Pay button is intentionally non-functional in v1
// (Stripe Connect lands later) and shows a "coming soon" tooltip
// via title attr for screen-reader / keyboard users.

export type Balance = {
  totalCents: number;
  currency: string;
  nextDueAt: Date | null;
};

export function BalanceCard({ balance }: { balance: Balance | null }) {
  if (!balance || balance.totalCents <= 0) return null;

  const amount = formatMoney(balance.totalCents, balance.currency);
  const dueLine = balance.nextDueAt
    ? `Card on file will be charged on ${formatDate(balance.nextDueAt)}.`
    : "Awaiting payment.";

  return (
    <section
      aria-labelledby="balance-heading"
      className="reveal-up flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <h2
          id="balance-heading"
          className="font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Balance
        </h2>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="font-mono text-lg font-bold tracking-tight text-[rgb(var(--fg-default))]">
            {amount}
          </span>
          <span className="text-[11.5px] text-[rgb(var(--fg-muted))]">
            {dueLine}
          </span>
        </div>
      </div>
      <button
        type="button"
        disabled
        title="Stripe coming soon"
        className="sk-press shrink-0 cursor-not-allowed rounded-full px-3.5 py-2 text-[12.5px] font-bold opacity-70"
        style={{
          background: "rgb(var(--brand-primary))",
          color: "rgb(var(--bg-sidebar))",
        }}
      >
        Pay
      </button>
    </section>
  );
}

function formatMoney(cents: number, currency: string): string {
  const major = (cents / 100).toFixed(2);
  return `${currencySymbol(currency)}${major}`;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "ILS":
      return "₪";
    default:
      return `${currency} `;
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
