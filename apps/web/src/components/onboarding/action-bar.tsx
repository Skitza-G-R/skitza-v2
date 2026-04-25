"use client";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";

// Story 02 — Sticky bottom action bar for the onboarding wizard.
//
// Layout: Back chip on the left (omitted on Step 1 where there's
// nowhere to go back to), Skip ghost link + Continue primary on
// the right. Sticky to the viewport bottom + sk-safe-bottom for
// iOS home-indicator clearance. Every interactive element is
// guaranteed ≥ 44px tap target via min-h-11 (CLAUDE.md mobile rule).
//
// Visibility rules + button state are exported as pure helpers so
// the unit tests can pin them without RTL.

/**
 * Layout classes for the outer sticky bar. Token-only, no hex.
 */
export function actionBarLayout(): string {
  return [
    "sticky bottom-0 left-0 right-0 z-20",
    "sk-safe-bottom",
    "border-t border-[rgb(var(--border-subtle))]",
    "bg-[rgb(var(--bg-base)/0.85)] backdrop-blur",
    "px-6 py-4",
    "flex items-center gap-3",
  ].join(" ");
}

/**
 * Render the Back chip only when an onBack handler is supplied.
 * Step 1 omits onBack so the chip disappears, anchoring the eye to
 * Continue.
 */
export function shouldRenderBack(onBack: (() => void) | undefined): boolean {
  return typeof onBack === "function";
}

/**
 * Skip ghost link mirrors the same rule — present iff a handler is
 * supplied. The wizard exposes Skip on Steps 2-4 (Step 1 is required).
 */
export function shouldRenderSkip(onSkip: (() => void) | undefined): boolean {
  return typeof onSkip === "function";
}

/**
 * Pin the Continue label + disabled state.
 */
export function continueButtonState(
  continueDisabled: boolean,
  label = "Continue →",
): { disabled: boolean; label: string } {
  return { disabled: continueDisabled, label };
}

export interface ActionBarProps {
  onBack?: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  /** Defaults to "Continue →". Customise per step (e.g. "Enter your studio →"). */
  continueLabel?: string;
  /** When true, Continue renders disabled. */
  continueDisabled?: boolean;
  /** Pending-state copy. Replaces the label while a transition is in flight. */
  pendingLabel?: string;
  /** When true, Continue renders pending (disabled + pending label). */
  pending?: boolean;
}

export function ActionBar({
  onBack,
  onContinue,
  onSkip,
  continueLabel = "Continue →",
  continueDisabled = false,
  pendingLabel = "Saving…",
  pending = false,
}: ActionBarProps) {
  const showBack = shouldRenderBack(onBack);
  const showSkip = shouldRenderSkip(onSkip);
  const cont = continueButtonState(continueDisabled || pending, continueLabel);

  return (
    <div className={actionBarLayout()}>
      <div className="flex flex-1 items-center">
        {showBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className={cn("min-h-11 px-3")}
          >
            ← Back
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {showSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className={cn(
              "min-h-11 px-3 text-sm font-medium",
              "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]",
              "rounded-[var(--radius-md)] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
            )}
          >
            Skip for now
          </button>
        ) : null}

        <Button
          type="button"
          onClick={onContinue}
          disabled={cont.disabled}
          size="lg"
          className={cn("min-h-11")}
        >
          {pending ? pendingLabel : cont.label}
        </Button>
      </div>
    </div>
  );
}
