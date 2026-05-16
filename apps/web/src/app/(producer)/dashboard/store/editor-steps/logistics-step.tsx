// logistics-step.tsx
//
// Stage 4 of the producer Store wizard — session duration + revisions.
// Sits between Pricing and Agreement.
//
// Duration is a chip group: 1 hr / 2 hr / 3 hr / Custom. The 1/2/3 hr
// chips map to "60 min" / "120 min" / "180 min". "Custom" reveals a
// minutes number input that writes "{N} min". An empty Custom input
// flows up as "" so canContinue can keep the Continue button disabled.
//
// The duration string format that flows through props stays "{N} min"
// (or "" in transit) — that way the existing parser in product-editor
// (/(\d+)\s*min/i) keeps working unchanged.
//
// Revisions is an integer stepper (0..20) with an "Unlimited" chip
// beside it. When Unlimited is active the stepper is disabled, shows
// ∞ instead of the digit, and the unlimited flag rides up through
// the encoded description meta block.

"use client";

import { Minus, Plus } from "lucide-react";

interface LogisticsStepProps {
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  onChange: (
    patch: Partial<{
      duration: string;
      revisions: number;
      unlimitedRevisions: boolean;
    }>,
  ) => void;
}

type DurationPreset = "1hr" | "2hr" | "3hr" | "custom";

export function parsePresetFromDuration(duration: string): DurationPreset {
  if (duration === "60 min") return "1hr";
  if (duration === "120 min") return "2hr";
  if (duration === "180 min") return "3hr";
  return "custom";
}

export function customMinutesFromDuration(duration: string): string {
  if (duration === "60 min" || duration === "120 min" || duration === "180 min") {
    return "";
  }
  const m = duration.match(/^(\d+)\s*min$/i);
  return m?.[1] ?? "";
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-[var(--font-outfit)] text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
      {children}
    </div>
  );
}

interface DurationChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function DurationChip({ label, active, onClick }: DurationChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={[
        "sk-press inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] border px-4 text-[13px] font-semibold transition-colors",
        active
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Stepper({
  value,
  min = 0,
  max = 20,
  onChange,
  disabled = false,
  display,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  display?: string;
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
      <span className="min-w-[2.5ch] text-center font-display text-[16px] font-bold tabular-nums leading-none text-[rgb(var(--fg-default))]">
        {display ?? value}
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

export function LogisticsStep({
  duration,
  revisions,
  unlimitedRevisions,
  onChange,
}: LogisticsStepProps) {
  const preset = parsePresetFromDuration(duration);
  const customMinutes = customMinutesFromDuration(duration);

  return (
    <div className="flex flex-col gap-4 p-[20px]">
      {/* Duration */}
      <div className="flex flex-col gap-2">
        <Eyebrow>Duration</Eyebrow>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Session duration">
          <DurationChip
            label="1 hr"
            active={preset === "1hr"}
            onClick={() => {
              onChange({ duration: "60 min" });
            }}
          />
          <DurationChip
            label="2 hr"
            active={preset === "2hr"}
            onClick={() => {
              onChange({ duration: "120 min" });
            }}
          />
          <DurationChip
            label="3 hr"
            active={preset === "3hr"}
            onClick={() => {
              onChange({ duration: "180 min" });
            }}
          />
          <DurationChip
            label="Custom"
            active={preset === "custom"}
            onClick={() => {
              // Drop into Custom mode with an empty input; canContinue
              // stays false until the producer types a number.
              onChange({ duration: "" });
            }}
          />
        </div>
        {preset === "custom" ? (
          <div className="mt-1 flex flex-col gap-1">
            <input
              id="logistics-step-custom-minutes"
              type="number"
              min={1}
              max={999}
              inputMode="numeric"
              value={customMinutes}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (v === "") {
                  onChange({ duration: "" });
                  return;
                }
                const n = parseInt(v, 10);
                if (Number.isFinite(n) && n > 0) {
                  onChange({ duration: `${String(n)} min` });
                } else {
                  onChange({ duration: "" });
                }
              }}
              placeholder="e.g. 45"
              aria-label="Custom session length in minutes"
              className="h-10 w-32 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
            />
            <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
              Custom session length in minutes.
            </div>
          </div>
        ) : null}
      </div>

      {/* Revisions */}
      <div className="flex flex-col gap-2">
        <Eyebrow>Revisions</Eyebrow>
        <div className="flex items-center gap-2">
          <Stepper
            value={revisions}
            min={0}
            max={20}
            disabled={unlimitedRevisions}
            {...(unlimitedRevisions ? { display: "∞" } : {})}
            onChange={(next) => {
              onChange({ revisions: next });
            }}
            ariaLabel="Revisions count"
          />
          <button
            type="button"
            onClick={() => {
              onChange({ unlimitedRevisions: !unlimitedRevisions });
            }}
            aria-pressed={unlimitedRevisions}
            aria-label="Unlimited revisions"
            className={[
              "sk-press inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border px-4 text-[13px] font-semibold transition-colors",
              unlimitedRevisions
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]",
            ].join(" ")}
          >
            Unlimited
          </button>
        </div>
        <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
          Optional. Number of revision rounds included.
        </div>
      </div>
    </div>
  );
}
