// song-count-stepper.tsx
//
// Pre-booking picker on the artist's per-song product page. The artist
// taps – / + to pick how many songs they're buying; the total updates
// live and the "save $X" hint reveals once a discount tier kicks in.
// On every change the parent receives { qty, unitPriceCents } so the
// downstream booking action can lock in the exact rate.
//
// The math lives in ~/lib/pricing (totalFor / unitPriceFor) so this
// component, the producer wizard's preview, and the booking write
// path all agree on what each row of the ladder costs.

"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

import {
  totalFor,
  unitPriceFor,
  type VolumeTier,
} from "~/lib/pricing";

export interface StepperState {
  qty: number;
  unitPriceCents: number;
  totalCents: number;
  savedCents: number;
}

// Pure math — exported so the unit test in __tests__/ can pin the
// state transitions without rendering React. Clamps qty ≥ 1 so a
// negative or zero qty never leaks into the booking write.
export function computeStepperState(
  qty: number,
  tiers: VolumeTier[],
): StepperState {
  const safeQty = Math.max(1, Math.floor(qty));
  // For empty tiers the helpers return 0 already, but we still
  // surface savedCents=0 explicitly so the caller can branch on it.
  const unit = unitPriceFor(safeQty, tiers);
  const total = totalFor(safeQty, tiers);
  const base = tiers[0]?.pricePerUnitCents ?? unit;
  const saved = Math.max(0, (base - unit) * safeQty);
  return {
    qty: safeQty,
    unitPriceCents: unit,
    totalCents: total,
    savedCents: saved,
  };
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

function formatCents(cents: number, currency: string): string {
  const prefix = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = (cents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  return `${prefix}${major}`;
}

interface SongCountStepperProps {
  tiers: VolumeTier[];
  currency: string;
  // Fires on every qty change. Parent uses this to drive the booking
  // CTA's locked-in price + qty.
  onChange: (state: { qty: number; unitPriceCents: number }) => void;
}

export function SongCountStepper({
  tiers,
  currency,
  onChange,
}: SongCountStepperProps) {
  const [qty, setQty] = useState(1);
  const state = computeStepperState(qty, tiers);

  // Notify parent on every change. The effect (not a direct call in
  // the onClick handlers) covers both initial mount and subsequent
  // qty edits with one path, and avoids drifting if the parent
  // re-renders with a new tiers array while qty stays put.
  useEffect(() => {
    onChange({ qty: state.qty, unitPriceCents: state.unitPriceCents });
  }, [state.qty, state.unitPriceCents, onChange]);

  const canDec = qty > 1;
  const songLabel = qty === 1 ? "song" : "songs";

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        How many songs do you have?
      </p>

      {/* Stepper row */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => {
            if (canDec) setQty((q) => Math.max(1, q - 1));
          }}
          disabled={!canDec}
          aria-label="Decrease songs"
          className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(17_16_9/0.06)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Minus size={16} strokeWidth={2.4} aria-hidden />
        </button>
        <span className="min-w-[5ch] text-center font-display text-[22px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
          {qty}{" "}
          <span className="text-[14px] font-semibold text-[rgb(var(--fg-muted))]">
            {songLabel}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            setQty((q) => q + 1);
          }}
          aria-label="Increase songs"
          className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(17_16_9/0.06)]"
        >
          <Plus size={16} strokeWidth={2.4} aria-hidden />
        </button>
      </div>

      {/* Total + savings reveal */}
      <div className="flex flex-col items-center gap-0.5 border-t border-[rgb(var(--border-subtle))] pt-3">
        <span className="font-display text-[24px] font-extrabold tabular-nums text-[rgb(var(--fg-default))]">
          {formatCents(state.totalCents, currency)}
        </span>
        <span className="text-[12px] text-[rgb(var(--fg-muted))] tabular-nums">
          {state.qty} × {formatCents(state.unitPriceCents, currency)}
          {state.savedCents > 0
            ? ` · save ${formatCents(state.savedCents, currency)} vs base price`
            : ""}
        </span>
      </div>
    </div>
  );
}
