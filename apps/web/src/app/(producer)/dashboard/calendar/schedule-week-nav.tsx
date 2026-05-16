"use client";

import { GCalPill } from "./gcal-pill";
import { weekRangeLabel } from "./calendar-week";

// Schedule tab top control strip per the design spec § 4.1.
//   [‹] [Today] [›]   May 3 – 9, 2026   6 sessions · 9.5h booked    [GCal]
//
// Pure visual — `weekOffset` lives in the parent (SchedulePanel) so
// the change can re-bucket sessions for the new week.

export function ScheduleWeekNav({
  week,
  weekOffset,
  totalSessions,
  totalHours,
  onPrev,
  onToday,
  onNext,
}: {
  week: readonly Date[];
  weekOffset: number;
  totalSessions: number;
  totalHours: number;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
}) {
  const onCurrentWeek = weekOffset === 0;
  const sessionsLabel = `${String(totalSessions)} session${totalSessions === 1 ? "" : "s"}`;
  const hoursLabel = `${formatHours(totalHours)} booked`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <NavArrow direction="prev" onClick={onPrev} />
        <button
          type="button"
          onClick={onToday}
          aria-pressed={onCurrentWeek}
          className={[
            "sk-press inline-flex h-8 items-center justify-center rounded-[var(--radius-lg)] px-3.5 text-[0.72rem] tracking-tight transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
            onCurrentWeek
              ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--fg-inverse))]"
              : "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
          ].join(" ")}
          style={{ fontWeight: 700 }}
        >
          Today
        </button>
        <NavArrow direction="next" onClick={onNext} />
      </div>

      <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2
          className="font-display text-base tracking-tight text-[rgb(var(--fg-default))]"
          style={{ fontWeight: 800, letterSpacing: "-0.02em" }}
        >
          {weekRangeLabel(week)}
        </h2>
        <p className="font-mono text-[0.72rem] text-[rgb(var(--fg-muted))]">
          {sessionsLabel} · {hoursLabel}
        </p>
      </div>

      <GCalPill status="not_connected" />
    </div>
  );
}

function NavArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  const label = direction === "prev" ? "Previous week" : "Next week";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="sk-press inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {direction === "prev" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}

function formatHours(hours: number): string {
  // 9.5 → "9.5h"; 10 → "10h"; 0 → "0h"
  if (Number.isInteger(hours)) return `${String(hours)}h`;
  return `${hours.toFixed(1).replace(/\.0$/, "")}h`;
}
