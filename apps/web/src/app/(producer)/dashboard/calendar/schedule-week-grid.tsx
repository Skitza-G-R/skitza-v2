"use client";

// Producer Calendar — Schedule tab week grid (spec § 4.2).
//
// Body rows fill the available height: a ResizeObserver measures the
// section, derives `--hour-px = (sectionHeight - HEADER_ROW_PX) / N`,
// and writes it back as a CSS variable. SessionBlock + NowLineOverlay
// consume the same variable through calc() so their absolute
// positioning stays glued to the right minute regardless of viewport.
// Result: the Schedule tab fits exactly inside its parent flex box —
// no page-level scroll, no overflow, no guessing the chrome budget.
//
// Pure visual; data comes pre-resolved from page.tsx.

import { useEffect, useRef } from "react";

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
// Hour row height is driven by `--hour-px` (set on the section via
// ResizeObserver); SessionBlock + NowLineOverlay use this variable in
// calc() to stay aligned as the value changes.
const HOUR_ROW_CSS = "var(--hour-px, 44px)";
const HEADER_ROW_PX = 38; // compact day-label row; matches the offset in NowLineOverlay
const HOURS_VISIBLE = 10;
const MIN_HOUR_PX = 28; // floor so labels stay legible on tiny viewports
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
  const sectionRef = useRef<HTMLElement>(null);

  // Measure the section and write `--hour-px` so the grid rows + the
  // SessionBlock absolute math stay perfectly synced with the actual
  // available height. No viewport math, no chrome guesses — the row
  // height is just (sectionHeight - HEADER_ROW_PX) / HOURS_VISIBLE.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const update = () => {
      const total = node.clientHeight;
      const perHour = Math.max(MIN_HOUR_PX, (total - HEADER_ROW_PX) / HOURS_VISIBLE);
      node.style.setProperty("--hour-px", `${String(perHour)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => {
      ro.disconnect();
    };
  }, []);

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
      ref={sectionRef}
      aria-label="Weekly schedule"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: "46px repeat(7, minmax(0, 1fr))" }}
      >
        {/* Header row — fixed compact height so the body rows soak up
            the remaining viewport via `--hour-px`. */}
        <div
          aria-hidden
          className="border-b border-[rgb(var(--border-subtle))]"
          style={{ height: HEADER_ROW_PX }}
        />
        {DAY_LABELS.map((label, i) => {
          const day = week[i];
          if (!day) return null;
          const isToday = i === todayIdx;
          return (
            <div
              key={label}
              className="flex flex-col items-center justify-center border-b border-l border-[rgb(var(--border-subtle))] px-1 first-of-type:border-l-0"
              style={{ height: HEADER_ROW_PX }}
            >
              <div
                className={[
                  "font-mono text-[9.5px] leading-none tracking-[0.1em]",
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
                  "mt-0.5 inline-flex h-[20px] w-[20px] items-center justify-center rounded-full font-mono text-[11px]",
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

        {/* Body rows — each cell's height is driven by `--hour-px`. */}
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
        <NowLineOverlay todayIdx={todayIdx} firstHour={HOUR_START} />
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
          height: HOUR_ROW_CSS,
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
              height: HOUR_ROW_CSS,
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
  const minute = dt.getMinutes();
  const lenHours = session.durationMin / 60;
  const isPending = session.status !== "confirmed";
  const kind = inferSessionKind(session.packageName);
  const kindToken = KIND_COLORS[kind];

  const timeLabel = dt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const serviceLabel = session.packageName ?? "Session";

  // Pixel math is expressed in CSS so the block stays aligned as
  // `--hour-px` shrinks/grows with the viewport.
  const minuteFraction = minute / 60;
  const top = `calc(${String(minuteFraction)} * ${HOUR_ROW_CSS} + 2px)`;
  const height = `max(28px, calc(${String(lenHours)} * ${HOUR_ROW_CSS} - 8px))`;

  return (
    <div
      className={[
        "absolute left-1 right-1 overflow-hidden rounded-[9px] motion-safe:transition-shadow",
        isPending
          ? "border bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]"
          : "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))] shadow-[0_2px_8px_rgb(17_16_9_/_0.18)]",
      ].join(" ")}
      style={{
        top,
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
}: {
  todayIdx: number;
  firstHour: number;
}) {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const offsetHours = hour + min / 60 - firstHour;
  // Outside the visible 9-18 window? Hide.
  if (offsetHours < 0 || offsetHours > HOUR_END - firstHour + 1) return null;
  // Top math expressed in CSS calc so the now-line stays glued to the
  // correct minute as `--hour-px` shrinks/grows with the viewport.
  const top = `calc(${String(offsetHours)} * ${HOUR_ROW_CSS} + ${String(HEADER_ROW_PX)}px)`;
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
