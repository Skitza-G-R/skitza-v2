export type GoogleCalendarSessionSyncState =
  | "synced"
  | "pending"
  | "not_synced"
  | "missing"
  | "conflict"
  | "disconnected";

export type GoogleCalendarSessionSync = Readonly<{
  state: GoogleCalendarSessionSyncState;
}>;
