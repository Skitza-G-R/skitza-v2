// Balance — quiet single-line card with an amber Pay pill.
// Hidden when there's nothing owed (null OR zero), per the spec
// ("only renders if totalCents > 0"). Showing "$0.00 due" is noise.

export type Balance = {
  totalCents: number;
  currency: string;
  nextDueAt: Date | null;
};

export function BalanceCard({
  balance,
  projectsOwed,
}: {
  balance: Balance | null;
  /** Optional projects-owed count for the design's "across N projects" copy. */
  projectsOwed?: number;
}) {
  if (!balance || balance.totalCents <= 0) return null;

  const amount = formatMoney(balance.totalCents, balance.currency);
  const sub =
    projectsOwed && projectsOwed > 1
      ? `across ${String(projectsOwed)} projects`
      : balance.nextDueAt
        ? `due ${formatDate(balance.nextDueAt)}`
        : "awaiting payment";

  return (
    <section
      aria-labelledby="balance-heading"
      className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <p
          id="balance-heading"
          className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Balance
        </p>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <p className="font-mono text-lg font-bold tracking-tight text-[rgb(var(--fg-default))]">
            {amount}
          </p>
          <p className="text-xs text-[rgb(var(--fg-muted))]">{sub}</p>
        </div>
      </div>
      <button
        type="button"
        disabled
        className="sk-press shrink-0 rounded-full bg-[rgb(var(--brand-primary))] px-3.5 py-2 font-mono text-xs font-bold text-[rgb(var(--bg-sidebar))] opacity-60"
        aria-label="Pay (coming soon)"
        title="Stripe checkout coming soon"
      >
        Pay
      </button>
    </section>
  );
}

function formatMoney(cents: number, currency: string): string {
  const major = (cents / 100).toFixed(0);
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
