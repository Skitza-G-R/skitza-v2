import Link from "next/link";

import { appRouter } from "~/server/trpc/routers/_app";

// Server component — renders the three money numbers for the
// producer's default currency. Deliberately server-side so the first
// paint doesn't flash a skeleton.
//
// currency → symbol mapping is kept local (instead of sharing with
// package-form's) because this tile only ever shows ISO codes the
// router's `producer.defaultCurrency` enum allows.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

function formatMoney(cents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const dollars = cents / 100;
  return `${symbol}${dollars.toLocaleString(undefined, {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function RevenueTile({ userId }: { userId: string }) {
  const caller = appRouter.createCaller({ userId });
  const data = await caller.booking.revenue();

  const stats: { label: string; valueCents: number; hint?: string }[] = [
    { label: "Month to date", valueCents: data.mtdCents, hint: "Confirmed bookings this month" },
    { label: "Outstanding", valueCents: data.outstandingCents, hint: "Deposits owed" },
    { label: "Next 7 days", valueCents: data.next7DaysCents, hint: "Expected revenue" },
  ];

  return (
    <section
      aria-label="Revenue summary"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
          Revenue
        </p>
        <p className="font-mono text-[0.66rem] tracking-[0.1em] text-[rgb(var(--fg-muted))]">
          {data.currency}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              {s.label}
            </dt>
            <dd
              className="sk-num mt-1 font-display text-2xl leading-none tabular-nums text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 700 }}
            >
              {formatMoney(s.valueCents, data.currency)}
            </dd>
            {s.hint ? (
              <p className="mt-1 text-[11px] text-[rgb(var(--fg-muted))]">{s.hint}</p>
            ) : null}
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[11px] text-[rgb(var(--fg-muted))]">
        Numbers are informational. Connect Stripe in{" "}
        <Link
          href="/dashboard/settings"
          className="underline decoration-dotted underline-offset-2 hover:text-[rgb(var(--fg-secondary))]"
        >
          Settings
        </Link>{" "}
        to track real payments.
      </p>
    </section>
  );
}
