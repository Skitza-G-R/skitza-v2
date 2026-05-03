import { cn } from "~/lib/cn";

// Story 02 — Onboarding wizard progress bar.
//
// Pure presentational. Equal-width segments separated by 2px gaps.
// The active segment glows brand-primary, completed segments fade to
// 60% alpha, pending segments use the neutral border token.
//
// T8 — total bumped from 4 to 6 (wizard reordered to 6 data-capture
// steps + a non-shell completion screen).
//
// The class-derivation + ARIA attributes are exported as pure
// helpers so the unit tests in __tests__/progress-bar.test.tsx can
// pin them without rendering React (the repo runs vitest in `node`
// env — see the autopilot SWITCHES + Sidebar NAV_ITEMS pattern).

export const PROGRESS_TOTAL = 6 as const;

export type SegmentState = "completed" | "active" | "pending";

/**
 * Map a 0-indexed segment position to its visual state given the
 * 1-indexed `current` step. Index < current-1 → completed, index ===
 * current-1 → active, index > current-1 → pending.
 */
export function segmentState(index: number, current: number): SegmentState {
  if (index < current - 1) return "completed";
  if (index === current - 1) return "active";
  return "pending";
}

/**
 * Tailwind classes for one segment. Same shape across states — only
 * the background color differs. CSS vars only (no hex), per the
 * repo-wide token rule.
 */
export function segmentClass(state: SegmentState): string {
  const base = "flex-1 h-1 rounded-full transition-colors duration-200";
  if (state === "active") return `${base} bg-[rgb(var(--brand-primary))]`;
  if (state === "completed") return `${base} bg-[rgb(var(--brand-primary)/0.6)]`;
  return `${base} bg-[rgb(var(--border-subtle))]`;
}

/**
 * ARIA contract for the progress bar wrapper. Pinned by the test
 * suite — change with care.
 */
export function progressBarA11y(current: number) {
  return {
    role: "progressbar" as const,
    "aria-valuenow": current,
    "aria-valuemin": 1 as const,
    "aria-valuemax": PROGRESS_TOTAL,
    "aria-label": "Onboarding progress" as const,
  };
}

export interface ProgressBarProps {
  /** 1-indexed current step. Must satisfy 1 ≤ current ≤ PROGRESS_TOTAL. */
  current: number;
  /** Optional extra classes for the outer wrapper. */
  className?: string;
}

export function ProgressBar({ current, className }: ProgressBarProps) {
  const a11y = progressBarA11y(current);
  return (
    <div
      {...a11y}
      className={cn("flex w-full items-center gap-[2px]", className)}
    >
      {Array.from({ length: PROGRESS_TOTAL }, (_, index) => (
        <span key={index} className={segmentClass(segmentState(index, current))} />
      ))}
    </div>
  );
}
