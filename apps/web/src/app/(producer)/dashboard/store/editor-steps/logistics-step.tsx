// logistics-step.tsx
//
// Stage 4 of the producer Store wizard — session duration + revisions.
// Sits between Pricing and Agreement. Both fields are optional, so this
// step is always passable (canContinue returns true).
//
// Duration is a free-text input ("60 min", "180 min", "multi-session").
// On save, product-editor.tsx parses the integer minutes via a /\d+/
// match — "multi-session" parses to 0 and survives the round-trip.
//
// Revisions is an optional integer stepper (0..20). When 0 it's omitted
// from the encoded description; otherwise it lands in the
// `revisions: N` meta line (see description-encoding.ts).

"use client";

import { Minus, Plus } from "lucide-react";

interface LogisticsStepProps {
  duration: string;
  revisions: number;
  onChange: (patch: Partial<{ duration: string; revisions: number }>) => void;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-[var(--font-outfit)] text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
      {children}
    </div>
  );
}

function Stepper({
  value,
  min = 0,
  max = 20,
  onChange,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  ariaLabel?: string;
}) {
  const canDec = value > min;
  const canInc = value < max;
  return (
    <div
      className="inline-flex h-10 items-center gap-1 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1"
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
      <span className="min-w-[2.5ch] text-center font-display text-[16px] font-bold tabular-nums leading-none text-[rgb(var(--fg-default))]">
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

export function LogisticsStep({ duration, revisions, onChange }: LogisticsStepProps) {
  return (
    <div className="flex flex-col gap-4 p-[20px]">
      {/* Duration */}
      <div className="flex flex-col gap-2">
        <Eyebrow>Duration</Eyebrow>
        <input
          id="logistics-step-duration"
          type="text"
          value={duration}
          onChange={(e) => {
            onChange({ duration: e.target.value });
          }}
          placeholder="e.g. 60 min, 180 min, multi-session"
          aria-label="Session duration"
          className="h-10 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
        />
        <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
          How long a session runs. Leave as &quot;multi-session&quot; for project work.
        </div>
      </div>

      {/* Revisions */}
      <div className="flex flex-col gap-2">
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
        <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
          Optional. Number of revision rounds included.
        </div>
      </div>
    </div>
  );
}
