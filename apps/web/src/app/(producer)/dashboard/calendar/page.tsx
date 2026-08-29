import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";
import { isGoogleCalendarServerConfigured } from "~/server/google-calendar/config";
import { GOOGLE_CALENDAR_SYNC_STATUS_BATCH_LIMIT } from "~/server/domain/session-booking/service";

import { AvailabilityPanel } from "./availability-panel";
import { GoogleCalendarControlBoundary } from "./google-calendar-control-boundary";
import type { GoogleCalendarCallbackStatus } from "./google-calendar-control-boundary";
import { presentGoogleCalendar } from "./google-calendar-presentation";
import { isGoogleBusyProtectionReduced } from "./google-calendar-ui-model";

import { CalendarSwipeSurface } from "./calendar-swipe-surface";
import { resolveCalendarTabForBooking } from "./calendar-tab-key";
import { normalizeCalendarTimeZone } from "./calendar-time";
import type { ScheduleAvailabilityBlock } from "./schedule-hours";
import { buildWeek, weekEyebrow } from "./calendar-week";
import { SchedulePanel } from "./schedule-panel";
import type { ScheduleSession } from "./schedule-week-grid";
import { SchedulePendingCard, type PendingRequest } from "./schedule-pending-card";
import { SessionsPanel } from "./sessions-panel";
import type { SessionListItem } from "./session-row";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    booking?: string | string[];
    google?: string | string[];
  }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolved = await searchParams;
  const selectedBookingId = Array.isArray(resolved.booking)
    ? (resolved.booking[0] ?? null)
    : (resolved.booking ?? null);
  const googleCallbackStatus = presentGoogleCallbackStatus(
    Array.isArray(resolved.google) ? resolved.google[0] : resolved.google,
  );

  const caller = appRouter.createCaller({ userId });
  // A retained booking notification may be opened after its request was
  // approved, rejected, cancelled, or completed. Resolve against the current
  // tenant-scoped row so the bare ?booking= link chooses a surface that can
  // actually select it. Reuse the list below if Sessions is selected.
  const selectedBookingRows = selectedBookingId ? await caller.booking.list() : null;
  const selectedBooking =
    selectedBookingRows?.find((booking) => booking.id === selectedBookingId) ?? null;
  const selectedBookingIsPending = selectedBooking?.status === "pending_approval";
  const active = resolveCalendarTabForBooking(resolved.tab, selectedBooking?.status ?? null);

  // Calendar swipes are an in-place interaction, so both mobile destinations
  // must already be available under the finger. Keep the existing reads but
  // start their union together; the active route still chooses which panel is
  // exposed to assistive technology and which deep-link is recorded.
  const googleCalendarStatus = isGoogleCalendarServerConfigured()
    ? caller.googleCalendar.status().catch(() => null)
    : Promise.resolve(null);
  const [list, upcoming, settings, workingHours, profile, blackouts, manualOptions, googleStatus] =
    await Promise.all([
      selectedBookingRows ?? caller.booking.list(),
      caller.booking.upcoming({ days: 21 }),
      caller.booking.availability.getSettings(),
      caller.booking.availability.list(),
      caller.producer.me(),
      caller.booking.blackouts.list(),
      caller.booking.manual.options(),
      googleCalendarStatus,
    ]);
  const googleCalendarModel = googleStatus ? presentGoogleCalendar(googleStatus) : null;
  const googleCalendarSyncBookingIds = list
    .filter((booking) => booking.status === "confirmed")
    .map((booking) => booking.id)
    .slice(0, GOOGLE_CALENDAR_SYNC_STATUS_BATCH_LIMIT);
  const googleCalendarSyncStatuses =
    googleCalendarModel &&
    googleCalendarModel.status !== "not_connected" &&
    googleCalendarSyncBookingIds.length > 0
      ? await caller.booking.googleCalendarSync
          .status({ ids: googleCalendarSyncBookingIds })
          .catch(() => [])
      : [];
  const googleCalendarSyncByBookingId = new Map<
    string,
    NonNullable<SessionListItem["calendarSync"]>
  >(googleCalendarSyncStatuses.map((entry) => [entry.bookingId, { state: entry.status }] as const));
  const listById = new Map(list.map((booking) => [booking.id, booking]));
  const pending = list.filter((b) => b.status === "pending_approval");
  const scheduleAutoConfirm = settings.autoConfirmBookings;
  const calendarTimeZone = normalizeCalendarTimeZone(profile.timezone);
  const scheduleAvailabilityBlocks: ScheduleAvailabilityBlock[] = workingHours.map((block) => ({
    weekday: block.weekday,
    startMin: block.startMin,
    endMin: block.endMin,
  }));
  const pendingRequests: PendingRequest[] = pending.map((b) => ({
    id: b.id,
    artistName: b.artistName,
    artistEmail: b.artistEmail,
    startsAt: b.startsAt.toISOString(),
    durationMin: b.durationMin,
    packageName: b.projectName,
    message: b.notes,
    receivedAtIso: b.createdAt.toISOString(),
  }));
  const mobilePendingRequests: PendingRequest[] = pending.map((b) => ({
    id: b.id,
    artistName: b.artistName,
    artistEmail: b.artistEmail,
    startsAt: b.startsAt.toISOString(),
    durationMin: b.durationMin,
    packageName: b.projectName,
    message: b.notes,
    receivedAtIso: b.createdAt.toISOString(),
  }));
  // SK-280: feed the week grid from the full list, not the 21-day upcoming
  // window — otherwise "Previous week" was always empty, in-progress sessions
  // vanished at their start instant, and navigating 3+ weeks ahead went blank.
  const scheduleSessions: ScheduleSession[] = [
    ...pending.map<ScheduleSession>((b) => ({
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      durationMin: b.durationMin,
      artistName: b.artistName,
      artistEmail: b.artistEmail,
      packageName: b.projectName,
      status: "pending_approval",
    })),
    ...list
      .filter((b) => b.status === "confirmed")
      .map<ScheduleSession>((b) => ({
        id: b.id,
        startsAt: b.startsAt.toISOString(),
        durationMin: b.durationMin,
        artistName: b.artistName,
        artistEmail: b.artistEmail,
        packageName: b.projectName,
        status: "confirmed",
      })),
  ];
  // SK-56 — sessions-first mobile view for the schedule tab (the week
  // grid is desktop-only). Pending + the 21-day upcoming window mapped
  // into the SessionsPanel's row shape.
  const scheduleMobileSessions: SessionListItem[] = [
    ...pending.map<SessionListItem>((b) => ({
      id: b.id,
      artistName: b.artistName,
      artistEmail: b.artistEmail,
      startsAt: b.startsAt.toISOString(),
      durationMin: b.durationMin,
      title: b.title ?? b.packageNameSnapshot,
      packageName: b.projectName,
      status: "pending_approval",
      billingTreatment: b.billingTreatment,
      artistRsvpStatus: b.artistRsvpStatus,
      calendarSync: googleCalendarSyncByBookingId.get(b.id) ?? null,
      changeRequest: presentChangeRequest(b.changeRequest),
    })),
    ...upcoming.map<SessionListItem>((b) => {
      const full = listById.get(b.id);
      return {
        id: b.id,
        artistName: b.artistName,
        artistEmail: b.artistEmail,
        startsAt: b.startsAt.toISOString(),
        durationMin: b.durationMin,
        title: full?.title ?? full?.packageNameSnapshot ?? b.packageName,
        packageName: b.projectName,
        status: "confirmed",
        billingTreatment: full?.billingTreatment ?? "included",
        artistRsvpStatus: full?.artistRsvpStatus ?? null,
        calendarSync: googleCalendarSyncByBookingId.get(b.id) ?? null,
        changeRequest: presentChangeRequest(full?.changeRequest ?? null),
      };
    }),
  ];
  const allSessions: SessionListItem[] = list.map((b) => ({
    id: b.id,
    artistName: b.artistName,
    artistEmail: b.artistEmail,
    startsAt: b.startsAt.toISOString(),
    durationMin: b.durationMin,
    title: b.title ?? b.packageNameSnapshot,
    packageName: b.projectName,
    kindSource: b.title ?? b.packageNameSnapshot,
    status: b.status,
    billingTreatment: b.billingTreatment,
    artistRsvpStatus: b.artistRsvpStatus,
    calendarSync: googleCalendarSyncByBookingId.get(b.id) ?? null,
    changeRequest: presentChangeRequest(b.changeRequest),
  }));
  const mobileAllSessions: SessionListItem[] = list.map((b) => ({
    id: b.id,
    artistName: b.artistName,
    artistEmail: b.artistEmail,
    startsAt: b.startsAt.toISOString(),
    durationMin: b.durationMin,
    title: b.title ?? b.packageNameSnapshot,
    packageName: b.projectName,
    status: b.status,
    billingTreatment: b.billingTreatment,
    artistRsvpStatus: b.artistRsvpStatus,
    calendarSync: googleCalendarSyncByBookingId.get(b.id) ?? null,
    changeRequest: presentChangeRequest(b.changeRequest),
  }));
  const initialNow = new Date();
  const availabilityBlocks = workingHours.map((block) => ({
    weekday: block.weekday,
    startMin: block.startMin,
    endMin: block.endMin,
  }));
  const availabilityBlackouts: {
    id: string;
    startDate: string;
    endDate: string;
    reason: string | null;
  }[] = blackouts.map((blackout) => ({
    id: blackout.id,
    startDate: blackout.startDate,
    endDate: blackout.endDate,
    reason: blackout.reason,
  }));
  const availabilitySettings = {
    autoConfirmBookings: settings.autoConfirmBookings,
    cancellationPolicyHours: settings.cancellationPolicyHours,
    maxSessionsPerDay: settings.maxSessionsPerDay,
  };
  // Week-start preference (DB-backed since the Settings redesign). The
  // panel renders a Sunday/Monday toggle that writes back to the same
  // column, so the value here drives both the initial render and the
  // post-toggle persisted state.
  const availabilityWeekStart: "sunday" | "monday" =
    profile.weekStart === "monday" ? "monday" : "sunday";
  // Tab-aware eyebrow — gives the section dynamic context. Schedule
  // shows the current week date; Sessions shows totals; Availability
  // shows weekly hours open. The eyebrow stays static across client-
  // side week navigation — the WeekNav inside SchedulePanel surfaces
  // the navigated week's range readout instead.
  const scheduleWeek = buildWeek(initialNow, 0, calendarTimeZone);
  const scheduleEyebrow = weekEyebrow(scheduleWeek[0] ?? initialNow);
  const totalSessions = allSessions.length;
  const upcomingCount = allSessions.filter((session) => {
    const start = new Date(session.startsAt);
    const endMs = start.getTime() + session.durationMin * 60_000;
    const isCancelled =
      session.status === "cancelled" ||
      session.status === "rejected" ||
      session.status === "completed" ||
      session.status === "no_show";
    return !isCancelled && endMs > initialNow.getTime();
  }).length;
  const sessionsEyebrow =
    totalSessions === 0
      ? "NO SESSIONS YET"
      : `${String(totalSessions)} SESSION${totalSessions === 1 ? "" : "S"} · ${String(upcomingCount)} UPCOMING`;
  const totalAvailabilityMin = availabilityBlocks.reduce(
    (acc, block) => acc + (block.endMin - block.startMin),
    0,
  );
  const availabilityHours = Math.round((totalAvailabilityMin / 60) * 10) / 10;
  const availabilityHoursLabel = Number.isInteger(availabilityHours)
    ? String(availabilityHours)
    : availabilityHours.toFixed(1).replace(/\.0$/, "");
  const availabilityEyebrow =
    availabilityHours === 0 ? "AVAILABILITY NOT SET" : `${availabilityHoursLabel}H OPEN PER WEEK`;
  const eyebrows = {
    schedule: scheduleEyebrow,
    sessions: sessionsEyebrow,
    availability: availabilityEyebrow,
  };

  return (
    // lg+: viewport-locked layout — the page is sized to exactly the
    // visible viewport below the 64px producer topbar and every
    // descendant is flex-locked, so the page itself never scrolls.
    // <lg: natural page scroll — phones get a normal scrolling column
    // (AppShell's `pb-20` already reserves the bottom-nav space), and
    // the Schedule grid falls back to its intrinsic 44px hour rows.
    // AppShell now keeps the opaque topbar in normal flow, so no legacy
    // 40px compensation margin is needed. The Schedule grid measures its
    // own height via ResizeObserver and sets `--hour-px` from that.
    <div className="mx-auto flex max-w-[1180px] flex-col px-4 py-2 sm:py-3 lg:h-[calc(100dvh-64px)] lg:py-4">
      {/* sm+ surfaces an elevated card; mobile drops the chrome to
          maximise usable width. */}
      <div className="flex min-h-0 flex-1 flex-col rounded-none border-0 bg-transparent p-0 sm:rounded-[var(--radius-2xl)] sm:border sm:border-[rgb(var(--border-strong))] sm:bg-[rgb(var(--bg-elevated))] sm:px-4 sm:py-3 lg:px-5 lg:py-4">
        <CalendarSwipeSurface
          active={active}
          eyebrows={eyebrows}
          scheduleEyebrow={scheduleEyebrow}
          manualOptions={manualOptions}
          googleBusyProtectionReduced={
            googleCalendarModel ? isGoogleBusyProtectionReduced(googleCalendarModel) : false
          }
          googleCalendarControl={
            googleCalendarModel ? (
              <GoogleCalendarControlBoundary
                model={googleCalendarModel}
                timeZone={calendarTimeZone}
                {...(googleCallbackStatus ? { callbackStatus: googleCallbackStatus } : {})}
              />
            ) : undefined
          }
          sessionsContent={
            active === "schedule" ? (
              <>
                {/* Desktop keeps the full week-grid schedule. */}
                <div className="hidden min-h-0 flex-1 flex-col lg:flex">
                  <SchedulePanel
                    sessions={scheduleSessions}
                    desktopSessions={allSessions}
                    availabilityBlocks={scheduleAvailabilityBlocks}
                    pending={pendingRequests}
                    autoConfirm={scheduleAutoConfirm}
                    initialNow={initialNow.toISOString()}
                    timeZone={calendarTimeZone}
                    selectedBookingId={selectedBookingIsPending ? selectedBookingId : null}
                  />
                </div>
                {/* SK-56 — phones never show the week grid. Direct hits
                  on ?tab=schedule (or the bare URL) render the same
                  sessions-first view the mobile Sessions tab owns:
                  pending requests on top, then the sessions list
                  (pending + the 21-day upcoming window). */}
                <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
                  <div className="shrink-0">
                    <SchedulePendingCard
                      initial={mobilePendingRequests}
                      autoConfirm={scheduleAutoConfirm}
                      initialNow={initialNow.toISOString()}
                      timeZone={calendarTimeZone}
                      selectedBookingId={selectedBookingIsPending ? selectedBookingId : null}
                    />
                  </div>
                  <SessionsPanel
                    sessions={scheduleMobileSessions}
                    initialNow={initialNow.toISOString()}
                    timeZone={calendarTimeZone}
                    selectedBookingId={selectedBookingIsPending ? null : selectedBookingId}
                  />
                </div>
              </>
            ) : (
              <>
                {/* SK-85 — desktop folds Sessions into the schedule rail.
                  The retained ?tab=sessions URL remains the mobile
                  entry point and renders the existing list below lg. */}
                <div className="hidden min-h-0 flex-1 flex-col lg:flex">
                  <SchedulePanel
                    sessions={scheduleSessions}
                    desktopSessions={allSessions}
                    availabilityBlocks={scheduleAvailabilityBlocks}
                    pending={pendingRequests}
                    autoConfirm={scheduleAutoConfirm}
                    initialNow={initialNow.toISOString()}
                    timeZone={calendarTimeZone}
                    selectedBookingId={selectedBookingId}
                  />
                </div>
                {/* SK-56 — pending requests live here on phones (the
                  Schedule tab that used to own them is desktop-only). */}
                <div className="flex min-h-0 flex-1 flex-col lg:hidden">
                  <div className="shrink-0 pb-3">
                    <SchedulePendingCard
                      initial={mobilePendingRequests}
                      autoConfirm={scheduleAutoConfirm}
                      initialNow={initialNow.toISOString()}
                      timeZone={calendarTimeZone}
                      selectedBookingId={selectedBookingIsPending ? selectedBookingId : null}
                    />
                  </div>
                  <SessionsPanel
                    sessions={mobileAllSessions}
                    initialNow={initialNow.toISOString()}
                    timeZone={calendarTimeZone}
                    selectedBookingId={selectedBookingIsPending ? null : selectedBookingId}
                  />
                </div>
              </>
            )
          }
          availabilityContent={
            <AvailabilityPanel
              blocks={availabilityBlocks}
              blackouts={availabilityBlackouts}
              settings={availabilitySettings}
              initialWeekStart={availabilityWeekStart}
              timeZone={calendarTimeZone}
              initialNow={initialNow.toISOString()}
            />
          }
        />
      </div>
    </div>
  );
}

function presentGoogleCallbackStatus(
  value: string | undefined,
): GoogleCalendarCallbackStatus | undefined {
  if (
    value === "selection" ||
    value === "connected" ||
    value === "denied" ||
    value === "wrong-account" ||
    value === "reconnect" ||
    value === "error"
  ) {
    return value;
  }
  return undefined;
}

type PresentedChangeRequest = NonNullable<SessionListItem["changeRequest"]>;

function presentChangeRequest(
  request: {
    id: string;
    kind: "cancel" | "reschedule";
    proposedStartsAt: Date | null;
    requestedAt: Date;
  } | null,
): PresentedChangeRequest | null {
  if (!request) return null;
  return {
    id: request.id,
    kind: request.kind,
    proposedStartsAt: request.proposedStartsAt?.toISOString() ?? null,
    requestedAt: request.requestedAt.toISOString(),
  };
}
