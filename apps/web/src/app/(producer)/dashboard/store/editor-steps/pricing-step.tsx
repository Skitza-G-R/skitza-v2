// pricing-step.tsx
//
// Stage 3 of the producer Store wizard — simplified to match the
// reference design: price + currency, sessions count (with an
// "Unlimited" pill toggle that mirrors the Revisions control in
// Logistics), and three radio cards for "How artists pay" (full /
// 50-50 split / installments).
//
// The previous version surfaced extra fields that were dropped to
// match the reference; the booking package form still exposes them
// for legacy edits outside the wizard.

"use client";

import { Minus, Plus } from "lucide-react";

type Currency = "USD" | "EUR" | "GBP" | "ILS";
type PaymentPlan = "full" | "split" | "installments";

const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

interface PricingStepProps {
  price: number;
  currency: Currency;
  sessions: number;
  unlimitedSessions: boolean;
  paymentPlan: PaymentPlan;
  installmentsCount: number;
  onChange: (patch: Partial<{
    price: number;
    currency: Currency;
    sessions: number;
    unlimitedSessions: boolean;
    paymentPlan: PaymentPlan;
    installmentsCount: number;
  }>) => void;
}

function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;
  return (
    <div
      className={[
        "inline-flex h-10 items-center gap-1 rounded-[10px] border bg-[rgb(var(--bg-elevated))] p-1",
        disabled
          ? "border-[rgb(var(--border-subtle))] opacity-50"
          : "border-[rgb(var(--border-subtle))]",
      ].join(" ")}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={() => {
          if (canDec) onChange(value - 1);
        }}
        disabled={!canDec}
        aria-label="Decrease"
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(17_16_9/0.06)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Minus size={14} strokeWidth={2.4} aria-hidden />
      </button>
      <span
        className="min-w-[2.5ch] text-center font-display text-[16px] font-bold tabular-nums leading-none text-[rgb(var(--fg-default))]"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => {
          if (canInc) onChange(value + 1);
        }}
        disabled={!canInc}
        aria-label="Increase"
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(17_16_9/0.06)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus size={14} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-[var(--font-outfit)] text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
      {children}
    </div>
  );
}

const PLAN_OPTIONS: { id: PaymentPlan; title: string; subtitle: string }[] = [
  { id: "full", title: "Pay in full", subtitle: "One payment, upfront." },
  { id: "split", title: "50% / 50%", subtitle: "Half on booking, half on delivery." },
  { id: "installments", title: "Payment plan", subtitle: "Split into equal installments." },
];

function formatCurrency(symbol: string, amount: number): string {
  return `${symbol}${Math.round(amount).toLocaleString()}`;
}

export function PricingStep({
  price,
  currency,
  sessions,
  unlimitedSessions,
  paymentPlan,
  installmentsCount,
  onChange,
}: PricingStepProps) {
  const curSym = CURRENCY_SYMBOL[currency];
  const installmentAmt =
    installmentsCount > 0 ? Math.round(price / installmentsCount) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Top row: Price + Currency / Sessions + Unlimited */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Price + Currency */}
        <div>
          <Eyebrow>Price</Eyebrow>
          <div className="flex items-center gap-2 rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 shadow-[0_1px_2px_rgba(17,16,9,0.03)] focus-within:border-[rgb(var(--brand-primary))] focus-within:ring-2 focus-within:ring-[rgb(var(--brand-primary)/0.25)]">
            <span
              aria-hidden
              className="font-display text-[20px] font-bold text-[rgb(var(--fg-muted))]"
            >
              {curSym}
            </span>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={price}
              onChange={(e) => {
                onChange({ price: Number(e.target.value) || 0 });
              }}
              aria-label="Price"
              className="min-w-0 flex-1 border-none bg-transparent py-1 font-display text-[20px] font-bold tabular-nums text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))]"
            />
            <select
              value={currency}
              onChange={(e) => {
                onChange({ currency: e.target.value as Currency });
              }}
              aria-label="Currency"
              className="h-8 w-[70px] rounded-[8px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 text-[11.5px] font-semibold text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="ILS">ILS</option>
            </select>
          </div>
        </div>

        {/* Sessions + Unlimited */}
        <div>
          <Eyebrow>Sessions</Eyebrow>
          <div className="flex items-center gap-2">
            <Stepper
              value={sessions}
              min={1}
              max={99}
              disabled={unlimitedSessions}
              onChange={(next) => {
                onChange({ sessions: next });
              }}
              ariaLabel="Sessions count"
            />
            <button
              type="button"
              onClick={() => {
                onChange({ unlimitedSessions: !unlimitedSessions });
              }}
              aria-pressed={unlimitedSessions}
              aria-label="Unlimited sessions"
              className={[
                "sk-press inline-flex h-10 items-center justify-center rounded-full border px-4 text-[13px] font-semibold transition-colors",
                unlimitedSessions
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]",
              ].join(" ")}
            >
              Unlimited
            </button>
          </div>
        </div>
      </div>

      {/* How artists pay — three radio cards */}
      <div>
        <Eyebrow>How artists pay</Eyebrow>
        <div className="flex flex-col gap-2">
          {PLAN_OPTIONS.map((opt) => {
            const picked = paymentPlan === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange({ paymentPlan: opt.id });
                }}
                role="radio"
                aria-checked={picked}
                className={[
                  "sk-press flex items-center gap-3 rounded-[12px] border p-[14px] text-left transition-colors",
                  picked
                    ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))]",
                ].join(" ")}
              >
                {/* Radio circle */}
                <span
                  aria-hidden
                  className={[
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    picked
                      ? "border-[rgb(var(--brand-primary))]"
                      : "border-[rgb(var(--border-strong))]",
                  ].join(" ")}
                >
                  {picked ? (
                    <span className="block h-2.5 w-2.5 rounded-full bg-[rgb(var(--brand-primary))]" />
                  ) : null}
                </span>

                {/* Title + subtitle */}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-display text-[15px] font-bold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                    {opt.title}
                  </span>
                  <span className="text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                    {opt.subtitle}
                  </span>
                </span>

                {/* Right-side amount */}
                <span className="shrink-0 text-right">
                  {opt.id === "full" ? (
                    <span className="font-display text-[14px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
                      {formatCurrency(curSym, price)}
                    </span>
                  ) : null}
                  {opt.id === "split" ? (
                    <span className="font-display text-[14px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
                      {formatCurrency(curSym, price / 2)} × 2
                    </span>
                  ) : null}
                  {opt.id === "installments" ? (
                    picked ? (
                      <span
                        className="flex flex-col items-end gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <Stepper
                          value={installmentsCount}
                          min={2}
                          max={12}
                          onChange={(next) => {
                            onChange({ installmentsCount: next });
                          }}
                          ariaLabel="Installments count"
                        />
                        <span className="text-[11px] text-[rgb(var(--fg-muted))] tabular-nums">
                          {formatCurrency(curSym, installmentAmt)} × {installmentsCount}
                        </span>
                      </span>
                    ) : (
                      <span className="font-display text-[14px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
                        {formatCurrency(curSym, installmentAmt)} × {installmentsCount}
                      </span>
                    )
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
