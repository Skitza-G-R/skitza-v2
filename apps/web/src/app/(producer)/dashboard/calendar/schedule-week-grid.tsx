"use client";

// Producer Calendar — Schedule tab week grid (spec § 4.2).
//
// `grid-template-columns: 46px repeat(7, 1fr)`, body 10 hours × 56px.
// Confirmed sessions render as dark blocks; pending sessions render as
// white "card with kind stripe" treatment so the producer can spot
// requests at a glance. The "now-line" sweeps today's column when the
// producer is viewing the current week.
//
// Pure visual; data comes pre-resolved from page.tsx.

import { isSameDay } from "./calendar-week";
import { KIND_COLORS, inferSessionKind } from "./session-kind";

export type ScheduleSession = {
  id: string;
  startsAt: string; // ISO — serializable across server/client boundary
  durationMin: number;
  artistName: string;
  packageName: string | null;
  status: "pending_approval" | "pending_payment" | "confirmed";
};

const HOUR_START = 9;
const HOUR_END = 18; // last cell row label
const HOUR_ROW_PX = 56;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function ScheduleWeekGrid({
  week,
  sessions,
  todayIdx,
  showNowLine,
}: {
  week: readonly Date[];
  sessions: readonly ScheduleSession[];
  todayIdx: number;
  showNowLine: boolean;
}) {
  const hours = Array.from(
    { length: HOUR_END - HOUR_START + 1 },
    (_, i) => HOUR_START + i,
  );

  // Bucket sessions per day so the grid only iterates once.
  const perDay: ScheduleSession[][] = week.map(() => []);
  for (const s of sessions) {
    const dt = new Date(s.startsAt);
    const idx = week.findIndex((d) => isSameDay(d, dt));
    if (idx < 0) continue;
    perDay[idx]?.push(s);
  }

  return (
    <section
      aria-label="Weekly schedule"
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: "46px repeat(7, minmax(0, 1fr))" }}
      >
        {/* Header row */}
        <div aria-hidden className="border-b border-[rgb(var(--border-subtle))] py-3" />
        {DAY_LABELS.map((label, i) => {
          const day = week[i];
          if (!day) return null;
          const isToday = i === todayIdx;
          return (
            <div
              key={label}
              className="border-b border-l border-[rgb(var(--border-subtle))] px-1 py-3 text-center first-of-type:border-l-0"
            >
              <div
                className={[
                  "font-mono text-[10px] tracking-[0.12em]",
                  isToday
                    ? "text-[rgb(var(--brand-primary-dark))]"
                    : "text-[rgb(var(--fg-muted))]",
                ].join(" ")}
                style={{ fontWeight: 700 }}
              >
                {label.toUpperCase()}
              </div>
              <div
                className={[
                  "mx-auto mt-1.5 inline-flex h-[30px] w-[30px] items-center justify-center rounded-full font-mono text-[12px]",
                  isToday
                    ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--fg-inverse))]"
                    : "text-[rgb(var(--fg-default))]",
                ].join(" ")}
                style={{ fontWeight: 700 }}
                aria-current={isToday ? "date" : undefined}
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}

        {/* Body rows */}
        {hours.map((hour, hourIdx) => (
          <HourRow
            key={hour}
            hour={hour}
            hourIdx={hourIdx}
            todayIdx={todayIdx}
            cellsPerDay={perDay}
          />
        ))}
      </div>

      {/* Now-line — overlaid via a portal-style absolute child of the
          first day cell when applicable. Implemented inside the grid
          rather than overlay-positioned so it scrolls with content
          (the grid is the only scroll container on small widths). */}
      {showNowLine && todayIdx >= 0 ? (
        <NowLineOverlay todayIdx={todayIdx} firstHour={HOUR_START} hourPx={HOUR_ROW_PX} />
      ) : null}
    </section>
  );
}

function HourRow({
  hour,
  hourIdx,
  todayIdx,
  cellsPerDay,
}: {
  hour: number;
  hourIdx: number;
  todayIdx: number;
  cellsPerDay: readonly ScheduleSession[][];
}) {
  return (
    <>
      <div
        className="pr-1.5 text-right font-mono text-[9.5px] text-[rgb(var(--fg-faint))]"
        style={{
          height: HOUR_ROW_PX,
          paddingTop: hourIdx === 0 ? 0 : 4,
          borderTop:
            hourIdx === 0 ? "none" : "1px solid rgb(var(--border-subtle))",
        }}
      >
        {String(hour).padStart(2, "0")}:00
      </div>
      {cellsPerDay.map((daySessions, dayIdx) => {
        const isToday = dayIdx === todayIdx;
        return (
          <div
            key={dayIdx}
            className="relative border-l border-[rgb(var(--border-subtle))] first-of-type:border-l-0"
            style={{
              height: HOUR_ROW_PX,
              borderTop:
                hourIdx === 0
                  ? "none"
                  : "1px solid rgb(var(--border-subtle))",
              background: isToday
                ? "rgb(var(--brand-primary) / 0.025)"
                : undefined,
            }}
          >
            {daySessions
              .filter((s) => {
                const dt = new Date(s.startsAt);
                return dt.getHours() === hour;
              })
              .map((s) => (
                <SessionBlock key={s.id} session={s} hourPx={HOUR_ROW_PX} />
              ))}
          </div>
        );
      })}
    </>
  );
}

function SessionBlock({
  session,
  hourPx,
}: {
  session: ScheduleSession;
  hourPx: number;
}) {
  const dt = new Date(session.startsAt);
  const minute = dt.getMinutes();
  const lenHours = session.durationMin / 60;
  const top = (minute / 60) * hourPx;
  const height = Math.max(28, lenHours * hourPx - 8);
  const isPending = session.status !== "confirmed";
  const kind = inferSessionKind(session.packageName);
  const kindToken = KIND_COLORS[kind];

  const timeLabel = dt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const serviceLabel = session.packageName ?? "Session";

  return (
    <div
      className={[
        "absolute left-1 right-1 overflow-hidden rounded-[9px] motion-safe:transition-shadow",
        isPending
          ? "border bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]"
          : "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))] shadow-[0_2px_8px_rgb(17_16_9_/_0.18)]",
      ].join(" ")}
      style={{
        top: top + 2,
        height,
        borderColor: isPending ? "rgb(var(--border-strong))" : undefined,
        paddingLeft: 10,
        paddingTop: 6,
        paddingRight: 8,
        paddingBottom: 6,
      }}
      title={`${session.artistName} · ${timeLabel} · ${serviceLabel}${
        isPending ? " · Pending" : ""
      }`}
    >
      {/* Kind stripe on the left edge */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px] rounded-l-[9px]"
        style={{ background: `rgb(var(${kindToken}))` }}
      />
      {isPending ? (
        <span
          className="absolute right-2 top-1.5 font-mono text-[8.5px] tracking-[0.08em] text-[rgb(var(--brand-primary-dark))]"
          style={{ fontWeight: 700 }}
        >
          PENDING
        </span>
      ) : null}
      {/* Title (700, prominent) = the session purpose so producers
          scan their week by craft ("3 mixes, 1 master") rather than
          by client. Client name + time mono'd on the row below. */}
      <div
        className="truncate text-[11px] leading-tight"
        style={{ fontWeight: 700 }}
      >
        {serviceLabel}
      </div>
      <div className="truncate font-mono text-[9px] opacity-70">
        {timeLabel}
        {lenHours >= 1 ? ` · ${session.artistName}` : ""}
      </div>
    </div>
  );
}

function NowLineOverlay({
  todayIdx,
  firstHour,
  hourPx,
}: {
  todayIdx: number;
  firstHour: number;
  hourPx: number;
}) {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const offsetHours = hour + min / 60 - firstHour;
  // Outside the visible 9-18 window? Hide.
  if (offsetHours < 0 || offsetHours > HOUR_END - firstHour + 1) return null;
  const top = offsetHours * hourPx + 49; // 49px header offset per spec
  // todayIdx is 0..6 over the 7 day columns (each minmax(0,1fr)).
  const leftPct = `calc(46px + ${String(todayIdx)} * (100% - 46px) / 7)`;
  const widthPct = `calc((100% - 46px) / 7)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: leftPct, top, width: widthPct }}
    >
      <div
        className="relative h-[1.5px]"
        style={{ background: "rgb(var(--fg-danger))" }}
      >
        <span
          className="absolute -left-[3px] -top-[3px] h-2 w-2 rounded-full"
          style={{ background: "rgb(var(--fg-danger))" }}
        />
        <span
          className="absolute -right-1 -top-2.5 inline-flex items-center rounded-[4px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1.5 py-0.5 font-mono text-[9px] text-[rgb(var(--fg-default))] shadow-sm"
          style={{ fontWeight: 700 }}
        >
          {String(now.getHours()).padStart(2, "0")}:
          {String(now.getMinutes()).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
