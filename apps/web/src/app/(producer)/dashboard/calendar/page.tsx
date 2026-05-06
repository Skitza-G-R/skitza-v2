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

  let pendingMeetings: MeetingRow[] = [];
  let upcomingMeetings: MeetingRow[] = [];
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
      startsAt: b.startsAt.toISOString(),
      durationMin: b.durationMin,
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

  // Header counts mirror the design's "X upcoming · Y pending"
  // subtitle on the Meetings tab. Availability tab shows a static
  // helper sub-line per the existing META entry.
  const subtitle =
    active === "meetings"
      ? `${String(upcomingMeetings.length)} upcoming · ${String(pendingMeetings.length)} pending`
      : META[active].description;

  return (
    <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
      <header className="mb-5">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[34px]">
          Calendar
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p className="mt-1.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
          {subtitle}
        </p>
      </header>

      <CalendarTabs active={active} />

      <div
        key={active}
        id={`calendar-panel-${active}`}
        aria-labelledby={`calendar-tab-${active}`}
        className="pt-5"
      >
        {active === "meetings" && (
          <MeetingsPanel
            pending={pendingMeetings}
            upcoming={upcomingMeetings}
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
  );
}
