import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  AvailabilitySection,
  type AvailabilityBlock,
  type Blackout,
  type AvailabilitySettings,
} from "~/components/dashboard/setup/availability-section";
import { appRouter } from "~/server/trpc/routers/_app";

import { CalendarTabs } from "./calendar-tabs";
import { type CalendarTabKey, isCalendarTab } from "./calendar-tab-key";
import type { IntroRequest } from "./intro-requests-panel";
import type { ScheduleSession } from "./week-grid";
import type { TodayNext } from "./today-card";
import { MeetingsPanel, type MeetingRow } from "./meetings-panel";

const META: Record<CalendarTabKey, { title: string; description: string }> = {
  meetings: {
    title: "Meetings",
    description:
      "Sessions with your artists. Confirm new requests and review what's coming up.",
  },
  availability: {
    title: "Availability",
    description:
      "When you're open for bookings — weekly hours, blackouts, and session policies.",
  },
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolved = await searchParams;
  const active: CalendarTabKey = isCalendarTab(resolved.tab) ? resolved.tab : "meetings";

  const caller = appRouter.createCaller({ userId });

  let pendingMeetings: IntroRequest[] = [];
  let upcomingMeetings: MeetingRow[] = [];
  let scheduleSessions: ScheduleSession[] = [];
  let todayNext: TodayNext | null = null;
  let meetingsAutoConfirm = false;
  if (active === "meetings") {
    const [pending, upcoming, settings] = await Promise.all([
      caller.booking.list({ status: "pending" }),
      caller.booking.upcoming({ days: 14 }),
      caller.booking.availability.getSettings(),
    ]);
    pendingMeetings = pending.map((b) => ({
      id: b.id,
      artistName: b.artistName,
      artistEmail: b.artistEmail,
      startsAt: b.startsAt.toISOString(),
      durationMin: b.durationMin,
      message: b.notes,
      packageName: b.packageNameSnapshot,
    }));
    upcomingMeetings = upcoming.map((b) => ({
      id: b.id,
      artistName: b.artistName,
      startsAt: b.startsAt.toISOString(),
      durationMin: b.durationMin,
      packageName: b.packageName,
    }));
    meetingsAutoConfirm = settings.autoConfirmBookings;

    // Schedule grid combines this week's pending + confirmed bookings.
    // Pending bookings appear in their requested slot so the producer can
    // see — at a glance — whether incoming requests overlap existing work.
    const weekStart = startOfWeek(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const inWeek = (d: Date) => d >= weekStart && d < weekEnd;
    scheduleSessions = [
      ...pending
        .filter((b) => inWeek(b.startsAt))
        .map<ScheduleSession>((b) => ({
          id: b.id,
          startsAt: b.startsAt.toISOString(),
          durationMin: b.durationMin,
          artistName: b.artistName,
          packageName: b.packageNameSnapshot,
          status: "pending",
        })),
      ...upcoming
        .filter((b) => inWeek(b.startsAt))
        .map<ScheduleSession>((b) => ({
          id: b.id,
          startsAt: b.startsAt.toISOString(),
          durationMin: b.durationMin,
          artistName: b.artistName,
          packageName: b.packageName,
          status: "confirmed",
        })),
    ];

    // Today card — the next confirmed session today (start time still
    // in the future). `upcoming` is already sorted by startsAt asc, so
    // the first match is the right one.
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const next = upcoming.find(
      (b) => b.startsAt > now && b.startsAt <= endOfToday,
    );
    if (next) {
      const ends = new Date(next.startsAt.getTime() + next.durationMin * 60_000);
      todayNext = {
        id: next.id,
        artistName: next.artistName,
        startsAt: next.startsAt.toISOString(),
        endsAt: ends.toISOString(),
        packageName: next.packageName,
      };
    }
  }

  let availabilityBlocks: AvailabilityBlock[] = [];
  let availabilityBlackouts: Blackout[] = [];
  let availabilitySettings: AvailabilitySettings = {
    defaultSessionMin: 60,
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
      defaultSessionMin: settings.defaultSessionMin,
      autoConfirmBookings: settings.autoConfirmBookings,
      cancellationPolicyHours: settings.cancellationPolicyHours,
    };
  }

  const headerMeta = META[active];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      {/* Drop the inner card chrome on mobile — at 360px the
          outer page padding (px-4) plus inner card padding (px-4)
          left only ~296px of usable width, which squeezed the week
          grid + meetings sidebar. From sm+ (640px) the
          card-glow border returns to mark the surface. */}
      <div className="sk-card-glow rounded-none border-0 bg-transparent p-0 sm:rounded-[var(--radius-lg)] sm:border sm:border-[rgb(var(--border-strong))] sm:bg-[rgb(var(--bg-elevated))] sm:px-6 sm:py-6">
        <header className="reveal-up mb-4">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Calendar
          </p>
          <h1
            key={`title-${active}`}
            className="reveal-up mt-1 font-display text-2xl leading-tight tracking-tight sm:text-3xl"
            style={{ fontVariationSettings: '"opsz" 36' }}
          >
            {headerMeta.title}
          </h1>
          <p
            key={`desc-${active}`}
            className="reveal-up mt-1.5 max-w-xl text-xs text-[rgb(var(--fg-secondary))]"
          >
            {headerMeta.description}
          </p>
        </header>

        <CalendarTabs active={active} />

        <div
          key={active}
          id={`calendar-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`calendar-tab-${active}`}
          className="reveal-up pt-4"
        >
          {active === "meetings" && (
            <MeetingsPanel
              pending={pendingMeetings}
              upcoming={upcomingMeetings}
              schedule={scheduleSessions}
              todayNext={todayNext}
              autoConfirm={meetingsAutoConfirm}
            />
          )}
          {active === "availability" && (
            <AvailabilitySection
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

function startOfWeek(date: Date): Date {
  // Sunday-based week — the design uses Sun-Sat columns.
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}
