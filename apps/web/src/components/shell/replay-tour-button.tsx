"use client";

import { clearTourSeen, TOUR_STORAGE_KEY } from "./coachmark-tour-steps";

// Client-side button that restarts the producer first-run coachmark
// tour. Clears the localStorage seen-flag and dispatches the
// `skitza:replay-tour` event the mounted `CoachmarkTour` listens for.
// Rendered inside the Account panel in Setup; no props — it's a
// one-shot action button.
export function ReplayTourButton() {
  const onClick = () => {
    clearTourSeen(typeof window !== "undefined" ? window.localStorage : null);
    window.dispatchEvent(new Event("skitza:replay-tour"));
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
      aria-label="Replay onboarding tour"
      data-storage-key={TOUR_STORAGE_KEY}
    >
      Replay onboarding tour
    </button>
  );
}
