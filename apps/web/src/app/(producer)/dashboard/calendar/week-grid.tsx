"use client";

// Schedule view for the producer Calendar / Meetings tab.
//
// Renders a 7-day × 10-hour (09:00–18:00) grid for the current week, with
// pending and confirmed bookings overlaid as colored blocks. Today's column
// is tinted with a subtle brand wash. Pending blocks use the brand-primary
// fill; confirmed blocks use the dark sidebar fill — the same colour
// language as the rest of the producer app.
//
// Pure visual; all data comes pre-resolved from the page (booking.list +
// booking.upcoming). Empty cells fall back to a friendly empty-state row
// so a producer with zero sessions doesn't see a stark dead grid.

import { useMemo } from "react";

const HOUR_START = 9;
const HOUR_END = 18; // inclusive label, exclusive cell — last cell is 17:00
const HOUR_ROW_PX = 56;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type ScheduleSession = {
  id: string;
  // ISO strings — serializable across the server / client boundary.
  startsAt: string;
  durationMin: number;
  artistName: string;
  packageName: string | null;
  status: "pending" | "confirmed";
};

export function WeekGrid({ sessions }: { sessions: ScheduleSession[] }) {
  // Compute the current week (Sun → Sat) once per render — the producer's
  // local timezone is what they see in their dashboard. Using
  // `new Date()` here is fine: the page is rendered server-side per
  // request, then re-rendered on the client; the client mount stamps
  // its own week which is what the producer expects.
  const week = useMemo(() => buildWeek(), []);
  const todayIdx = week.findIndex((d) => isSameDay(d, new Date()));
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) out.push(h);
    return out;
  }, []);

  // Bucket sessions into [dayIdx][hour] cells. A session spanning two hours
  // starts in one cell and visually extends downward via height. A session
  // that starts before HOUR_START or after HOUR_END is dropped from the
  // grid (still appears in the Upcoming list below for full coverage).
  const placed = useMemo(() => {
    const map = new Map<string, ScheduleSession[]>();
    for (const s of sessions) {
      const dt = new Date(s.startsAt);
      const dayIdx = week.findIndex((d) => isSameDay(d, dt));
      if (dayIdx < 0) continue;
      const startHour = dt.getHours();
      if (startHour < HOUR_START || startHour > HOUR_END) continue;
      const key = `${String(dayIdx)}:${String(startHour)}`;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [sessions, week]);

  const totalThisWeek = useMemo(() => {
    return sessions.filter((s) => {
      const dt = new Date(s.startsAt);
      return week.some((d) => isSameDay(d, dt));
    }).length;
  }, [sessions, week]);

  return (
    <section
      aria-labelledby="schedule-heading"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--border-subtle))] px-3 py-2.5">
        <div>
          <h2
            id="schedule-heading"
            className="font-display text-sm tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Schedule
          </h2>
          <p className="mt-0.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            {weekRangeLabel(week)} · {totalThisWeek} session
            {totalThisWeek === 1 ? "" : "s"}
          </p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <Legend label="Pending" tone="pending" />
          <Legend label="Confirmed" tone="confirmed" />
        </div>
      </header>
      <div className="sk-scroll-x overflow-x-auto">
        <div
          className="grid min-w-[640px]"
          style={{ gridTemplateColumns: "44px repeat(7, 1fr)" }}
          role="grid"
          aria-label="Weekly schedule"
        >
          {/* Header row */}
          <div aria-hidden />
          {DAY_LABELS.map((label, i) => {
            const isToday = i === todayIdx;
            return (
              <div
                key={label}
                className="border-b border-l border-[rgb(var(--border-subtle))] px-1 py-2 text-center first:border-l-0"
              >
                <div className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                  {label}
                </div>
                <div
                  className={[
                    "mx-auto mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs",
                    isToday
                      ? "bg-[rgb(var(--fg-primary))] text-[rgb(var(--fg-inverse))]"
                      : "text-[rgb(var(--fg-primary))]",
                  ].join(" ")}
                  style={{ fontWeight: 700 }}
                  aria-current={isToday ? "date" : undefined}
                >
                  {week[i]?.getDate()}
                </div>
              </div>
            );
          })}

          {/* Hours rows */}
          {hours.map((hour) => (
            <HourRow
              key={hour}
              hour={hour}
              days={DAY_LABELS}
              todayIdx={todayIdx}
              cells={Array.from({ length: 7 }, (_, dayIdx) => {
                return placed.get(`${String(dayIdx)}:${String(hour)}`) ?? [];
              })}
            />
          ))}
        </div>
      </div>
      {sessions.length === 0 ? (
        <p className="border-t border-[rgb(var(--border-subtle))] px-3 py-2 text-[0.7rem] text-[rgb(var(--fg-secondary))]">
          No sessions this week. Pending requests and confirmed bookings will
          appear here as colored blocks.
        </p>
      ) : null}
    </section>
  );
}

function HourRow({
  hour,
  days,
  todayIdx,
  cells,
}: {
  hour: number;
  days: readonly string[];
  todayIdx: number;
  cells: ScheduleSession[][];
}) {
  return (
    <>
      <div
        className="border-t border-[rgb(var(--border-subtle)/0.5)] pr-1 pt-3 text-right font-mono text-[0.6rem] text-[rgb(var(--fg-muted))]"
        style={{ height: HOUR_ROW_PX }}
      >
        {String(hour).padStart(2, "0")}:00
      </div>
      {days.map((_, dayIdx) => {
        const dayCellSessions = cells[dayIdx] ?? [];
        const isToday = dayIdx === todayIdx;
        return (
          <div
            key={dayIdx}
            className={[
              "relative border-l border-t border-[rgb(var(--border-subtle)/0.5)] first:border-l-0",
              isToday ? "bg-[rgb(var(--brand-primary)/0.04)]" : "",
            ].join(" ")}
            style={{ height: HOUR_ROW_PX }}
          >
            {dayCellSessions.map((s) => (
              <SessionBlock key={s.id} session={s} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function SessionBlock({ session }: { session: ScheduleSession }) {
  const dt = new Date(session.startsAt);
  // Position inside the hour cell: minute offset (0–59) → top px.
  const topOffset = (dt.getMinutes() / 60) * HOUR_ROW_PX;
  // Height = (durationMin / 60) * row height, minus 4px gap.
  const height = Math.max(
    24,
    (session.durationMin / 60) * HOUR_ROW_PX - 4,
  );
  const isPending = session.status === "pending";
  const timeLabel = dt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const serviceLabel = session.packageName ?? "Session";

  return (
    <div
      className={[
        "absolute left-1 right-1 overflow-hidden rounded-[var(--radius-sm)] px-1.5 py-1 motion-safe:transition-shadow",
        "shadow-[0_2px_8px_rgb(var(--bg-base)/0.18)] hover:shadow-[0_4px_12px_rgb(var(--bg-base)/0.28)]",
        isPending
          ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]"
          : "bg-[rgb(var(--fg-primary))] text-[rgb(var(--fg-inverse))]",
      ].join(" ")}
      style={{ top: topOffset + 2, height }}
      title={`${session.artistName} · ${timeLabel} · ${serviceLabel}${
        isPending ? " · Pending" : ""
      }`}
    >
      <div
        className="truncate text-[0.66rem] leading-tight"
        style={{ fontWeight: 700 }}
      >
        {session.artistName}
      </div>
      <div className="truncate font-mono text-[0.58rem] opacity-80">
        {timeLabel} · {serviceLabel}
      </div>
    </div>
  );
}

function Legend({ label, tone }: { label: string; tone: "pending" | "confirmed" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.66rem] text-[rgb(var(--fg-secondary))]">
      <span
        aria-hidden
        className={[
          "inline-block h-2.5 w-2.5 rounded-[2px]",
          tone === "pending"
            ? "bg-[rgb(var(--brand-primary))]"
            : "bg-[rgb(var(--fg-primary))]",
        ].join(" ")}
      />
      {label}
    </span>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function buildWeek(): Date[] {
  const today = new Date();
  // Sun = 0, Sat = 6
  const dow = today.getDay();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dow);
  sunday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function weekRangeLabel(week: Date[]): string {
  const first = week[0];
  const last = week[6];
  if (!first || !last) return "";
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${first.toLocaleDateString(undefined, fmt)} – ${last.toLocaleDateString(undefined, fmt)}`;
}
