// pricing-step.tsx
//
// Stage 3 of the producer Store wizard — price, currency, sessions count
// (with unlimited toggle), deposit %, payment plan (full / 50-50 split /
// installments), duration, revisions, turnaround. Ported from the
// prototype `storefront.html` PricingStep (line 994), expanded to cover
// all Phase 2 fields.

"use client";

import { Minus, Plus } from "lucide-react";

import { Toggle } from "../toggle";

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
  depositPct: number;
  paymentPlan: PaymentPlan;
  installmentsCount: number;
  duration: string;
  revisions: number;
  turnaround: string;
  onChange: (patch: Partial<{
    price: number;
    currency: Currency;
    sessions: number;
    unlimitedSessions: boolean;
    depositPct: number;
    paymentPlan: PaymentPlan;
    installmentsCount: number;
    duration: string;
    revisions: number;
    turnaround: string;
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-30"
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus size={14} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
      {children}
    </div>
  );
}

const PLAN_OPTIONS: { id: PaymentPlan; title: string; subtitle: string }[] = [
  { id: "full", title: "Pay in full", subtitle: "One payment, upfront" },
  { id: "split", title: "50/50 split", subtitle: "Half on book, half on delivery" },
  { id: "installments", title: "Installments", subtitle: "Monthly equal payments" },
];

export function PricingStep({
  price,
  currency,
  sessions,
  unlimitedSessions,
  depositPct,
  paymentPlan,
  installmentsCount,
  duration,
  revisions,
  turnaround,
  onChange,
}: PricingStepProps) {
  const installmentAmt =
    installmentsCount > 0 ? Math.round(price / installmentsCount) : 0;
  const curSym = CURRENCY_SYMBOL[currency];

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Price + Currency */}
      <div>
        <Eyebrow>Price</Eyebrow>
        <div className="flex items-center gap-2 rounded-[12px] border border-[rgb(var(--border-subtle))] bg-white px-3.5 py-1.5 shadow-[0_1px_2px_rgba(17,16,9,0.03)] focus-within:border-[rgb(var(--brand-primary))] focus-within:ring-2 focus-within:ring-[rgb(var(--brand-primary)/0.25)]">
          <span
            aria-hidden
            className="font-display text-[22px] font-bold text-[rgb(var(--fg-muted))]"
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
            className="min-w-0 flex-1 border-none bg-transparent py-1 font-display text-[22px] font-bold tabular-nums text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))]"
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

      {/* 2. Sessions row */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col">
          <Eyebrow>Sessions</Eyebrow>
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
        </div>
        <div className="flex flex-col items-end">
          <Eyebrow>Unlimited</Eyebrow>
          <div className="h-10 inline-flex items-center">
            <Toggle
              on={unlimitedSessions}
              ariaLabel="Unlimited sessions"
              onChange={() => {
                onChange({ unlimitedSessions: !unlimitedSessions });
              }}
            />
          </div>
        </div>
      </div>

      {/* 3. Deposit */}
      <div>
        <Eyebrow>Deposit</Eyebrow>
        <div className="flex items-center gap-2 rounded-[12px] border border-[rgb(var(--border-subtle))] bg-white px-3.5 py-1.5 shadow-[0_1px_2px_rgba(17,16,9,0.03)] focus-within:border-[rgb(var(--brand-primary))] focus-within:ring-2 focus-within:ring-[rgb(var(--brand-primary)/0.25)]">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            value={depositPct}
            onChange={(e) => {
              const raw = Number(e.target.value);
              const clamped = Number.isFinite(raw)
                ? Math.max(0, Math.min(100, Math.round(raw)))
                : 0;
              onChange({ depositPct: clamped });
            }}
            aria-label="Deposit percent"
            className="min-w-0 flex-1 border-none bg-transparent py-1 font-display text-[20px] font-bold tabular-nums text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))]"
          />
          <span
            aria-hidden
            className="font-display text-[20px] font-bold text-[rgb(var(--fg-muted))]"
          >
            %
          </span>
        </div>
        <div className="mt-1.5 text-[11.5px] text-[rgb(var(--fg-faint))]">
          0 means no deposit; 100 means pay in full upfront
        </div>
      </div>

      {/* 4. Payment plan */}
      <div>
        <Eyebrow>Payment plan</Eyebrow>
        <div className="grid grid-cols-3 gap-2">
          {PLAN_OPTIONS.map((opt) => {
            const picked = paymentPlan === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange({ paymentPlan: opt.id });
                }}
                aria-pressed={picked}
                className={[
                  "sk-press flex flex-col items-start gap-1 rounded-[12px] border bg-[rgb(var(--bg-elevated))] p-3 text-left transition-colors",
                  picked
                    ? "border-[rgb(var(--brand-primary))] shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.18)]"
                    : "border-[rgb(var(--border-subtle))] hover:border-[rgb(var(--border-strong))]",
                ].join(" ")}
              >
                <span className="font-display text-[13px] font-bold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                  {opt.title}
                </span>
                <span className="text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                  {opt.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {paymentPlan === "installments" ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-[10px] border border-[rgb(var(--brand-primary)/0.25)] bg-[rgb(var(--brand-primary)/0.06)] px-3 py-2.5">
            <span className="text-[11.5px] font-semibold text-[rgb(var(--fg-muted))]">
              Payments
            </span>
            <Stepper
              value={installmentsCount}
              min={2}
              max={12}
              onChange={(next) => {
                onChange({ installmentsCount: next });
              }}
              ariaLabel="Installments count"
            />
            <span
              aria-live="polite"
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--brand-primary-dark))] px-2.5 py-1 font-mono text-[11px] font-semibold text-white"
            >
              {curSym}
              {installmentAmt} × {installmentsCount}
            </span>
          </div>
        ) : null}
      </div>

      {/* 5. Duration */}
      <div>
        <Eyebrow>Duration</Eyebrow>
        <input
          type="text"
          value={duration}
          onChange={(e) => {
            onChange({ duration: e.target.value });
          }}
          placeholder="180 min"
          aria-label="Duration"
          className="h-10 w-full rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
        />
        <div className="mt-1.5 text-[11.5px] text-[rgb(var(--fg-faint))]">
          e.g. 60 min, 180 min, multi-session
        </div>
      </div>

      {/* 6. Revisions */}
      <div>
        <Eyebrow>Revisions</Eyebrow>
        <Stepper
          value={revisions}
          min={0}
          max={20}
          onChange={(next) => {
            onChange({ revisions: next });
          }}
          ariaLabel="Revisions count"
        />
      </div>

      {/* 7. Turnaround */}
      <div>
        <Eyebrow>Turnaround</Eyebrow>
        <input
          type="text"
          value={turnaround}
          onChange={(e) => {
            onChange({ turnaround: e.target.value });
          }}
          placeholder="5–7 days"
          aria-label="Turnaround"
          className="h-10 w-full rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
        />
        <div className="mt-1.5 text-[11.5px] text-[rgb(var(--fg-faint))]">
          e.g. 5–7 days, 6–10 weeks
        </div>
      </div>
    </div>
  );
}
