import type {
  GoogleCalendarConnectionSnapshot,
  GoogleCalendarPublicCandidate,
} from "~/server/google-calendar/service";

import {
  canUseAsGoogleCalendarDestination,
  type GoogleCalendarAccessRole,
  type GoogleCalendarOption,
  type GoogleCalendarSelection,
  type GoogleCalendarSyncSummary,
  type GoogleCalendarUiModel,
} from "./google-calendar-ui-model";

function accessRole(role: GoogleCalendarPublicCandidate["accessRole"]): GoogleCalendarAccessRole {
  switch (role) {
    case "freeBusyReader":
      return "free_busy_reader";
    case "writerWithoutPrivateAccess":
      return "writer_without_private_access";
    case "reader":
    case "writer":
    case "owner":
      return role;
  }
}

function calendarOption(calendar: GoogleCalendarPublicCandidate): GoogleCalendarOption {
  return {
    selectionKey: calendar.id,
    name: calendar.displayName,
    timeZone: calendar.timezone ?? "Timezone unavailable",
    accessRole: accessRole(calendar.accessRole),
    primary: calendar.isPrimary,
  };
}

function syncSummary(
  summary: Extract<GoogleCalendarConnectionSnapshot, { syncSummary: unknown }>["syncSummary"],
): GoogleCalendarSyncSummary {
  return {
    ...summary,
    issues: summary.issues.map(({ startsAt, syncStateChangedAt, ...issue }) => ({
      ...issue,
      startsAtIso: startsAt.toISOString(),
      stateChangedAtIso: syncStateChangedAt.toISOString(),
    })),
  };
}

function selectedCalendars(
  calendars: readonly GoogleCalendarPublicCandidate[],
  includeSuggestions: boolean,
): GoogleCalendarSelection {
  const options = calendars.map(calendarOption);
  const selectedDestination = calendars.find((calendar) => calendar.isDestination)?.id ?? null;
  const suggestedDestination =
    options.find(
      (calendar) => calendar.primary && canUseAsGoogleCalendarDestination(calendar.accessRole),
    )?.selectionKey ?? null;
  const destinationSelectionKey =
    selectedDestination ?? (includeSuggestions ? suggestedDestination : null);
  const selectedBusy = calendars
    .filter((calendar) => calendar.blocksAvailability)
    .map((calendar) => calendar.id);
  const suggestedBusy =
    options.find((calendar) => calendar.primary)?.selectionKey ?? destinationSelectionKey;
  return {
    destinationSelectionKey,
    busySelectionKeys:
      selectedBusy.length > 0
        ? selectedBusy
        : includeSuggestions && suggestedBusy
          ? [suggestedBusy]
          : [],
  };
}

export function presentGoogleCalendar(
  snapshot: GoogleCalendarConnectionSnapshot,
): GoogleCalendarUiModel {
  if (snapshot.status === "not_connected") {
    return { status: "not_connected" };
  }

  if (snapshot.status === "disconnected") {
    return {
      status: "disconnected",
      accountLabel: snapshot.accountEmail,
      syncSummary: syncSummary(snapshot.syncSummary),
    };
  }

  const calendars = snapshot.calendars.map(calendarOption);
  const selection = selectedCalendars(snapshot.calendars, snapshot.status === "needs_selection");
  if (snapshot.status === "reconnect_required") {
    return {
      status: "reconnect_required",
      accountLabel: snapshot.accountEmail,
      syncSummary: syncSummary(snapshot.syncSummary),
      ...(calendars.length > 0 ? { calendars } : {}),
      ...(selection.destinationSelectionKey || selection.busySelectionKeys.length > 0
        ? { selection }
        : {}),
    };
  }

  if (
    snapshot.status === "connected" &&
    selection.destinationSelectionKey &&
    selection.busySelectionKeys.length > 0
  ) {
    return {
      status: "connected",
      accountLabel: snapshot.accountEmail,
      calendars,
      syncSummary: syncSummary(snapshot.syncSummary),
      selection: {
        destinationSelectionKey: selection.destinationSelectionKey,
        busySelectionKeys: selection.busySelectionKeys,
      },
    };
  }

  return {
    status: "selection_required",
    accountLabel: snapshot.accountEmail,
    calendars,
    syncSummary: syncSummary(snapshot.syncSummary),
    selection,
  };
}
