"use client";

// Producer Calendar — Schedule tab orchestrator.
//
// Composes:
//   - ScheduleWeekNav  (top control strip — prev/Today/next)
//   - ScheduleWeekGrid (left, the redesigned week grid)
//   - ScheduleSessionsCard + SchedulePendingCard (right rail, 260px)
//
// Owns `weekOffset` client-side; navigation slides the visible week
// without a server round-trip. The full session set for ±2 weeks
// is hydrated from the page so flipping a week is instant.

import { useEffect, useMemo, useRef, useState } from "react";

import { loadGoogleCalendarBusyWeek } from "./google-calendar-actions";
import { buildWeek, isSameDay, todayIndex } from "./calendar-week";
import { studioDateKey } from "./calendar-slot";
import { useManualSessionLauncher } from "./manual-session-launcher-context";
import type { ScheduleAvailabilityBlock } from "./schedule-hours";
import { ScheduleSessionsCard } from "./schedule-sessions-card";
import { ScheduleWeekGrid, type ScheduleSession } from "./schedule-week-grid";
import { ScheduleWeekNav } from "./schedule-week-nav";
import { SchedulePendingCard, type PendingRequest } from "./schedule-pending-card";
import type { SessionListItem } from "./session-row";
import type { GoogleCalendarBusyWeekView } from "~/server/google-calendar/busy-week";

const BUSY_WEEK_CACHE_MS = 30_000;

export type ScheduleData = {
  // All sessions in a wide window so we can flip weeks client-side.
  sessions: readonly ScheduleSession[];
  // Full booking history for the compact desktop Sessions rail.
  desktopSessions: readonly SessionListItem[];
  availabilityBlocks: readonly ScheduleAvailabilityBlock[];
  pending: readonly PendingRequest[];
  autoConfirm: boolean;
  selectedBookingId?: string | null;
};

export function SchedulePanel({
  sessions,
  desktopSessions,
  availabilityBlocks,
  pending,
  autoConfirm,
  selectedBookingId = null,
  // Server-rendered "now" keeps the first client render identical.
  initialNow,
  timeZone,
}: ScheduleData & { initialNow: string; timeZone: string }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const { openSessionManagement, reportGoogleBusyProtection } = useManualSessionLauncher();
  const [googleBusyWeek, setGoogleBusyWeek] = useState<GoogleCalendarBusyWeekView | null>(null);
  const busyRequest = useRef(0);
  const busyCache = useRef(
    new Map<string, { fetchedAt: number; view: GoogleCalendarBusyWeekView }>(),
  );
  const reference = useMemo(() => new Date(initialNow), [initialNow]);
  const manageableSessionIds = useMemo(
    () => new Set(desktopSessions.map((session) => session.id)),
    [desktopSessions],
  );

  const week = useMemo(
    () => buildWeek(reference, weekOffset, timeZone),
    [reference, timeZone, weekOffset],
  );
  const tIdx = todayIndex(week, reference, timeZone);
  const weekStart = studioDateKey(week[0] ?? reference);

  useEffect(() => {
    const request = busyRequest.current + 1;
    busyRequest.current = request;
    const cached = busyCache.current.get(weekStart);
    if (cached && Date.now() - cached.fetchedAt < BUSY_WEEK_CACHE_MS) {
      setGoogleBusyWeek(cached.view);
      return;
    }
    setGoogleBusyWeek(null);
    void loadGoogleCalendarBusyWeek({ weekStart }).then((view) => {
      if (request !== busyRequest.current) return;
      busyCache.current.set(weekStart, { fetchedAt: Date.now(), view });
      setGoogleBusyWeek(view);
    });
  }, [weekStart]);

  useEffect(() => {
    if (!googleBusyWeek) return;
    reportGoogleBusyProtection(googleBusyWeek.protection === "skitza_only");
  }, [googleBusyWeek, reportGoogleBusyProtection]);

  // Filter sessions visible in the current week.
  const visible = useMemo(() => {
    return sessions
      .filter((s) => {
        const dt = new Date(s.startsAt);
        return week.some((d) => isSameDay(d, dt, timeZone));
      })
      .map((session) => ({
        ...session,
        canManage: manageableSessionIds.has(session.id),
      }));
  }, [manageableSessionIds, sessions, timeZone, week]);

  // Stats for the readout — counts confirmed + pending; sums duration.
  const totalSessions = visible.length;
  const totalHours =
    Math.round((visible.reduce((acc, s) => acc + s.durationMin, 0) / 60) * 10) / 10;
  const selectedSession = desktopSessions.find((session) => session.id === selectedBookingId);
  const selectedPendingId =
    selectedSession?.status === "pending_approval" ? selectedBookingId : null;
  const selectedSessionId = selectedPendingId ? null : selectedBookingId;

  return (
    // Flex column with min-h-0 so the grid+rail row below grows to
    // fill the viewport-locked panel without the page itself
    // scrolling.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <ScheduleWeekGrid
          week={week}
          sessions={visible}
          availabilityBlocks={availabilityBlocks}
          todayIdx={tIdx}
          showNowLine={weekOffset === 0}
          initialNow={initialNow}
          timeZone={timeZone}
          googleBusyWeek={googleBusyWeek}
          onManageSession={(sessionId) => {
            const session = desktopSessions.find((candidate) => candidate.id === sessionId);
            if (session) {
              openSessionManagement(session);
            }
          }}
        />
        {/* Right rail mirrors the grid's height (same grid row).
            min-h-0 + overflow-hidden keeps content inside the rail
            without a visible scrollbar — cards are sized for the
            typical case (a few sessions, a few pending). */}
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <ScheduleSessionsCard
            sessions={desktopSessions}
            initialNow={initialNow}
            timeZone={timeZone}
            selectedBookingId={selectedSessionId}
          />
          <SchedulePendingCard
            initial={pending}
            autoConfirm={autoConfirm}
            initialNow={initialNow}
            timeZone={timeZone}
            selectedBookingId={selectedPendingId}
          />
        </div>
      </div>
    </div>
  );
}
