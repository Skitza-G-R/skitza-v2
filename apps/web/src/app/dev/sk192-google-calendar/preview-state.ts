export const SK192_GOOGLE_CALENDAR_PREVIEW_STATES = [
  "not-connected",
  "connecting",
  "selection",
  "empty-selection",
  "connected",
  "disconnected",
  "reconnect",
  "switch",
  "disconnect",
] as const;

export type Sk192GoogleCalendarPreviewState = (typeof SK192_GOOGLE_CALENDAR_PREVIEW_STATES)[number];

export function resolveSk192GoogleCalendarPreviewState(
  value: string | undefined,
): Sk192GoogleCalendarPreviewState {
  return SK192_GOOGLE_CALENDAR_PREVIEW_STATES.find((state) => state === value) ?? "not-connected";
}
