// Server component — outstanding-balance summary. Hidden entirely
// when there's nothing owed (null OR zero), per the spec ("Only
// renders if totalCents > 0"). Showing "$0.00 due" is noise.

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
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="balance-heading"
        className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Outstanding balance
      </h2>
      <p className="mt-2 font-display text-2xl text-[rgb(var(--fg-primary))]">
        {amount} due
      </p>
      <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">{dueLine}</p>
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
