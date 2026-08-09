export const GOOGLE_CALENDAR_ACCESS_ROLES = [
  "owner",
  "writer",
  "writer_without_private_access",
  "reader",
  "free_busy_reader",
] as const;

export type GoogleCalendarAccessRole = (typeof GOOGLE_CALENDAR_ACCESS_ROLES)[number];

/**
 * Browser-safe calendar metadata. `selectionKey` is an opaque Skitza handle,
 * never a provider calendar identifier.
 */
export type GoogleCalendarOption = Readonly<{
  selectionKey: string;
  name: string;
  timeZone: string;
  accessRole: GoogleCalendarAccessRole;
  primary: boolean;
}>;

export type GoogleCalendarSelection = Readonly<{
  destinationSelectionKey: string | null;
  busySelectionKeys: readonly string[];
}>;

export type GoogleCalendarSyncSummary = Readonly<{
  syncing: number;
  notSynced: number;
  missing: number;
  conflicts: number;
}>;

type GoogleCalendarSelectionState = Readonly<{
  accountLabel: string;
  calendars: readonly GoogleCalendarOption[];
  selection: GoogleCalendarSelection;
  syncSummary: GoogleCalendarSyncSummary;
}>;

type GoogleCalendarConfiguredState = Readonly<{
  accountLabel: string;
  calendars: readonly GoogleCalendarOption[];
  syncSummary: GoogleCalendarSyncSummary;
  selection: Readonly<{
    destinationSelectionKey: string;
    busySelectionKeys: readonly string[];
  }>;
}>;

/**
 * Plain, presentation-only state passed from the server-owned integration.
 * It intentionally cannot carry credentials, provider payloads, or event data.
 */
export type GoogleCalendarUiModel =
  | Readonly<{ status: "not_connected" }>
  | Readonly<{ status: "connecting" }>
  | Readonly<{
      status: "disconnected";
      accountLabel: string;
      syncSummary: GoogleCalendarSyncSummary;
    }>
  | (Readonly<{ status: "selection_required" }> & GoogleCalendarSelectionState)
  | (Readonly<{ status: "connected" }> & GoogleCalendarConfiguredState)
  | Readonly<{
      status: "reconnect_required";
      accountLabel: string;
      syncSummary: GoogleCalendarSyncSummary;
      calendars?: readonly GoogleCalendarOption[];
      selection?: GoogleCalendarSelection;
    }>;

export type GoogleCalendarActionFailureReason =
  | "offline"
  | "permission_required"
  | "invalid_selection"
  | "unavailable";

export type GoogleCalendarActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: GoogleCalendarActionFailureReason }>;

/** Server actions are injected so the UI stays testable and provider-agnostic. */
export type GoogleCalendarControlActions = Readonly<{
  connect: () => Promise<GoogleCalendarActionResult>;
  refreshCalendars: () => Promise<GoogleCalendarActionResult>;
  saveSelection: (selection: GoogleCalendarSelection) => Promise<GoogleCalendarActionResult>;
  reconnect: () => Promise<GoogleCalendarActionResult>;
  confirmAccountSwitch: () => Promise<GoogleCalendarActionResult>;
  disconnect: () => Promise<GoogleCalendarActionResult>;
}>;

export function canUseAsGoogleCalendarDestination(role: GoogleCalendarAccessRole): boolean {
  return role === "owner" || role === "writer";
}

export function googleCalendarAccessRoleLabel(role: GoogleCalendarAccessRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "writer":
      return "Writer";
    case "writer_without_private_access":
      return "Writer (limited)";
    case "reader":
      return "Reader";
    case "free_busy_reader":
      return "Free/busy reader";
  }
}

export function findGoogleCalendarOption(
  calendars: readonly GoogleCalendarOption[],
  selectionKey: string | null,
): GoogleCalendarOption | null {
  if (!selectionKey) return null;
  return calendars.find((calendar) => calendar.selectionKey === selectionKey) ?? null;
}

export function isGoogleBusyProtectionReduced(model: GoogleCalendarUiModel): boolean {
  return model.status !== "not_connected" && model.status !== "connected";
}
