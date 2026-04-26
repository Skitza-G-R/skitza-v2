import {
  formatGreetingDate,
  formatGreetingSummary,
} from "../../../app/(app)/dashboard/page-helpers";

// DashboardGreeting — the editorial header above the inbox on the
// redesigned Today dashboard (Story 06).
//
// Two pieces:
//   1. The date eyebrow — "Friday, April 25" — formatted via
//      `Intl.DateTimeFormat` (en-US) so the weekday/month names stay
//      consistent with the OS conventions producers see elsewhere.
//   2. A summary line — "N things need you" or "All quiet today."
//      The N reads from the same `unresolvedItems` count powering the
//      Pulse card footer + the prior KPI strip's "Unresolved" tile,
//      so the surfaces stay in sync.
//
// Server component — no React state, no client-only APIs. The Date
// argument lets the page compute "now" once on the server and pass
// it down, avoiding hydration drift if the page rerenders across a
// midnight boundary.

interface DashboardGreetingProps {
  unresolvedItems: number;
  /**
   * Optional — defaults to `new Date()` at render time. Tests can
   * pass a fixed Date to assert formatted output without mocking
   * global time.
   */
  now?: Date;
}

export function DashboardGreeting({
  unresolvedItems,
  now,
}: DashboardGreetingProps) {
  const today = now ?? new Date();
  const dateLabel = formatGreetingDate(today);
  const summary = formatGreetingSummary(unresolvedItems);

  return (
    // Sits in the gradient hero, above the inbox. The page already has
    // a sr-only `<h1>Today</h1>` and the sidebar nav says "Today" —
    // dropping the redundant "Today" eyebrow here (UX-critic on PR #48
    // flagged the triple-Today). The date is the heading; the summary
    // line carries the daily-status copy. Margin is now owned by the
    // page-level `space-y-12` wrapper.
    <header>
      <h2 className="font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-4xl">
        {dateLabel}
      </h2>
      <p className="mt-2 text-[0.95rem] leading-6 text-[rgb(var(--fg-secondary))]">
        {summary}
      </p>
    </header>
  );
}
