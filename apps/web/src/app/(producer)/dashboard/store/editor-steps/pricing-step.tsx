// pricing-step.tsx
//
// Stage 3 of the producer Store wizard. Two panels under one step:
//   * "One flat price" (default) — price + currency + sessions + plan.
//   * "Per song"                 — base price + ascending discount
//                                  ladder + 4-row live preview.
//
// The "How do you want to charge?" toggle at the top swaps the panel.
// Wizard preview math + artist stepper math + server booking math all
// share ~/lib/pricing's pure helpers (totalFor / fromPrice). The
// PREVIEW_QTYS constant + seedPerSongTiers helper are exported for
// the unit tests in ./__tests__/pricing-step.test.ts.

"use client";

import { Minus, Plus, X } from "lucide-react";

import { totalFor, type VolumeTier } from "~/lib/pricing";

type Currency = "USD" | "EUR" | "GBP" | "ILS";
type PaymentPlan = "full" | "split" | "installments";
type PricingModel = "flat" | "per_song";

const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

// Live-preview row counts. 4 fixed samples chosen for legibility:
// single, small bundle, first discount tier (per the default seed),
// and full album.
export const PREVIEW_QTYS = [1, 3, 5, 10] as const;

// First-toggle-on seed: base tier at the producer's current flat price
// + one discount tier at 5 songs / 15% off. Producer can keep, edit, or
// delete the discount row from there.
export function seedPerSongTiers(basePriceCents: number): VolumeTier[] {
  return [
    { minQty: 1, pricePerUnitCents: basePriceCents },
    { minQty: 5, pricePerUnitCents: Math.round(basePriceCents * 0.85) },
  ];
}

interface PricingStepProps {
  price: number;
  currency: Currency;
  sessions: number;
  unlimitedSessions: boolean;
  paymentPlan: PaymentPlan;
  installmentsCount: number;
  pricingModel: PricingModel;
  volumeTiers: VolumeTier[];
  // When false, the "How do you want to charge?" radio is hidden and
  // the step renders flat-price-only. Used by onboarding's first-
  // service wizard, which intentionally stays simple. Default true
  // matches the producer Store wizard's full surface.
  allowPerSong?: boolean;
  onChange: (patch: Partial<{
    price: number;
    currency: Currency;
    sessions: number;
    unlimitedSessions: boolean;
    paymentPlan: PaymentPlan;
    installmentsCount: number;
    pricingModel: PricingModel;
    volumeTiers: VolumeTier[];
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

const PRICING_MODELS: { id: PricingModel; title: string; subtitle: string }[] = [
  { id: "flat", title: "One flat price", subtitle: "Same total, any project." },
  { id: "per_song", title: "Per song", subtitle: "Discounts as song count grows." },
];

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
  pricingModel,
  volumeTiers,
  allowPerSong = true,
  onChange,
}: PricingStepProps) {
  const curSym = CURRENCY_SYMBOL[currency];
  const installmentAmt =
    installmentsCount > 0 ? Math.round(price / installmentsCount) : 0;

  function handleModelChange(next: PricingModel) {
    if (next === pricingModel) return;
    if (next === "per_song") {
      const basePriceCents = Math.round(price * 100);
      const seeded =
        volumeTiers.length > 0 ? volumeTiers : seedPerSongTiers(basePriceCents);
      onChange({ pricingModel: "per_song", volumeTiers: seeded });
    } else {
      // Toggling back to flat clears the ladder. The flat `price`
      // value is preserved (it lives outside volumeTiers).
      onChange({ pricingModel: "flat", volumeTiers: [] });
    }
  }

  function updateBaseTier(nextDollars: number) {
    const cents = Math.round(nextDollars * 100);
    const next: VolumeTier[] = volumeTiers.length
      ? [{ minQty: 1, pricePerUnitCents: cents }, ...volumeTiers.slice(1)]
      : [{ minQty: 1, pricePerUnitCents: cents }];
    onChange({ price: nextDollars, volumeTiers: next });
  }

  function updateDiscountTier(index: number, patch: Partial<VolumeTier>) {
    // index here is 0-based against the discount slice (skipping base).
    const realIndex = index + 1;
    const next = volumeTiers.map((t, i) => (i === realIndex ? { ...t, ...patch } : t));
    onChange({ volumeTiers: next });
  }

  function addDiscountTier() {
    const last = volumeTiers.at(-1) ?? {
      minQty: 1,
      pricePerUnitCents: Math.round(price * 100),
    };
    const next: VolumeTier = {
      minQty: last.minQty + 5,
      pricePerUnitCents: Math.round(last.pricePerUnitCents * 0.85),
    };
    onChange({ volumeTiers: [...volumeTiers, next] });
  }

  function removeDiscountTier(index: number) {
    // index is 0-based against the discount slice.
    const realIndex = index + 1;
    onChange({ volumeTiers: volumeTiers.filter((_, i) => i !== realIndex) });
  }

  const baseCents = volumeTiers[0]?.pricePerUnitCents ?? Math.round(price * 100);
  const discountTiers = volumeTiers.slice(1);

  return (
    <div className="flex flex-col gap-4">
      {/* Pricing model toggle — appears above both panels. */}
      {allowPerSong ? (
      <div>
        <Eyebrow>How do you want to charge?</Eyebrow>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PRICING_MODELS.map((m) => {
            const picked = pricingModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  handleModelChange(m.id);
                }}
                role="radio"
                aria-checked={picked}
                aria-label={m.title}
                className={[
                  "sk-press flex items-center gap-3 rounded-[12px] border p-[14px] text-left transition-colors",
                  picked
                    ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))]",
                ].join(" ")}
              >
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
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-display text-[15px] font-bold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                    {m.title}
                  </span>
                  <span className="text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                    {m.subtitle}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      ) : null}

      {pricingModel === "flat" || !allowPerSong ? (
        // ── Flat-price panel (unchanged from the v1 design) ──────────
        <>
          {/* Top row: Price + Currency / Sessions + Unlimited */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-display text-[15px] font-bold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                        {opt.title}
                      </span>
                      <span className="text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                        {opt.subtitle}
                      </span>
                    </span>

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
        </>
      ) : (
        // ── Per-song panel ────────────────────────────────────────────
        <>
          {/* Base price per song */}
          <div>
            <Eyebrow>Base price per song</Eyebrow>
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
                value={Math.round(baseCents) / 100}
                onChange={(e) => {
                  updateBaseTier(Number(e.target.value) || 0);
                }}
                aria-label="Base price per song"
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

          {/* Discount tiers */}
          <div>
            <Eyebrow>Discounts (optional)</Eyebrow>
            {discountTiers.length === 0 ? (
              <p className="mb-2 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                No discounts yet. Artists pay the base rate at every song count.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {discountTiers.map((tier, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2"
                  >
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-[rgb(var(--fg-muted))]">
                      Songs ≥
                    </span>
                    <input
                      type="number"
                      min={2}
                      value={tier.minQty}
                      onChange={(e) => {
                        const next = Math.max(2, Number(e.target.value) || 2);
                        updateDiscountTier(i, { minQty: next });
                      }}
                      aria-label={`Discount tier ${String(i + 1)} minimum songs`}
                      className="w-14 rounded-[8px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1 text-center font-display text-[14px] font-bold tabular-nums text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))]"
                    />
                    <span className="text-[14px] text-[rgb(var(--fg-muted))]">→</span>
                    <span className="text-[14px] font-semibold text-[rgb(var(--fg-muted))]">
                      {curSym}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={Math.round(tier.pricePerUnitCents) / 100}
                      onChange={(e) => {
                        const cents = Math.round((Number(e.target.value) || 0) * 100);
                        updateDiscountTier(i, { pricePerUnitCents: cents });
                      }}
                      aria-label={`Discount tier ${String(i + 1)} price per song`}
                      className="w-20 rounded-[8px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1 text-right font-display text-[14px] font-bold tabular-nums text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))]"
                    />
                    <span className="text-[12px] text-[rgb(var(--fg-muted))]">each</span>
                    <button
                      type="button"
                      onClick={() => {
                        removeDiscountTier(i);
                      }}
                      aria-label={`Remove discount tier ${String(i + 1)}`}
                      className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
                    >
                      <X size={14} strokeWidth={2.4} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addDiscountTier}
              className="sk-press mt-2 inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-dashed border-[rgb(var(--border-strong))] bg-transparent px-3 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(17_16_9/0.04)]"
            >
              <Plus size={14} strokeWidth={2.4} aria-hidden />
              Add another discount
            </button>
          </div>

          {/* Live preview — 4 fixed sample counts. Always visible while
              the producer is editing so the math feels concrete. */}
          <div>
            <Eyebrow>Live preview</Eyebrow>
            <div className="rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
              {PREVIEW_QTYS.map((qty, i) => {
                const total = totalFor(qty, volumeTiers);
                return (
                  <div
                    key={qty}
                    className={[
                      "flex items-center justify-between px-3 py-2",
                      i < PREVIEW_QTYS.length - 1
                        ? "border-b border-[rgb(var(--border-subtle))]"
                        : "",
                    ].join(" ")}
                  >
                    <span className="text-[13px] text-[rgb(var(--fg-muted))] tabular-nums">
                      {qty} {qty === 1 ? "song" : "songs"}
                    </span>
                    <span className="font-display text-[15px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
                      {formatCurrency(curSym, total / 100)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
