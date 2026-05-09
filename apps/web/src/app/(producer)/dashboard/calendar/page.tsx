import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { AvailabilityPanel } from "./availability-panel";

import { CalendarTabs } from "./calendar-tabs";
import {
  type CalendarTabKey,
  resolveCalendarTab,
} from "./calendar-tab-key";
import { weekEyebrow } from "./calendar-week";
import { SchedulePanel } from "./schedule-panel";
import type { ScheduleSession } from "./schedule-week-grid";
import type { TodaySession } from "./schedule-today-agenda";
import type { PendingRequest } from "./schedule-pending-card";
import { SessionsPanel } from "./sessions-panel";
import type { SessionListItem } from "./session-row";

// Per-tab subline copy. The H1 is always "Calendar" — the tab in the
// segmented control names the section, the eyebrow gives dynamic
// context (week / total sessions / weekly hours).
const SUBLINE: Record<CalendarTabKey, string> = {
  schedule:
    "Your week at a glance — confirmed sessions, pending requests, today's lineup.",
  sessions:
    "Every session you've booked — upcoming, past, and the actions you can take per row.",
  availability:
    "When you're open for bookings — weekly hours, blackouts, and session policies.",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolved = await searchParams;
  const active = resolveCalendarTab(resolved.tab);

  const caller = appRouter.createCaller({ userId });

  // -------- Schedule tab data --------
  let scheduleSessions: ScheduleSession[] = [];
  let todaySessions: TodaySession[] = [];
  let pendingRequests: PendingRequest[] = [];
  let scheduleAutoConfirm = false;
  const initialNow = new Date();
  if (active === "schedule") {
    const [pending, upcoming, settings] = await Promise.all([
      caller.booking.list({ status: "pending_approval" }),
      caller.booking.upcoming({ days: 21 }),
      caller.booking.availability.getSettings(),
    ]);

    scheduleAutoConfirm = settings.autoConfirmBookings;

    pendingRequests = pending.map((b) => ({
      id: b.id,
      artistName: b.artistName,
      artistEmail: b.artistEmail,
      startsAt: b.startsAt.toISOString(),
      durationMin: b.durationMin,
      packageName: b.packageNameSnapshot,
      message: b.notes,
      receivedAtIso: b.createdAt.toISOString(),
    }));

    scheduleSessions = [
      ...pending.map<ScheduleSession>((b) => ({
        id: b.id,
        startsAt: b.startsAt.toISOString(),
        durationMin: b.durationMin,
        artistName: b.artistName,
        packageName: b.packageNameSnapshot,
        status: "pending_approval",
      })),
      ...upcoming.map<ScheduleSession>((b) => ({
        id: b.id,
        startsAt: b.startsAt.toISOString(),
        durationMin: b.durationMin,
        artistName: b.artistName,
        packageName: b.packageName,
        status: "confirmed",
      })),
    ];

    // Today's agenda — confirmed sessions whose date matches "today".
    const startOfToday = new Date(initialNow);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    todaySessions = upcoming
      .filter(
        (b) => b.startsAt >= startOfToday && b.startsAt < startOfTomorrow,
      )
      .map((b) => ({
        id: b.id,
        artistName: b.artistName,
        startsAt: b.startsAt.toISOString(),
        durationMin: b.durationMin,
        packageName: b.packageName,
      }));
  }

  // -------- Sessions tab data --------
  let allSessions: SessionListItem[] = [];
  if (active === "sessions") {
    const list = await caller.booking.list();
    allSessions = list.map((b) => ({
      id: b.id,
      artistName: b.artistName,
      artistEmail: b.artistEmail,
      startsAt: b.startsAt.toISOString(),
      durationMin: b.durationMin,
      packageName: b.packageNameSnapshot,
      status: b.status,
    }));
  }

  // -------- Availability tab data --------
  let availabilityBlocks: { weekday: number; startMin: number; endMin: number }[] = [];
  let availabilityBlackouts: {
    id: string;
    startDate: string;
    endDate: string;
    reason: string | null;
  }[] = [];
  let availabilitySettings = {
    autoConfirmBookings: false,
    cancellationPolicyHours: 24,
  };
  if (active === "availability") {
    const [blocks, blackouts, settings] = await Promise.all([
      caller.booking.availability.list(),
      caller.booking.blackouts.list(),
      caller.booking.availability.getSettings(),
    ]);
    availabilityBlocks = blocks.map((b) => ({
      weekday: b.weekday,
      startMin: b.startMin,
      endMin: b.endMin,
    }));
    availabilityBlackouts = blackouts.map((b) => ({
      id: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
      reason: b.reason,
    }));
    availabilitySettings = {
      autoConfirmBookings: settings.autoConfirmBookings,
      cancellationPolicyHours: settings.cancellationPolicyHours,
    };
  }

  // Tab-aware eyebrow — gives the section dynamic context. Schedule
  // shows the current week date; Sessions shows totals; Availability
  // shows weekly hours open. The eyebrow stays static across client-
  // side week navigation — the WeekNav inside SchedulePanel surfaces
  // the navigated week's range readout instead.
  let eyebrow = "PRODUCER CALENDAR";
  if (active === "schedule") {
    const sun = new Date(initialNow);
    sun.setDate(sun.getDate() - sun.getDay());
    sun.setHours(0, 0, 0, 0);
    eyebrow = weekEyebrow(sun);
  } else if (active === "sessions") {
    const total = allSessions.length;
    const upcomingCount = allSessions.filter((s) => {
      const start = new Date(s.startsAt);
      const endMs = start.getTime() + s.durationMin * 60_000;
      const isCancelled =
        s.status === "cancelled" || s.status === "rejected";
      return !isCancelled && endMs > initialNow.getTime();
    }).length;
    eyebrow =
      total === 0
        ? "NO SESSIONS YET"
        : `${String(total)} SESSION${total === 1 ? "" : "S"} · ${String(upcomingCount)} UPCOMING`;
  } else {
    // active === "availability" by exhaustive narrowing.
    const totalMin = availabilityBlocks.reduce(
      (acc, b) => acc + (b.endMin - b.startMin),
      0,
    );
    const hours = Math.round((totalMin / 60) * 10) / 10;
    const hoursLabel = Number.isInteger(hours)
      ? String(hours)
      : hours.toFixed(1).replace(/\.0$/, "");
    eyebrow =
      hours === 0
        ? "AVAILABILITY NOT SET"
        : `${hoursLabel}H OPEN PER WEEK`;
  }

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:py-10">
      {/* Calendar gets a generous canvas — sm+ surfaces the elevated
          card; mobile drops the chrome to maximise usable width. */}
      <div className="rounded-none border-0 bg-transparent p-0 sm:rounded-[var(--radius-2xl)] sm:border sm:border-[rgb(var(--border-strong))] sm:bg-[rgb(var(--bg-elevated))] sm:px-6 sm:py-7">
        {/* Header — eyebrow + Syne 800 "Calendar" H1 on the left,
            segmented tabs top-right at sm+. The H1 is always
            "Calendar" — the tab below names the section. */}
        <header className="reveal-up mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p
                key={`eyebrow-${active}`}
                className="reveal-up font-mono text-[10px] tracking-[0.18em] text-[rgb(var(--fg-muted))]"
                style={{ fontWeight: 700 }}
              >
                {eyebrow}
              </p>
              <h1
                className="reveal-up mt-1 font-display leading-[0.95]"
                style={{
                  fontSize: "clamp(34px, 4.5vw, 52px)",
                  fontWeight: 800,
                  letterSpacing: "-0.035em",
                }}
              >
                Calendar
              </h1>
              <p
                key={`desc-${active}`}
                className="reveal-up mt-2 max-w-xl text-[13.5px] text-[rgb(var(--fg-muted))]"
              >
                {SUBLINE[active]}
              </p>
            </div>
            <CalendarTabs active={active} />
          </div>
        </header>

        <div
          key={active}
          id={`calendar-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`calendar-tab-${active}`}
          className="reveal-up pt-1"
        >
          {active === "schedule" && (
            <SchedulePanel
              sessions={scheduleSessions}
              todaySessions={todaySessions}
              pending={pendingRequests}
              autoConfirm={scheduleAutoConfirm}
              initialNow={initialNow.toISOString()}
            />
          )}
          {active === "sessions" && (
            <SessionsPanel
              sessions={allSessions}
              initialNow={initialNow.toISOString()}
            />
          )}
          {active === "availability" && (
            <AvailabilityPanel
              blocks={availabilityBlocks}
              blackouts={availabilityBlackouts}
              settings={availabilitySettings}
            />
          )}
        </div>
      </div>
    </div>
  );
}
