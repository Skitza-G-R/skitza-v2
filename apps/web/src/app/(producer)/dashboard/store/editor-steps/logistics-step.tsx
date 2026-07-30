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
  includesSessions?: boolean;
  sessions?: number;
  unlimitedSessions?: boolean;
  pricingModel?: "flat" | "per_song";
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  onChange: (
    patch: Partial<{
      includesSessions: boolean;
      sessions: number;
      unlimitedSessions: boolean;
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
    <div className="mb-1.5 text-[10.5px] font-[var(--font-outfit)] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
      {children}
    </div>
  );
}

interface DurationChipProps {
  label: string;
  value: string;
  active: boolean;
  onChange: () => void;
}

function DurationChip({ label, value, active, onChange }: DurationChipProps) {
  return (
    <label
      className={[
        "sk-press inline-flex h-11 cursor-pointer items-center justify-center rounded-[var(--radius-lg)] border px-4 text-[13px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-[rgb(var(--brand-primary)/0.45)] focus-within:ring-offset-1 focus-within:ring-offset-[rgb(var(--bg-base))] focus-within:outline-none sm:h-9 sm:rounded-[var(--radius-md)]",
        active
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]",
      ].join(" ")}
    >
      <input
        type="radio"
        name="session-duration"
        value={value}
        checked={active}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
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
        "inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] sm:rounded-[var(--radius-md)]",
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
        className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(17_16_9/0.06)] disabled:cursor-not-allowed disabled:opacity-30 sm:h-9 sm:w-9 sm:rounded-[var(--radius-md)]"
      >
        <Minus size={14} strokeWidth={2.4} aria-hidden />
      </button>
      <span className="font-display min-w-[2.5ch] text-center text-[16px] leading-none font-bold text-[rgb(var(--fg-default))] tabular-nums">
        {display ?? value}
      </span>
      <button
        type="button"
        onClick={() => {
          if (canInc) onChange(value + 1);
        }}
        disabled={!canInc}
        aria-label="Increase"
        className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(17_16_9/0.06)] disabled:cursor-not-allowed disabled:opacity-30 sm:h-9 sm:w-9 sm:rounded-[var(--radius-md)]"
      >
        <Plus size={14} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}

export function LogisticsStep({
  includesSessions = true,
  sessions = 1,
  unlimitedSessions = false,
  pricingModel = "flat",
  duration,
  revisions,
  unlimitedRevisions,
  onChange,
}: LogisticsStepProps) {
  const preset = parsePresetFromDuration(duration);
  const customMinutes = customMinutesFromDuration(duration);

  const choiceClass =
    "sk-press min-h-11 flex-1 rounded-[var(--radius-lg)] border px-3 py-2 text-[13px] font-semibold transition-colors sm:rounded-[var(--radius-md)]";

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="font-display text-[16px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          Does this product include bookable sessions?
        </legend>
        <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Choose yes only when the artist receives time they can book with you.
        </p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Bookable sessions included">
          <button
            type="button"
            aria-pressed={includesSessions}
            onClick={() => {
              onChange({
                includesSessions: true,
                ...(duration ? {} : { duration: "60 min" }),
              });
            }}
            className={[
              choiceClass,
              includesSessions
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]",
            ].join(" ")}
          >
            Yes, sessions included
          </button>
          <button
            type="button"
            aria-pressed={!includesSessions}
            onClick={() => {
              onChange({ includesSessions: false });
            }}
            className={[
              choiceClass,
              !includesSessions
                ? "border-[rgb(var(--fg-default))] bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]",
            ].join(" ")}
          >
            No, delivery only
          </button>
        </div>
      </fieldset>

      {includesSessions ? (
        <div className="grid grid-cols-1 gap-5 border-t border-[rgb(var(--border-subtle))] pt-5 sm:grid-cols-2 sm:gap-6">
          <div className="flex min-w-0 flex-col gap-2">
            <Eyebrow>
              {pricingModel === "per_song" ? "Bookable sessions per song" : "Bookable sessions"}
            </Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              <Stepper
                value={sessions}
                min={1}
                max={99}
                disabled={unlimitedSessions}
                {...(unlimitedSessions ? { display: "∞" } : {})}
                onChange={(next) => {
                  onChange({ sessions: next });
                }}
                ariaLabel="Bookable sessions count"
              />
              <button
                type="button"
                onClick={() => {
                  onChange({ unlimitedSessions: !unlimitedSessions });
                }}
                aria-pressed={unlimitedSessions}
                aria-label="Unlimited bookable sessions"
                className={[
                  "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border px-4 text-[13px] font-semibold transition-colors sm:h-10 sm:rounded-[var(--radius-md)]",
                  unlimitedSessions
                    ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]",
                ].join(" ")}
              >
                Unlimited
              </button>
            </div>
          </div>

          <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-1.5 text-[10.5px] font-[var(--font-outfit)] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
              Length of each session
            </legend>
            <div className="flex flex-wrap gap-2">
              <DurationChip
                label="1 hr"
                value="60 min"
                active={preset === "1hr"}
                onChange={() => {
                  onChange({ duration: "60 min" });
                }}
              />
              <DurationChip
                label="2 hr"
                value="120 min"
                active={preset === "2hr"}
                onChange={() => {
                  onChange({ duration: "120 min" });
                }}
              />
              <DurationChip
                label="3 hr"
                value="180 min"
                active={preset === "3hr"}
                onChange={() => {
                  onChange({ duration: "180 min" });
                }}
              />
              <DurationChip
                label="Custom"
                value="custom"
                active={preset === "custom"}
                onChange={() => {
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
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    if (!value) {
                      onChange({ duration: "" });
                      return;
                    }
                    const minutes = Number.parseInt(value, 10);
                    onChange({
                      duration:
                        Number.isFinite(minutes) && minutes > 0 ? `${String(minutes)} min` : "",
                    });
                  }}
                  placeholder="e.g. 45"
                  aria-label="Custom session length in minutes"
                  className="h-11 w-32 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)] focus:outline-none sm:h-10 sm:rounded-[var(--radius-md)] sm:text-[14px]"
                />
                <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
                  Custom session length in minutes.
                </div>
              </div>
            ) : null}
          </fieldset>
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Artists receive the listed deliverables and revisions, with no bookable time included.
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] pt-5">
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
              "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border px-4 text-[13px] font-semibold transition-colors sm:h-10 sm:rounded-[var(--radius-md)]",
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
