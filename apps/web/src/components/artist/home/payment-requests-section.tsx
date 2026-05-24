import Link from "next/link";

import { ProducerArt } from "./producer-art";

export type PaymentRequestsProps = {
  bookings: Array<{
    id: string;
    startsAt: Date;
    producerName: string;
    packageName: string;
    amountCents: number;
    currency: string;
    plan: "50-50" | "monthly" | "upfront";
  }>;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function formatAmount(cents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const amt = cents / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: amt % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amt);
  return `${symbol}${formatted}`;
}

export function PaymentRequestsSection({ bookings }: PaymentRequestsProps) {
  if (bookings.length === 0) return null;

  const visible = bookings.slice(0, 3);
  const total = bookings.reduce((sum, b) => sum + b.amountCents, 0);
  const currency = bookings[0]?.currency ?? "USD";

  return (
    <section aria-labelledby="payment-requests-heading">
      <header className="flex items-baseline justify-between border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-baseline gap-3">
          <h2
            id="payment-requests-heading"
            className="text-[14px] font-bold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.01em" }}
          >
            Payment requests
          </h2>
          <span
            className="uppercase text-[10.5px] tracking-[0.04em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            {bookings.length} OPEN · {formatAmount(total, currency)}
          </span>
        </div>
        <Link
          href="/artist/book"
          className="text-[12px] font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-default)]"
        >
          Pay all →
        </Link>
      </header>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {visible.map((booking) => (
          <li
            key={booking.id}
            className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3 px-1 py-2.5"
          >
            <ProducerArt
              producerName={booking.producerName}
              size={28}
              initialsFontSize={10}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13.5px] font-semibold text-[var(--fg-default)]">
                {booking.packageName}
              </span>
              <span className="truncate text-[11.5px] text-[var(--fg-muted)]">
                {booking.producerName} ·{" "}
                <span style={{ fontFamily: "var(--font-jetbrains-mono)" }}>
                  {booking.plan}
                </span>
              </span>
            </div>
            <span
              className="text-brand-copper text-[14.5px] font-extrabold"
              style={{
                fontFamily: "var(--font-syne)",
                letterSpacing: "-0.02em",
              }}
            >
              {formatAmount(booking.amountCents, booking.currency)}
            </span>
            <Link
              href={`/artist/payment/${booking.id}`}
              className="inline-flex items-center rounded-full bg-[var(--bg-sidebar)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--brand-primary)] transition-transform hover:brightness-110 active:scale-[0.97]"
            >
              Pay
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
