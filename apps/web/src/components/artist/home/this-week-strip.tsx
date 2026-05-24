// Server component — the "This week" widget in the right rail.
//
// Renders 7 mini day-dots Monday → Sunday with a count of upcoming
// sessions per day. The current day is ring-highlighted. This is
// information density: the artist's whole week at a glance, costing
// ~80px of vertical space in the rail.
//
// Source data is the `upcomingSessions` array already returned by
// artist.home — no new query, just a different projection of it.

export type WeekDot = {
  /** Single-char weekday label, "M" / "T" / "W" / etc. */
  dayLabel: string;
  /** YYYY-MM-DD in local time. Stable key + day comparison. */
  iso: string;
  /** How many of the supplied sessions fall on this day. */
  count: number;
  /** True for the dot that matches the supplied `today` date. */
  isToday: boolean;
};

// Pure helper — pulled out so the day-math is testable in node.
// `today` is parameterized (rather than reading Date.now() inside)
// so the tests can pin a specific reference day.
export function getWeekDots(
  sessions: { startsAt: Date }[],
  today: Date,
): WeekDot[] {
  // Find the Monday that anchors `today`'s week. JS getDay() returns
  // 0=Sun..6=Sat; we want Mon-based weeks (Skitza's calendar week
  // ends on Sunday). For Sunday, that means going back 6 days.
  const todayDow = today.getDay();
  const offsetToMon = todayDow === 0 ? -6 : 1 - todayDow;
  const monday = new Date(today);
  monday.setDate(monday.getDate() + offsetToMon);
  monday.setHours(0, 0, 0, 0);

  const labels = ["M", "T", "W", "T", "F", "S", "S"] as const;
  const todayKey = isoDay(today);

  const dots: WeekDot[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const iso = isoDay(day);
    const count = sessions.filter((s) => isoDay(s.startsAt) === iso).length;
    dots.push({
      dayLabel: labels[i] ?? "?",
      iso,
      count,
      isToday: iso === todayKey,
    });
  }
  return dots;
}

function isoDay(d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Component ──────────────────────────────────────────────────────

export function ThisWeekStrip({
  sessions,
  today,
}: {
  sessions: { startsAt: Date }[];
  today: Date;
}) {
  const dots = getWeekDots(sessions, today);
  const totalThisWeek = dots.reduce((acc, d) => acc + d.count, 0);

  return (
    <section aria-labelledby="this-week-heading">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        This week
      </p>
      <h3
        id="this-week-heading"
        className="mt-1 text-[14px] font-medium text-[rgb(var(--fg-default))]"
      >
        {totalThisWeek === 0
          ? "No sessions"
          : `${String(totalThisWeek)} session${totalThisWeek === 1 ? "" : "s"}`}
      </h3>
      <div className="mt-3 flex items-end justify-between gap-1">
        {dots.map((d) => (
          <div
            key={d.iso}
            className="flex flex-1 flex-col items-center gap-2"
            aria-label={`${d.dayLabel}: ${String(d.count)} session${d.count === 1 ? "" : "s"}`}
          >
            <span
              aria-hidden
              className="font-mono text-[10px] uppercase tracking-wider"
              style={{
                color: d.isToday
                  ? "rgb(var(--fg-default))"
                  : "rgb(var(--fg-faint))",
              }}
            >
              {d.dayLabel}
            </span>
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  d.count > 0
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--border-strong))",
                outline: d.isToday
                  ? "2px solid rgb(var(--brand-primary) / 0.3)"
                  : "none",
                outlineOffset: d.isToday ? "2px" : "0",
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
