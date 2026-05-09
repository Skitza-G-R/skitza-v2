"use client";

// Producer Calendar — Schedule tab orchestrator.
//
// Composes:
//   - ScheduleWeekNav  (top control strip — prev/Today/next + GCal)
//   - ScheduleWeekGrid (left, the redesigned week grid)
//   - ScheduleTodayAgenda + SchedulePendingCard (right rail, 300px)
//
// Owns `weekOffset` client-side; navigation slides the visible week
// without a server round-trip. The full session set for ±2 weeks
// is hydrated from the page so flipping a week is instant.

import { useMemo, useState } from "react";

import { buildWeek, isSameDay, todayIndex } from "./calendar-week";
import {
  ScheduleWeekGrid,
  type ScheduleSession,
} from "./schedule-week-grid";
import { ScheduleWeekNav } from "./schedule-week-nav";
import {
  ScheduleTodayAgenda,
  type TodaySession,
} from "./schedule-today-agenda";
import {
  SchedulePendingCard,
  type PendingRequest,
} from "./schedule-pending-card";

export type ScheduleData = {
  // All sessions in a wide window so we can flip weeks client-side.
  sessions: readonly ScheduleSession[];
  // Pre-filtered today's sessions (server already knows producer's date).
  todaySessions: readonly TodaySession[];
  pending: readonly PendingRequest[];
  autoConfirm: boolean;
};

export function SchedulePanel({
  sessions,
  todaySessions,
  pending,
  autoConfirm,
  // Server-rendered "now" so first-paint is consistent. Hydration
  // re-derives from the client clock — slight drift is fine.
  initialNow,
}: ScheduleData & { initialNow: string }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const reference = useMemo(() => new Date(initialNow), [initialNow]);

  const week = useMemo(
    () => buildWeek(reference, weekOffset),
    [reference, weekOffset],
  );
  const tIdx = todayIndex(week);

  // Filter sessions visible in the current week.
  const visible = useMemo(() => {
    return sessions.filter((s) => {
      const dt = new Date(s.startsAt);
      return week.some((d) => isSameDay(d, dt));
    });
  }, [sessions, week]);

  // Stats for the readout — counts confirmed + pending; sums duration.
  const totalSessions = visible.length;
  const totalHours =
    Math.round(
      (visible.reduce((acc, s) => acc + s.durationMin, 0) / 60) * 10,
    ) / 10;

  return (
    <div className="space-y-4">
      <ScheduleWeekNav
        week={week}
        weekOffset={weekOffset}
        totalSessions={totalSessions}
        totalHours={totalHours}
        onPrev={() => {
          setWeekOffset((o) => o - 1);
        }}
        onToday={() => {
          setWeekOffset(0);
        }}
        onNext={() => {
          setWeekOffset((o) => o + 1);
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ScheduleWeekGrid
          week={week}
          sessions={visible}
          todayIdx={tIdx}
          showNowLine={weekOffset === 0}
        />
        <div className="flex flex-col gap-4">
          <ScheduleTodayAgenda
            sessions={todaySessions}
            weekOffset={weekOffset}
          />
          <SchedulePendingCard initial={pending} autoConfirm={autoConfirm} />
        </div>
      </div>
    </div>
  );
}
