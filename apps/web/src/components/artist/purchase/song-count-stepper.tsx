"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { totalFor, unitPriceFor, type VolumeTier } from "~/lib/pricing";
import { applyTaxToCents, type TaxMode } from "~/lib/tax-mode";
import { formatPurchaseMoney } from "./purchase-data";

export type SongCountState = {
  qty: number;
  unitPriceCents: number;
  totalCents: number;
  savedCents: number;
};

export function computeSongCountState(qty: number, tiers: VolumeTier[]): SongCountState {
  const safeQty = Math.max(1, Math.floor(qty));
  const unitPriceCents = unitPriceFor(safeQty, tiers);
  const totalCents = totalFor(safeQty, tiers);
  const listUnitPriceCents = tiers[0]?.pricePerUnitCents ?? unitPriceCents;

  return {
    qty: safeQty,
    unitPriceCents,
    totalCents,
    savedCents: Math.max(0, (listUnitPriceCents - unitPriceCents) * safeQty),
  };
}

export function SongCountStepper({
  tiers,
  currency,
  taxMode = "tax_free",
  taxRatePct = 0,
  onChange,
}: {
  tiers: VolumeTier[];
  currency: string;
  taxMode?: TaxMode;
  taxRatePct?: number;
  onChange: (state: SongCountState) => void;
}) {
  const [qty, setQty] = useState(1);
  const state = computeSongCountState(qty, tiers);

  useEffect(() => {
    onChange(state);
  }, [onChange, state.qty, state.savedCents, state.totalCents, state.unitPriceCents]);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        Number of songs
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setQty((value) => Math.max(1, value - 1));
          }}
          disabled={qty <= 1}
          aria-label="Decrease songs"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Minus aria-hidden size={16} strokeWidth={2.4} />
        </button>
        <div className="min-w-0 text-center">
          <div className="font-syne text-[24px] font-extrabold tabular-nums text-[rgb(var(--fg-default))]">
            {state.qty} {state.qty === 1 ? "song" : "songs"}
          </div>
          <div className="mt-0.5 text-[12px] tabular-nums text-[rgb(var(--fg-muted))]">
            {formatPurchaseMoney(state.unitPriceCents, currency)} each
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setQty((value) => value + 1);
          }}
          aria-label="Increase songs"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]"
        >
          <Plus aria-hidden size={16} strokeWidth={2.4} />
        </button>
      </div>
      <div className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3 text-center">
        <div className="font-amount text-[25px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
          {formatPurchaseMoney(applyTaxToCents(state.totalCents, taxMode, taxRatePct), currency)}
        </div>
        {taxMode === "tax_added" ? (
          <p className="mt-1 font-mono text-[9.5px] font-medium tracking-[0.06em] text-[rgb(var(--fg-muted))] uppercase">
            Includes {String(taxRatePct)}% added tax
          </p>
        ) : null}
        {state.savedCents > 0 ? (
          <p className="mt-1 text-[12px] font-semibold text-[rgb(var(--fg-success-text))]">
            Volume discount saves {formatPurchaseMoney(state.savedCents, currency)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
