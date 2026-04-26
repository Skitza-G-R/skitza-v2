"use client";

import type { ReactNode } from "react";

import { ActionBar } from "~/components/onboarding/action-bar";
import { PROGRESS_TOTAL, ProgressBar } from "~/components/onboarding/progress-bar";

// Story 02 — Onboarding shell.
//
// Wraps each of the 4 step pages in a single visual frame: ambient
// brand-glow blob, top progress bar, mono eyebrow + display H1
// header, content slot, sticky action bar. The shell stays purely
// presentational — Stories 03-08 wire the per-step content + the
// onContinue / onBack / onSkip handlers via use-step-nav.
//
// Motion: header + content reuse the existing `.reveal-up` keyframe
// (see globals.css:277). The reduced-motion gate at globals.css:308
// neutralises all reveal-up classes, so the existing motion-primitives
// vitest already pins the a11y guarantee — no new keyframes needed.

export interface OnboardingShellProps {
  /** 1-indexed current step. Must satisfy 1 ≤ currentStep ≤ 4. */
  currentStep: 1 | 2 | 3 | 4;
  /** Display H1 text for this step (e.g. "Name your studio."). */
  title: string;
  /** Subtitle line under the H1. Optional but recommended. */
  subtitle?: string;
  /** Step content slot. Stories 03-08 fill this. */
  children: ReactNode;
  /** Step 1 omits onBack; Steps 2-4 supply it. */
  onBack?: () => void;
  /**
   * Story 02 made this required; Story 04 relaxed it because Step 2
   * hosts NewPackageForm in the content slot and that form has its
   * own submit button. Hiding the shell's Continue avoids two
   * submit-shaped CTAs competing for attention. Steps that omit
   * onContinue render only Back + Skip in the action bar.
   */
  onContinue?: () => void;
  /** Step 1 omits onSkip (display name is required). Steps 2-4 supply it. */
  onSkip?: () => void;
  /** Defaults to "Continue →". */
  continueLabel?: string;
  /** When true the Continue button renders disabled. */
  continueDisabled?: boolean;
  /** When true the Continue button renders the pending label + disabled. */
  pending?: boolean;
  /** Pending-state copy. Defaults to "Saving…". */
  pendingLabel?: string;
}

export function OnboardingShell({
  currentStep,
  title,
  subtitle,
  children,
  onBack,
  onContinue,
  onSkip,
  continueLabel,
  continueDisabled,
  pending,
  pendingLabel,
}: OnboardingShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      {/* Ambient background — same shape as the existing single-screen
          onboarding page so the visual identity stays consistent across
          the rebuild. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-6rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[rgb(var(--brand-primary)/0.08)] blur-[120px]" />
      </div>

      <div className="relative z-10 flex min-h-dvh flex-col">
        {/* Top progress bar — pinned to the top of the content column,
            inset by the same horizontal gutter as the rest of the shell
            so it aligns with the headline below. */}
        <div className="mx-auto w-full max-w-xl px-6 pt-8">
          <ProgressBar current={currentStep} />
        </div>

        {/* Header + content live in the same scrolling column. The
            sticky action bar sits at the viewport bottom regardless of
            content height (Step 2 + Step 3 will scroll past the fold). */}
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 pt-8 pb-12">
          <div className="reveal-up">
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Onboarding · Step {currentStep} of {PROGRESS_TOTAL}
            </p>
            <h1
              className="mt-3 font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-4 max-w-md text-[rgb(var(--fg-secondary))]">
                {subtitle}
              </p>
            ) : null}
          </div>

          <div className="reveal-up-delay-1 mt-8 flex-1">{children}</div>
        </div>

        {/* Sticky action bar — Back / Skip / Continue. Only forward
            optional handlers / props when the caller actually supplied
            them; tsconfig has exactOptionalPropertyTypes on, so passing
            `undefined` is rejected. Story 04 relaxed onContinue to
            also be optional (Step 2 hides Continue), so it follows the
            same conditional-spread pattern as onBack / onSkip. */}
        <ActionBar
          {...(onContinue ? { onContinue } : {})}
          {...(onBack ? { onBack } : {})}
          {...(onSkip ? { onSkip } : {})}
          {...(continueLabel !== undefined ? { continueLabel } : {})}
          {...(continueDisabled !== undefined ? { continueDisabled } : {})}
          {...(pending !== undefined ? { pending } : {})}
          {...(pendingLabel !== undefined ? { pendingLabel } : {})}
        />
      </div>
    </div>
  );
}
