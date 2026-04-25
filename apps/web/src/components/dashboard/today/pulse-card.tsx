"use client";

import Link from "next/link";

import type { PulseStats } from "../../../server/trpc/routers/producer";

import { PulseSparkline } from "./pulse-sparkline";

// PulseCard — the editorial revenue tile that replaces KpiStrip +
// RevenueTrend on the redesigned Today dashboard. One big number
// (this month's revenue), a delta line that compares to last month,
// an ambient 30-day sparkline behind the number, and a 3-stat footer
// with active projects / sessions / unresolved.
//
// Whole card is a Link to /dashboard/revenue (Story 7) — clicking
// anywhere in the surface jumps to the full chart. The sparkline is
// pointer-events-none so it doesn't capture the click target.
//
// Empty state: when both this-month and last-month revenue are zero,
// we render an em-dash instead of $0 — the difference between "no
// money" and "no money yet" matters for a producer's emotional read
// of the page. Footer counts always render numerals (0/0/0) — they're
// countable units, not currency.

type Props = {
  stats: PulseStats;
};

// ─── Pure helpers (exported for unit testing) ────────────────────────

// Format cents → currency string with no fractional digits. Same
// pattern as KpiStrip's `format` and producer.today's invoice
// formatter — kept consistent so producers see identical numbers
// across surfaces.
export function formatPulseAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// True when there's nothing to compare and nothing to show — the
// signal to render an em-dash instead of "$0". When last month had
// revenue but this month is zero, we still render the formatted zero
// so the producer sees "down from $X to $0" rather than a placeholder.
export function isPulseEmpty(args: {
  thisMonthCents: number;
  lastMonthCents: number;
}): boolean {
  return args.thisMonthCents === 0 && args.lastMonthCents === 0;
}

// "April 25, 2026" → "March". UTC math matches the server's
// month-boundary calculation (lastMonthStart in producer.today).
export function previousMonthLabel(now: Date): string {
  const prev = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  return prev.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

// Tone enum the JSX shell maps onto a CSS variable. Branches:
//   > 0       → success (green) — month is up
//   < 0       → warning (warm orange) — month is down
//   null/0    → muted — no comparison anchor or flat
//
// Zero treated as "muted" rather than "success" because a flat month
// against a non-zero prior is not a positive signal.
export type PulseDeltaTone = "success" | "warning" | "muted";
export function pulseDeltaTone(deltaPct: number | null): PulseDeltaTone {
  if (deltaPct === null) return "muted";
  if (deltaPct > 0) return "success";
  if (deltaPct < 0) return "warning";
  return "muted";
}

// Renders the footer copy as a single string the JSX layer can drop
// straight into a span. Centralizing it here means the en literals
// live with the helper unit-tests, and the component file's source
// stays grep-friendly for layout invariants.
export function formatFooterStats(args: {
  activeProjects: number;
  upcomingSessions7d: number;
  unresolvedItems: number;
}): string {
  return `${String(args.activeProjects)} active · ${String(
    args.upcomingSessions7d,
  )} sessions · ${String(args.unresolvedItems)} unresolved`;
}

// ─── Component ───────────────────────────────────────────────────────

export function PulseCard({ stats }: Props) {
  const empty = isPulseEmpty({
    thisMonthCents: stats.thisMonthCents,
    lastMonthCents: stats.lastMonthCents,
  });
  const tone = pulseDeltaTone(stats.deltaPct);
  const prevMonth = previousMonthLabel(new Date());
  const footer = formatFooterStats({
    activeProjects: stats.activeProjects,
    upcomingSessions7d: stats.upcomingSessions7d,
    unresolvedItems: stats.unresolvedItems,
  });

  // Big number — em-dash for the all-zero empty state, formatted
  // currency otherwise. The em-dash glyph (—) is a deliberate
  // typographic choice: it reads as "nothing here yet" without the
  // emotional weight of "$0".
  const headline = empty
    ? "—"
    : formatPulseAmount(stats.thisMonthCents, stats.currency);

  // Delta copy. Null delta (last month was 0) → "— vs <month>" in
  // muted text — same em-dash signal repurposed at a smaller scale.
  // Positive/negative wrap the number with an explicit sign so the
  // direction is readable even outside its tone color.
  let deltaCopy: string;
  if (stats.deltaPct === null) {
    deltaCopy = `— vs ${prevMonth}`;
  } else if (stats.deltaPct > 0) {
    deltaCopy = `+${String(stats.deltaPct)}% vs ${prevMonth}`;
  } else if (stats.deltaPct < 0) {
    // Number already carries the minus sign — String() preserves it.
    deltaCopy = `${String(stats.deltaPct)}% vs ${prevMonth}`;
  } else {
    // Flat (0%) — render with the explicit zero sign for clarity.
    deltaCopy = `0% vs ${prevMonth}`;
  }

  // Tone → CSS variable. Mapping kept in a const-record so the JSX
  // stays readable and the helper test pins the exact tone branches.
  const TONE_TOKEN: Record<PulseDeltaTone, string> = {
    success: "rgb(var(--fg-success))",
    warning: "rgb(var(--fg-warning))",
    muted: "rgb(var(--fg-muted))",
  };

  return (
    <Link
      href="/dashboard/revenue"
      aria-label="Open revenue trend"
      data-tour-id="pulse-card"
      // sk-lift = -1px lift + soft shadow on hover. Hover-state border
      // brightens to brand-primary so the card "wakes up" without a
      // jarring color swap. relative is required so the absolute
      // sparkline layer scopes to the card; overflow-hidden clips the
      // sparkline inside the rounded corner.
      className="sk-lift relative block overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 transition-colors hover:border-[rgb(var(--brand-primary))]"
    >
      {/* Eyebrow — same mono small-caps treatment as the rest of the
          Today surface (RevenueTrend, KpiStrip). */}
      <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
        This month · Pulse
      </p>

      {/* Layered content area. The sparkline is positioned absolute
          inside this wrapper; the number + delta sit on top.
          min-h sets a stable card height across empty / populated
          states so the page doesn't reflow when revenue lands. */}
      <div className="relative mt-4 min-h-[5rem]">
        {!empty ? <PulseSparkline values={stats.sparkline} /> : null}

        <div className="relative">
          <p
            className="sk-num font-display text-4xl leading-none tracking-tight text-[rgb(var(--fg-primary))] sm:text-5xl"
          >
            {headline}
          </p>
          <p
            className="mt-2 font-mono text-xs tracking-wide"
            style={{ color: TONE_TOKEN[tone] }}
          >
            {deltaCopy}
          </p>
        </div>
      </div>

      {/* Hairline divider + footer counts. Footer always renders, even
          at zero — the producer should see "0 active · 0 sessions · 0
          unresolved" so the surface holds shape on day 1. */}
      <div className="mt-5 border-t border-[rgb(var(--border-subtle))] pt-3">
        <p className="sk-num font-mono text-[0.7rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          {footer}
        </p>
      </div>
    </Link>
  );
}
