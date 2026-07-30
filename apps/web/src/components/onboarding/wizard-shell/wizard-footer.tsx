"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";

// Sticky footer used by Steps 1-5. Renders inside WizardChrome's
// `footer` slot. Three buttons:
//
//   ← Back            (left)        — only visible if onBack is provided
//                Skip · Continue →   (right)
//
// Skip is shown only when the step is optional (per WIZARD_STEPS) and
// the parent passes onSkip. Continue is always shown; the parent
// gates it via `continueDisabled` while validation hasn't passed.
//
// Pure presentational — no router, no validation. Keeps the footer
// reusable across every step regardless of how the step persists data.

export function WizardFooter({
  onBack,
  onSkip,
  onContinue,
  continueLabel,
  continueDisabled,
  pending,
  pendingLabel,
}: {
  /** Back button click (omit to hide the button). */
  onBack?: () => void;
  /** Skip click (omit to hide). Only set on optional steps. */
  onSkip?: () => void;
  /** Continue click — required for every step. */
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  /** True while the parent's mutation is in flight. */
  pending?: boolean;
  pendingLabel?: string;
}) {
  const continueText = pending ? (pendingLabel ?? "Saving…") : (continueLabel ?? "Continue");

  return (
    <div className="flex items-center justify-between gap-2 sm:gap-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="ob-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-2.5 text-[13px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none sm:px-3.5"
        >
          <ArrowLeft size={14} aria-hidden />
          Back
        </button>
      ) : (
        <span aria-hidden />
      )}

      <div className="flex min-w-0 items-center justify-end gap-2">
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            disabled={pending}
            className="ob-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none sm:px-3.5 sm:text-[13px]"
          >
            Skip for now
          </button>
        ) : null}

        <button
          type="button"
          onClick={onContinue}
          disabled={continueDisabled || pending}
          className="ob-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[13px] font-bold text-white shadow-[0_2px_12px_rgb(var(--bg-sidebar)/0.18)] hover:shadow-[0_8px_24px_rgb(var(--bg-sidebar)/0.30)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
        >
          {continueText}
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
