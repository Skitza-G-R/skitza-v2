import Link from "next/link";

type LegacyBookingPaymentUnavailableProps = {
  title: string;
  offAppInstructions: string;
  safetyNotice: string;
  productName: string;
  producerName: string;
  amountCents: number;
  currency: string;
};

function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

export function LegacyBookingPaymentUnavailable({
  title,
  offAppInstructions,
  safetyNotice,
  productName,
  producerName,
  amountCents,
  currency,
}: LegacyBookingPaymentUnavailableProps) {
  return (
    <div className="mx-auto flex w-full max-w-md justify-center py-4 lg:py-10">
      <section
        aria-labelledby="payment-unavailable-title"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-[var(--shadow-sm)] sm:p-8"
      >
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary))] uppercase">
          Payment information
        </p>
        <h1
          id="payment-unavailable-title"
          className="font-syne mt-3 text-2xl font-bold text-[rgb(var(--fg-default))]"
        >
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[rgb(var(--fg-muted))]">{offAppInstructions}</p>

        <dl className="mt-6 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] text-sm">
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-[rgb(var(--fg-muted))]">Booking</dt>
            <dd className="text-right font-medium text-[rgb(var(--fg-default))]">{productName}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-[rgb(var(--fg-muted))]">Producer</dt>
            <dd className="text-right font-medium text-[rgb(var(--fg-default))]">{producerName}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-[rgb(var(--fg-muted))]">Amount due</dt>
            <dd className="text-right font-mono font-semibold text-[rgb(var(--fg-default))]">
              {formatAmount(amountCents, currency)}
            </dd>
          </div>
        </dl>

        <p
          role="note"
          className="mt-5 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] px-4 py-3 text-sm font-medium text-[rgb(var(--fg-default))]"
        >
          {safetyNotice}
        </p>

        <Link
          href="/artist"
          className="mt-6 flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-5 py-3 text-sm font-bold text-[rgb(var(--brand-primary))] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
        >
          Back to dashboard
        </Link>
      </section>
    </div>
  );
}
