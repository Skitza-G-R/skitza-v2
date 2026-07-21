"use client";

// Producer Calendar — Schedule tab week grid (spec § 4.2).
//
// The visible range follows producer availability and expands for any
// session outside it. A ResizeObserver derives `--hour-px` from the
// available section height; SessionBlock + NowLineOverlay consume the
// same variable so their positioning stays glued to the right minute.
// Long working days keep a legible minimum row height and scroll inside
// the grid without introducing page-level scroll.
//
// Pure visual; data comes pre-resolved from page.tsx.

import { useEffect, useRef } from "react";

import { calendarDateTimeParts, formatCalendarTime } from "./calendar-time";
import { isSameDay } from "./calendar-week";
import { deriveScheduleHourRange, type ScheduleAvailabilityBlock } from "./schedule-hours";

export type ScheduleSession = {
  id: string;
  startsAt: string; // ISO — serializable across server/client boundary
  durationMin: number;
  artistName: string;
  artistEmail: string;
  packageName: string | null;
  status: "pending_approval" | "confirmed";
};

// Hour row height is driven by `--hour-px` (set on the section via
// ResizeObserver); SessionBlock + NowLineOverlay use this variable in
// calc() to stay aligned as the value changes.
const HOUR_ROW_CSS = "var(--hour-px, 44px)";
const HEADER_ROW_PX = 38; // compact day-label row; matches the offset in NowLineOverlay
const MIN_HOUR_PX = 28; // floor so labels stay legible on tiny viewports
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function ScheduleWeekGrid({
  week,
  sessions,
  availabilityBlocks,
  todayIdx,
  showNowLine,
  initialNow,
  timeZone,
}: {
  week: readonly Date[];
  sessions: readonly ScheduleSession[];
  availabilityBlocks: readonly ScheduleAvailabilityBlock[];
  todayIdx: number;
  showNowLine: boolean;
  initialNow: string;
  timeZone: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const { startHour, endHour } = deriveScheduleHourRange(availabilityBlocks, sessions, timeZone);
  const hoursVisible = endHour - startHour;

  // Measure the section and write `--hour-px` so the grid rows + the
  // SessionBlock absolute math stay perfectly synced with the actual
  // available height. No viewport math, no chrome guesses — the row
  // height is just (sectionHeight - HEADER_ROW_PX) / hoursVisible.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const update = () => {
      const total = node.clientHeight;
      const perHour = Math.max(MIN_HOUR_PX, (total - HEADER_ROW_PX) / hoursVisible);
      node.style.setProperty("--hour-px", `${String(perHour)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => {
      ro.disconnect();
    };
  }, [hoursVisible]);

  const hours = Array.from({ length: hoursVisible }, (_, i) => startHour + i);

  // Bucket sessions per day so the grid only iterates once.
  const perDay: ScheduleSession[][] = week.map(() => []);
  for (const s of sessions) {
    const dt = new Date(s.startsAt);
    const idx = week.findIndex((d) => isSameDay(d, dt, timeZone));
    if (idx < 0) continue;
    perDay[idx]?.push(s);
  }

  return (
    // <lg: the 7-day grid keeps a usable 640px min-width and the
    // section scrolls horizontally (sk-scroll-x = thin scrollbar +
    // momentum). lg+: grid fills the section, no horizontal scroll —
    // identical to the locked desktop layout.
    <section
      ref={sectionRef}
      aria-label="Weekly schedule"
      className="sk-scroll-x relative flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] lg:overflow-x-hidden"
    >
      <div
        className="relative grid min-h-0 min-w-[640px] flex-1 lg:min-w-0"
        style={{
          gridTemplateColumns: "46px repeat(7, minmax(0, 1fr))",
          minHeight: `calc(${String(HEADER_ROW_PX)}px + ${String(hoursVisible)} * ${HOUR_ROW_CSS})`,
        }}
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
                  isToday ? "text-[rgb(var(--brand-primary-dark))]" : "text-[rgb(var(--fg-muted))]",
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
                {day.getUTCDate()}
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
            timeZone={timeZone}
          />
        ))}

        {/* Now-line — absolute child of the (relative) grid itself, so
            its %-math references the grid's content width and the line
            rides along when the grid scrolls horizontally on <lg. On
            lg+ the grid spans the full section — same geometry as
            before. */}
        {showNowLine && todayIdx >= 0 ? (
          <NowLineOverlay
            todayIdx={todayIdx}
            firstHour={startHour}
            endHour={endHour}
            initialNow={initialNow}
            timeZone={timeZone}
          />
        ) : null}
      </div>
    </section>
  );
}

function HourRow({
  hour,
  hourIdx,
  todayIdx,
  cellsPerDay,
  timeZone,
}: {
  hour: number;
  hourIdx: number;
  todayIdx: number;
  cellsPerDay: readonly ScheduleSession[][];
  timeZone: string;
}) {
  return (
    <>
      <div
        className="pr-1.5 text-right font-mono text-[9.5px] text-[rgb(var(--fg-faint))]"
        style={{
          height: HOUR_ROW_CSS,
          paddingTop: hourIdx === 0 ? 0 : 4,
          borderTop: hourIdx === 0 ? "none" : "1px solid rgb(var(--border-subtle))",
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
              borderTop: hourIdx === 0 ? "none" : "1px solid rgb(var(--border-subtle))",
              background: isToday ? "rgb(var(--brand-primary) / 0.025)" : undefined,
            }}
          >
            {daySessions
              .filter((s) => {
                const dt = new Date(s.startsAt);
                return calendarDateTimeParts(dt, timeZone).hour === hour;
              })
              .map((s) => (
                <SessionBlock key={s.id} session={s} timeZone={timeZone} />
              ))}
          </div>
        );
      })}
    </>
  );
}

function SessionBlock({ session, timeZone }: { session: ScheduleSession; timeZone: string }) {
  const dt = new Date(session.startsAt);
  const minute = calendarDateTimeParts(dt, timeZone).minute;
  const lenHours = session.durationMin / 60;
  const isPending = session.status !== "confirmed";
  const isCompact = session.durationMin < 90;

  const timeLabel = formatCalendarTime(dt, timeZone);
  const endTimeLabel = formatCalendarTime(
    new Date(dt.getTime() + session.durationMin * 60_000),
    timeZone,
  );
  const timeRangeLabel = `${timeLabel}–${endTimeLabel}`;
  const serviceLabel = session.packageName ?? "Session";
  const accessibleLabel = `${serviceLabel} with ${session.artistName}, ${timeRangeLabel}, ${
    isPending ? "pending" : "confirmed"
  }`;

  // Pixel math is expressed in CSS so the block stays aligned as
  // `--hour-px` shrinks/grows with the viewport.
  const minuteFraction = minute / 60;
  const top = `calc(${String(minuteFraction)} * ${HOUR_ROW_CSS} + 2px)`;
  const height = `max(28px, calc(${String(lenHours)} * ${HOUR_ROW_CSS} - 8px))`;

  return (
    <div
      role="group"
      aria-label={accessibleLabel}
      className={[
        "absolute right-1 left-1 overflow-hidden rounded-[10px] border",
        isPending
          ? "border-dashed text-[rgb(var(--fg-default))] shadow-[0_3px_10px_-6px_rgb(var(--brand-primary-dark)/0.35)]"
          : "text-[rgb(var(--fg-on-brand))] shadow-[0_5px_14px_-7px_rgb(var(--brand-primary-dark)/0.55)]",
      ].join(" ")}
      style={{
        top,
        height,
        borderColor: isPending
          ? "rgb(var(--brand-primary) / 0.55)"
          : "rgb(var(--brand-primary-dark) / 0.5)",
        background: isPending
          ? "linear-gradient(145deg, rgb(var(--brand-primary) / 0.2), rgb(var(--brand-primary) / 0.09))"
          : "linear-gradient(145deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-primary)) 54%, rgb(var(--brand-primary-dark)) 145%)",
        paddingLeft: isCompact ? 8 : 11,
        paddingTop: isCompact ? 5 : 8,
        paddingRight: isCompact ? 7 : 9,
        paddingBottom: isCompact ? 5 : 8,
      }}
      title={`${session.artistName} · ${timeRangeLabel} · ${serviceLabel}${
        isPending ? " · Pending" : ""
      }`}
    >
      {/* Warm inset edge keeps the block legible over the grid lines. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] rounded-l-[9px] bg-[rgb(var(--fg-on-brand)/0.72)]"
      />

      <div
        className={[
          "relative flex h-full min-w-0",
          isCompact ? "items-center justify-between gap-2" : "flex-col items-start",
        ].join(" ")}
      >
        <div className="flex w-full min-w-0 items-start gap-2">
          <div
            className="min-w-0 flex-1 truncate text-[12px] leading-[1.12] tracking-[-0.015em]"
            style={{ fontWeight: 800 }}
          >
            {serviceLabel}
          </div>
          {!isCompact && isPending ? (
            <span className="shrink-0 rounded-[5px] bg-[rgb(var(--brand-primary)/0.2)] px-1.5 py-0.5 font-mono text-[7.5px] font-bold tracking-[0.08em] text-[rgb(var(--brand-primary-text))]">
              PENDING
            </span>
          ) : null}
        </div>

        {!isCompact ? (
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--fg-on-brand)/0.72)]"
            />
            <span className="truncate font-mono text-[9px] font-semibold tracking-[0.025em] opacity-75">
              {session.artistName}
            </span>
          </div>
        ) : null}

        <div className={isCompact ? "shrink-0" : "mt-auto"}>
          <span className="inline-flex rounded-[5px] bg-[rgb(var(--fg-on-brand)/0.12)] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.015em] tabular-nums">
            {timeRangeLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function NowLineOverlay({
  todayIdx,
  firstHour,
  endHour,
  initialNow,
  timeZone,
}: {
  todayIdx: number;
  firstHour: number;
  endHour: number;
  initialNow: string;
  timeZone: string;
}) {
  const now = new Date(initialNow);
  const { hour, minute: min } = calendarDateTimeParts(now, timeZone);
  const offsetHours = hour + min / 60 - firstHour;
  if (offsetHours < 0 || offsetHours > endHour - firstHour) return null;
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
      <div className="relative h-[1.5px]" style={{ background: "rgb(var(--fg-danger))" }}>
        <span
          className="absolute -top-[3px] -left-[3px] h-2 w-2 rounded-full"
          style={{ background: "rgb(var(--fg-danger))" }}
        />
        <span
          className="absolute -top-2.5 -right-1 inline-flex items-center rounded-[4px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1.5 py-0.5 font-mono text-[9px] text-[rgb(var(--fg-default))] shadow-sm"
          style={{ fontWeight: 700 }}
        >
          {formatCalendarTime(now, timeZone)}
        </span>
      </div>
    </div>
  );
}
