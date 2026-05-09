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
  const continueText = pending
    ? (pendingLabel ?? "Saving…")
    : (continueLabel ?? "Continue");

  return (
    <div className="flex items-center justify-between gap-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="sk-pop inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-default))]"
        >
          <ArrowLeft size={14} aria-hidden />
          Back
        </button>
      ) : (
        <span aria-hidden />
      )}

      <div className="flex items-center gap-2">
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            disabled={pending}
            className="sk-pop inline-flex items-center rounded-xl border border-[rgb(var(--border-subtle))] px-3.5 py-2.5 text-[13px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))]"
          >
            Skip for now
          </button>
        ) : null}

        <button
          type="button"
          onClick={onContinue}
          disabled={continueDisabled || pending}
          className="sk-pop inline-flex items-center gap-2 rounded-xl bg-[rgb(var(--bg-sidebar))] px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_2px_12px_rgba(17,16,9,0.18)] transition-shadow hover:shadow-[0_6px_20px_rgba(17,16,9,0.28)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-[0_2px_12px_rgba(17,16,9,0.18)]"
        >
          {continueText}
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
