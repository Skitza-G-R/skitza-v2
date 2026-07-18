// pricing-step.tsx
//
// Stage 3 of the producer Store wizard. Two panels under one step:
//   * "One flat price" (default) — price + currency + sessions + plan.
//   * "Per song with discounts"   — a 3-column rate-card ladder
//     (when booking · per song · total) + an artist-facing preview.
//
// The "How do you want to charge?" segmented pill at the top swaps
// the panel. Wizard math + artist stepper math + server booking math
// all share ~/lib/pricing's pure helpers (totalFor / fromPrice). The
// PREVIEW_QTYS constant + seedPerSongTiers helper are exported for
// the unit tests in ./__tests__/pricing-step.test.ts.

"use client";

import { Minus, Plus, X } from "lucide-react";

import { fromPrice, type VolumeTier } from "~/lib/pricing";
import { applyTaxToCents, type TaxMode, taxModePricingNote } from "~/lib/tax-mode";
import { TaxModeSegmented } from "~/components/dashboard/tax-mode-segmented";

type Currency = "USD" | "EUR" | "GBP" | "ILS";
type PricingModel = "flat" | "per_song";

const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

// Sample qtys used only by tests (regression — totalFor agreement).
// The rate-card table renders totals inline per row so a separate
// 4-row "Live preview" card is no longer shipped; the constant is
// kept for math-regression tests in pricing-step.test.ts.
export const PREVIEW_QTYS = [1, 3, 5, 10] as const;
export const MAX_VOLUME_TIERS = 10;

// First-toggle-on seed: base tier at the producer's current flat price
// + one discount tier at 5 songs / 15% off. Producer can keep, edit, or
// delete the discount row from there.
export function seedPerSongTiers(basePriceCents: number): VolumeTier[] {
  return [
    { minQty: 1, pricePerUnitCents: basePriceCents },
    { minQty: 5, pricePerUnitCents: Math.round(basePriceCents * 0.85) },
  ];
}

export function appendDiscountTier(
  volumeTiers: readonly VolumeTier[],
  fallbackPriceCents: number,
): VolumeTier[] {
  if (volumeTiers.length >= MAX_VOLUME_TIERS) return [...volumeTiers];
  const last = volumeTiers.at(-1) ?? {
    minQty: 1,
    pricePerUnitCents: fallbackPriceCents,
  };
  return [
    ...volumeTiers,
    {
      minQty: last.minQty + 5,
      pricePerUnitCents: Math.round(last.pricePerUnitCents * 0.85),
    },
  ];
}

interface PricingStepProps {
  price: number;
  currency: Currency;
  sessions: number;
  unlimitedSessions: boolean;
  pricingModel: PricingModel;
  volumeTiers: VolumeTier[];
  // Producer's business-level tax mode + rate (migration 0019). Drives
  // BOTH the inline toggle the producer interacts with AND the live
  // "Artists pay $X" preview below it. The toggle is the only place
  // tax mode is editable in v2 — Settings + Storefront no longer
  // expose it. When `onTaxChange` is undefined (e.g. onboarding) the
  // tax section is hidden entirely.
  taxMode?: TaxMode;
  taxRatePct?: number;
  onTaxChange?: (patch: { taxMode?: TaxMode; taxRatePct?: number }) => void;
  // Optional error surface for the fire-and-forget tax save. Renders
  // a small danger-color line below the toggle when set. Pending
  // state is deliberately NOT surfaced — the toggle's slide
  // animation is the only feedback the producer gets, so a
  // server roundtrip + router.refresh() doesn't make the
  // optimistic move feel slow.
  taxError?: string | null;
  /** Exact client-side commercial validation shown beside the cash inputs. */
  priceError?: string | null;
  // When false, the "How do you want to charge?" pill is hidden and
  // the step renders flat-price-only. Used by onboarding's first-
  // service wizard, which intentionally stays simple. Default true
  // matches the producer Store wizard's full surface.
  allowPerSong?: boolean;
  onChange: (
    patch: Partial<{
      price: number;
      currency: Currency;
      sessions: number;
      unlimitedSessions: boolean;
      pricingModel: PricingModel;
      volumeTiers: VolumeTier[];
    }>,
  ) => void;
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
  // Shared button class — picked out to keep both -/+ in lockstep.
  // transition-[background-color,transform] (not transition-colors) so
  // the active scale animates too. focus-visible ring matches the
  // pattern from .s-select. active:scale-[0.94] gives the instant
  // "interface heard you" feedback Emil prescribes for press states.
  const btnClass = [
    "inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-default))] sm:h-8 sm:w-8 sm:rounded-[var(--radius-sm)]",
    "transition-[background-color,transform] duration-150",
    "hover:bg-[rgb(17_16_9/0.06)]",
    "active:scale-[0.94]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
    "disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100",
  ].join(" ");
  return (
    <div
      className={[
        "inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] sm:h-11 sm:rounded-[var(--radius-md)] sm:p-1",
        "transition-[opacity,border-color] duration-200",
        disabled
          ? "border-[rgb(var(--border-subtle))] opacity-50"
          : "border-[rgb(var(--border-subtle))]",
      ].join(" ")}
      style={{ transitionTimingFunction: "var(--ease-out-strong)" }}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={() => {
          if (canDec) onChange(value - 1);
        }}
        disabled={!canDec}
        aria-label="Decrease"
        className={btnClass}
        style={{ transitionTimingFunction: "var(--ease-press)" }}
      >
        <Minus size={14} strokeWidth={2.4} aria-hidden />
      </button>
      <span className="font-display min-w-[2.5ch] text-center text-[16px] leading-none font-bold text-[rgb(var(--fg-default))] tabular-nums">
        {value}
      </span>
      <button
        type="button"
        onClick={() => {
          if (canInc) onChange(value + 1);
        }}
        disabled={!canInc}
        aria-label="Increase"
        className={btnClass}
        style={{ transitionTimingFunction: "var(--ease-press)" }}
      >
        <Plus size={14} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10.5px] font-[var(--font-outfit)] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
      {children}
    </div>
  );
}

const PRICING_MODELS: { id: PricingModel; label: string }[] = [
  { id: "flat", label: "One flat price" },
  { id: "per_song", label: "Per song with discounts" },
];

function formatCurrency(symbol: string, amount: number): string {
  return `${symbol}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function ProductTaxSection({
  taxMode,
  taxRatePct,
  price,
  pricingNote,
  error,
  onChange,
}: {
  taxMode: TaxMode;
  taxRatePct: number;
  price: number;
  pricingNote: string;
  error: string | null;
  onChange: (patch: { taxMode?: TaxMode; taxRatePct?: number }) => void;
}) {
  return (
    <section className="border-t border-[rgb(var(--border-subtle))] pt-4" aria-label="Tax settings">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-end">
        <div>
          <Eyebrow>Tax</Eyebrow>
          <p className="text-[11.5px] text-[rgb(var(--fg-faint))]">Applies to all products</p>
        </div>
        <div
          className={
            taxMode === "tax_free"
              ? "min-w-0"
              : "grid min-w-0 grid-cols-[minmax(0,1fr)_72px] items-center gap-2"
          }
        >
          <TaxModeSegmented
            value={taxMode}
            onChange={(next) => {
              onChange({ taxMode: next });
            }}
            size="lg"
            className="!h-[52px] min-w-0 sm:!h-11 [&>button]:min-h-11 [&>button]:min-w-0 [&>button]:px-2 sm:[&>button]:min-h-0 sm:[&>button]:px-3"
            ariaLabel="Tax disclosure mode"
          />
          {taxMode !== "tax_free" ? (
            <div className="flex h-[52px] items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] pr-1 pl-2 focus-within:border-[rgb(var(--brand-primary))] focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.12)] sm:h-11 sm:rounded-[var(--radius-md)]">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={taxRatePct}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  onChange({
                    taxRatePct: Math.max(0, Math.min(100, Math.round(next))),
                  });
                }}
                aria-label="Tax rate percentage"
                className="font-display h-full w-10 border-none bg-transparent text-right text-base leading-none font-bold text-[rgb(var(--fg-default))] tabular-nums outline-none sm:text-[14px]"
              />
              <span
                aria-hidden
                className="pr-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))]"
              >
                %
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div
        key={`${taxMode}-${String(taxRatePct)}-${String(price)}`}
        className="reveal-up mt-2 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]"
        aria-live="polite"
      >
        {pricingNote}
      </div>
      {error ? (
        <div className="mt-1.5 text-[11.5px] text-[rgb(var(--fg-danger))]" role="alert">
          Couldn&apos;t save: {error}
        </div>
      ) : null}
    </section>
  );
}

export function PricingStep({
  price,
  currency,
  sessions,
  unlimitedSessions,
  pricingModel,
  volumeTiers,
  taxMode = "tax_free",
  taxRatePct = 18,
  onTaxChange,
  taxError = null,
  priceError = null,
  allowPerSong = true,
  onChange,
}: PricingStepProps) {
  // Show the tax UI only when a callback is wired — onboarding mounts
  // this step without producer state and the section should be hidden
  // there. Narrow once into a local non-undefined ref so the JSX below
  // can call it directly (eslint's no-unnecessary-condition rule
  // doesn't see a `typeof` guard through the JSX boundary).
  const taxChange = onTaxChange;
  const curSym = CURRENCY_SYMBOL[currency];
  // Live tax preview — formats the same currency the price input uses
  // so the post-tax amount reads as a direct comparison to whatever
  // the producer just typed. Skipped when tax_free (no math, no point).
  const postTaxCents = applyTaxToCents(Math.round(price * 100), taxMode, taxRatePct);
  const taxPricingNote = taxModePricingNote(
    taxMode,
    taxRatePct,
    formatCurrency(curSym, price),
    formatCurrency(curSym, postTaxCents / 100),
  );

  function handleModelChange(next: PricingModel) {
    if (next === pricingModel) return;
    if (next === "per_song") {
      const basePriceCents = Math.round(price * 100);
      const seeded = volumeTiers.length > 0 ? volumeTiers : seedPerSongTiers(basePriceCents);
      onChange({ pricingModel: "per_song", volumeTiers: seeded });
    } else {
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
    const realIndex = index + 1;
    const next = volumeTiers.map((t, i) => (i === realIndex ? { ...t, ...patch } : t));
    onChange({ volumeTiers: next });
  }

  function addDiscountTier() {
    const next = appendDiscountTier(volumeTiers, Math.round(price * 100));
    if (next.length === volumeTiers.length) return;
    onChange({ volumeTiers: next });
  }

  function removeDiscountTier(index: number) {
    const realIndex = index + 1;
    onChange({ volumeTiers: volumeTiers.filter((_, i) => i !== realIndex) });
  }

  const baseCents = volumeTiers[0]?.pricePerUnitCents ?? Math.round(price * 100);
  const discountTiers = volumeTiers.slice(1);
  const previewFromCents = volumeTiers.length > 0 ? fromPrice(volumeTiers) : baseCents;
  const hasDiscounts = discountTiers.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Pricing-model segmented control. Single row, two segments,
          active state filled with brand-primary. Standard binary
          mode-switch pattern (Linear / Figma / Apple Settings). */}
      {allowPerSong ? (
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-[10.5px] font-[var(--font-outfit)] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
            How do you want to charge?
          </legend>
          <div className="inline-flex w-full rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 sm:w-auto">
            {PRICING_MODELS.map((m) => {
              const picked = pricingModel === m.id;
              return (
                <label
                  key={m.id}
                  className={[
                    "sk-press min-h-11 flex-1 cursor-pointer rounded-[var(--radius-lg)] px-3 py-2 text-center text-[13px] leading-snug font-semibold transition-colors focus-within:ring-2 focus-within:ring-[rgb(var(--brand-primary)/0.45)] focus-within:ring-offset-1 focus-within:ring-offset-[rgb(var(--bg-elevated))] focus-within:outline-none sm:min-h-0 sm:flex-initial sm:rounded-[var(--radius-sm)] sm:px-4 sm:py-1.5",
                    picked
                      ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))] shadow-[0_2px_12px_rgb(var(--brand-primary)/0.22)]"
                      : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="product-pricing-model"
                    value={m.id}
                    checked={picked}
                    onChange={() => {
                      handleModelChange(m.id);
                    }}
                    className="sr-only"
                  />
                  {m.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {pricingModel === "flat" || !allowPerSong ? (
        // ── Flat-price panel ──────────────────────────────────────────
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] sm:gap-4">
            <div className="flex flex-col gap-2">
              <Eyebrow>Price</Eyebrow>
              <div className="flex h-[52px] items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[0_1px_2px_rgba(17,16,9,0.03)] transition-[border-color,box-shadow] focus-within:border-[rgb(var(--brand-primary))] focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.12)] sm:h-11">
                <span
                  aria-hidden
                  className="font-display pl-3 text-[18px] font-bold text-[rgb(var(--fg-muted))]"
                >
                  {curSym}
                </span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    onChange({ price: Number(e.target.value) || 0 });
                  }}
                  aria-label="Price"
                  aria-invalid={priceError !== null}
                  aria-describedby={priceError ? "pricing-step-error" : undefined}
                  className="font-display h-full min-w-0 flex-1 border-none bg-transparent px-2 py-1 text-[19px] font-bold text-[rgb(var(--fg-default))] tabular-nums outline-none placeholder:text-[rgb(var(--fg-faint))]"
                />
                <div className="flex h-7 shrink-0 items-center border-l border-[rgb(var(--border-subtle))] px-2.5">
                  <select
                    value={currency}
                    onChange={(e) => {
                      onChange({ currency: e.target.value as Currency });
                    }}
                    aria-label="Currency"
                    className="h-full w-[60px] border-none bg-transparent text-[12px] font-bold tracking-[0.02em] text-[rgb(var(--fg-muted))] outline-none"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="ILS">ILS</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <Eyebrow>Sessions</Eyebrow>
              <div
                className="flex h-[52px] min-w-0 gap-2 sm:h-11"
                role="group"
                aria-label="Sessions"
              >
                <div
                  className={[
                    "grid h-full min-w-[132px] flex-[1.1] grid-cols-[1fr_auto_1fr] items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1 shadow-[0_1px_2px_rgba(17,16,9,0.03)] transition-opacity",
                    unlimitedSessions ? "opacity-45" : "opacity-100",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (sessions > 1 && !unlimitedSessions) {
                        onChange({ sessions: sessions - 1 });
                      }
                    }}
                    disabled={unlimitedSessions || sessions <= 1}
                    aria-label="Decrease sessions"
                    className="inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] text-[rgb(var(--fg-default))] transition-[background-color,transform] duration-150 hover:bg-[rgb(17_16_9/0.06)] active:scale-[0.94] disabled:cursor-not-allowed disabled:active:scale-100 sm:h-8 sm:rounded-[var(--radius-sm)]"
                    style={{ transitionTimingFunction: "var(--ease-press)" }}
                  >
                    <Minus size={14} strokeWidth={2.4} aria-hidden />
                  </button>
                  <span
                    className="font-display min-w-[2.5ch] text-center text-[19px] leading-none font-bold text-[rgb(var(--fg-default))] tabular-nums"
                    aria-live="polite"
                  >
                    {sessions}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (sessions < 99 && !unlimitedSessions) {
                        onChange({ sessions: sessions + 1 });
                      }
                    }}
                    disabled={unlimitedSessions || sessions >= 99}
                    aria-label="Increase sessions"
                    className="inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] text-[rgb(var(--fg-default))] transition-[background-color,transform] duration-150 hover:bg-[rgb(17_16_9/0.06)] active:scale-[0.94] disabled:cursor-not-allowed disabled:active:scale-100 sm:h-8 sm:rounded-[var(--radius-sm)]"
                    style={{ transitionTimingFunction: "var(--ease-press)" }}
                  >
                    <Plus size={14} strokeWidth={2.4} aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ unlimitedSessions: !unlimitedSessions });
                  }}
                  aria-pressed={unlimitedSessions}
                  aria-label="Unlimited sessions"
                  className={[
                    "sk-press inline-flex h-full min-w-0 flex-1 items-center justify-center rounded-[var(--radius-lg)] border px-3 text-[12px] font-semibold transition-[background-color,border-color,color,transform] duration-150",
                    unlimitedSessions
                      ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))] shadow-[0_2px_12px_rgb(var(--brand-primary)/0.18)]"
                      : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] shadow-[0_1px_2px_rgba(17,16,9,0.03)] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-default))]",
                  ].join(" ")}
                >
                  Unlimited
                </button>
              </div>
            </div>
          </div>

          {taxChange ? (
            <ProductTaxSection
              taxMode={taxMode}
              taxRatePct={taxRatePct}
              price={price}
              pricingNote={taxPricingNote}
              error={taxError}
              onChange={taxChange}
            />
          ) : null}
        </>
      ) : (
        // ── Per-song rate card ────────────────────────────────────────
        // One object. 3 columns: when booking · per song · total.
        // Total column shows the floor at each tier (exact at base,
        // "+" suffix on discount rows where it's a minimum).
        // "Artists will see" footer renders the exact store-card copy
        // so the producer validates buyer-facing language inline.
        <>
          {/* Sessions per song — same control as the flat panel, but
              the value means "sessions reserved per song the artist
              picks." Booking-time math multiplies by songQty (see
              computeProjectSessionCount in ~/lib/pricing). Eyebrow +
              tiny descriptor on the left, control on the right —
              reads as a supporting note to the rate ladder below,
              not a rival heading. Wraps cleanly on narrow widths. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-baseline gap-2">
              <Eyebrow>Sessions per song</Eyebrow>
              <span className="text-[11px] text-[rgb(var(--fg-muted))]">
                what each song includes
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Stepper
                value={sessions}
                min={1}
                max={99}
                disabled={unlimitedSessions}
                onChange={(next) => {
                  onChange({ sessions: next });
                }}
                ariaLabel="Sessions per song"
              />
              <button
                type="button"
                onClick={() => {
                  onChange({ unlimitedSessions: !unlimitedSessions });
                }}
                aria-pressed={unlimitedSessions}
                aria-label="Unlimited sessions"
                className={[
                  "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border px-4 text-[13px] font-semibold sm:h-10 sm:rounded-[var(--radius-md)]",
                  "transition-[background-color,border-color,color] duration-200",
                  unlimitedSessions
                    ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]",
                ].join(" ")}
                style={{ transitionTimingFunction: "var(--ease-out-strong)" }}
              >
                Unlimited
              </button>
            </div>
          </div>

          <div>
            <Eyebrow>Pricing ladder</Eyebrow>
            <div className="overflow-hidden rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
              {/* Card header — currency picker + eyebrow */}
              <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.02)] px-3 py-1.5">
                <span className="text-[10.5px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
                  Edit your rate
                </span>
                <select
                  value={currency}
                  onChange={(e) => {
                    onChange({ currency: e.target.value as Currency });
                  }}
                  aria-label="Currency"
                  className="h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base font-semibold text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none sm:h-8 sm:rounded-[var(--radius-sm)] sm:px-2 sm:text-[11.5px]"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="ILS">ILS</option>
                </select>
              </div>

              {/* Base row */}
              <div className="grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3 sm:py-2.5">
                <span className="flex items-center justify-between gap-3 text-[14px] text-[rgb(var(--fg-default))] sm:block">
                  <span>1 song</span>
                  <span className="font-display text-[14px] font-bold tabular-nums sm:hidden">
                    {formatCurrency(curSym, baseCents / 100)}
                  </span>
                </span>
                <div className="flex min-h-11 w-full min-w-0 items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 focus-within:border-[rgb(var(--brand-primary))] sm:min-h-0 sm:w-auto sm:rounded-[var(--radius-sm)] sm:py-1">
                  <span
                    aria-hidden
                    className="text-[13px] font-semibold text-[rgb(var(--fg-muted))]"
                  >
                    {curSym}
                  </span>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    inputMode="decimal"
                    value={Math.round(baseCents) / 100}
                    onChange={(e) => {
                      updateBaseTier(Number(e.target.value) || 0);
                    }}
                    aria-label="Base price per song"
                    aria-invalid={baseCents <= 0}
                    aria-describedby={priceError ? "pricing-step-error" : undefined}
                    className="font-display h-11 min-w-0 flex-1 border-none bg-transparent text-right text-base font-bold text-[rgb(var(--fg-default))] tabular-nums outline-none sm:h-full sm:w-16 sm:flex-none sm:text-[14px]"
                  />
                  <span className="text-[12px] text-[rgb(var(--fg-muted))]">/song</span>
                </div>
                <span className="font-display hidden w-20 text-right text-[14px] font-bold text-[rgb(var(--fg-default))] tabular-nums sm:block">
                  {formatCurrency(curSym, baseCents / 100)}
                </span>
              </div>

              {/* Discount rows */}
              {discountTiers.map((tier, i) => {
                const total = (tier.minQty * tier.pricePerUnitCents) / 100;
                return (
                  <div
                    key={i}
                    className="grid grid-cols-1 gap-2 border-t border-[rgb(var(--border-subtle))] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_36px] sm:items-center sm:gap-3 sm:py-2.5"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2 sm:contents">
                      <span className="flex min-w-0 items-center gap-1.5 text-[14px] text-[rgb(var(--fg-default))]">
                        <input
                          type="number"
                          min={2}
                          value={tier.minQty}
                          onChange={(e) => {
                            const next = Math.max(2, Number(e.target.value) || 2);
                            updateDiscountTier(i, { minQty: next });
                          }}
                          aria-label={`Discount tier ${String(i + 1)} minimum songs`}
                          className="font-display h-11 w-14 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-1.5 text-center text-base font-bold text-[rgb(var(--fg-default))] tabular-nums outline-none focus:border-[rgb(var(--brand-primary))] sm:h-8 sm:w-12 sm:rounded-[var(--radius-sm)] sm:text-[14px]"
                        />
                        <span className="min-w-0 text-[13px] leading-tight text-[rgb(var(--fg-muted))] sm:text-[14px]">
                          or more songs
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          removeDiscountTier(i);
                        }}
                        aria-label={`Remove discount tier ${String(i + 1)}`}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] sm:col-start-4 sm:h-9 sm:w-9"
                      >
                        <X size={13} strokeWidth={2.4} aria-hidden />
                      </button>
                    </div>
                    <div className="flex min-w-0 items-center justify-between gap-2 sm:contents">
                      <div className="flex min-h-11 max-w-[190px] min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 focus-within:border-[rgb(var(--brand-primary))] sm:min-h-0 sm:w-auto sm:flex-none sm:rounded-[var(--radius-sm)] sm:py-1">
                        <span
                          aria-hidden
                          className="text-[13px] font-semibold text-[rgb(var(--fg-muted))]"
                        >
                          {curSym}
                        </span>
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={Math.round(tier.pricePerUnitCents) / 100}
                          onChange={(e) => {
                            const cents = Math.round((Number(e.target.value) || 0) * 100);
                            updateDiscountTier(i, { pricePerUnitCents: cents });
                          }}
                          aria-label={`Discount tier ${String(i + 1)} price per song`}
                          aria-invalid={tier.pricePerUnitCents <= 0}
                          aria-describedby={priceError ? "pricing-step-error" : undefined}
                          className="font-display h-11 min-w-0 flex-1 border-none bg-transparent text-right text-base font-bold text-[rgb(var(--fg-default))] tabular-nums outline-none sm:h-full sm:w-16 sm:flex-none sm:text-[14px]"
                        />
                        <span className="text-[12px] text-[rgb(var(--fg-muted))]">/song</span>
                      </div>
                      <span className="font-display shrink-0 text-right text-[14px] font-bold text-[rgb(var(--fg-default))] tabular-nums sm:w-20">
                        {formatCurrency(curSym, total)}
                        <span className="ml-0.5 text-[rgb(var(--fg-muted))]">+</span>
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Add-tier row — inline with the table, not a floating
                  button. Belongs to the rate card. */}
              <button
                type="button"
                onClick={addDiscountTier}
                disabled={volumeTiers.length >= MAX_VOLUME_TIERS}
                aria-describedby="volume-tier-limit-help"
                className="sk-press flex min-h-11 w-full items-center gap-2 border-t border-[rgb(var(--border-subtle))] px-3 py-2 text-left text-[13px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(17_16_9/0.04)] hover:text-[rgb(var(--fg-default))] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Plus size={14} strokeWidth={2.4} aria-hidden />
                {volumeTiers.length >= MAX_VOLUME_TIERS
                  ? "Maximum of 10 tiers reached"
                  : "Add another tier"}
              </button>
            </div>
            <p id="volume-tier-limit-help" className="sr-only">
              Per-song pricing supports up to 10 tiers.
            </p>
          </div>

          {/* Artists will see — exact preview of the store-card copy.
              Replaces the abstract 4-row sample preview: the producer
              validates the buyer-facing label as they edit. */}
          <div>
            <Eyebrow>Artists will see</Eyebrow>
            <div className="rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.02)] px-3 py-2.5">
              <span className="font-display text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                From {formatCurrency(curSym, previewFromCents / 100)} / song
              </span>
              {hasDiscounts ? (
                <span className="text-[14px] text-[rgb(var(--fg-muted))]">
                  {" · Discounts for bigger projects"}
                </span>
              ) : null}
            </div>
          </div>

          {taxChange ? (
            <ProductTaxSection
              taxMode={taxMode}
              taxRatePct={taxRatePct}
              price={price}
              pricingNote={taxPricingNote}
              error={taxError}
              onChange={taxChange}
            />
          ) : null}
        </>
      )}

      {priceError ? (
        <p
          id="pricing-step-error"
          role="alert"
          className="text-[12.5px] font-medium text-[rgb(var(--fg-danger))]"
        >
          {priceError}
        </p>
      ) : null}
    </div>
  );
}
