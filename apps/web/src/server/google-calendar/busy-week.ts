import { producerLocalDateKeys, studioLocalDateTimeUtcCandidates } from "~/server/booking";

import type { GoogleCalendarBusyHealth, GoogleCalendarBusyResult } from "./service";

const MINUTES_PER_DAY = 24 * 60;
const MAX_WEEK_DURATION_MS = 8 * 24 * 60 * 60 * 1_000;

export type GoogleCalendarBusyWeekView = Readonly<{
  protection: "google_aware" | "skitza_only";
  health: GoogleCalendarBusyHealth;
  intervals: readonly Readonly<{
    startsAt: string;
    endsAt: string;
  }>[];
}>;

export type GoogleCalendarBusyWeekWindow = Readonly<{
  timeMin: Date;
  timeMax: Date;
}>;

/**
 * Returns the first real instant belonging to a studio-local civil date.
 * Midnight normally exists, but a few IANA zones move their clocks at
 * midnight. Scanning forward preserves an exact seven-civil-day query window
 * without assuming that every local day is 24 elapsed hours long.
 */
function firstStudioInstant(studioDate: string, timeZone: string): Date {
  for (let startMin = 0; startMin < MINUTES_PER_DAY; startMin += 1) {
    const first = studioLocalDateTimeUtcCandidates({
      date: studioDate,
      startMin,
      timeZone,
    })[0];
    if (first) return first;
  }
  throw new Error("The studio calendar date does not contain a real instant");
}

/**
 * Resolves one exact studio-local week to UTC instants. The returned window is
 * half-open and may be 167, 168, or 169 elapsed hours across a DST transition.
 */
export function googleCalendarBusyWeekWindow(
  input: Readonly<{
    weekStart: string;
    timeZone: string;
  }>,
): GoogleCalendarBusyWeekWindow {
  const dates = producerLocalDateKeys(input.weekStart, 8);
  const firstDate = dates[0];
  const nextWeekDate = dates[7];
  if (!firstDate || !nextWeekDate) {
    throw new Error("The Google Calendar week is invalid");
  }

  const timeMin = firstStudioInstant(firstDate, input.timeZone);
  const timeMax = firstStudioInstant(nextWeekDate, input.timeZone);
  const duration = timeMax.getTime() - timeMin.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_WEEK_DURATION_MS) {
    throw new Error("The Google Calendar week is invalid");
  }
  return { timeMin, timeMax };
}

/**
 * The browser receives only the union of busy instants and a coarse health
 * signal. Calendar IDs, event details, account data, and provider errors never
 * cross this boundary.
 */
export function presentGoogleCalendarBusyWeek(
  result: GoogleCalendarBusyResult,
): GoogleCalendarBusyWeekView {
  return {
    protection: result.protection,
    health: result.health,
    intervals: result.intervals.map((interval) => ({
      startsAt: interval.startsAt.toISOString(),
      endsAt: interval.endsAt.toISOString(),
    })),
  };
}
