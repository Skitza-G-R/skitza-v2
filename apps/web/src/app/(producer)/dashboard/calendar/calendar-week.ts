// Week math for the Producer Calendar / Schedule tab.
//
// Centralised here so the schedule grid, today-card, and pending-card
// all derive their week boundaries from a single source of truth.
// Without this, each component re-derives the week from `new Date()`
// and a DST transition or a stale render could put them out of sync.
//
// Calendar days are stored as UTC date markers. Session instants are
// compared against those markers in the producer's saved timezone, so
// server and browser timezone differences cannot move a session.

import { calendarDateTimeParts } from "./calendar-time";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function buildWeek(
  reference: Date,
  weekOffset = 0,
  timeZone = "UTC",
): Date[] {
  const { year, month, day } = calendarDateTimeParts(reference, timeZone);
  const referenceMarker = new Date(Date.UTC(year, month - 1, day));
  const sundayMs =
    referenceMarker.getTime() -
    referenceMarker.getUTCDay() * DAY_MS +
    weekOffset * 7 * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => new Date(sundayMs + i * DAY_MS));
}

export function isSameDay(
  dayMarker: Date,
  instant: Date,
  timeZone = "UTC",
): boolean {
  const parts = calendarDateTimeParts(instant, timeZone);
  return (
    dayMarker.getUTCFullYear() === parts.year &&
    dayMarker.getUTCMonth() + 1 === parts.month &&
    dayMarker.getUTCDate() === parts.day
  );
}

export function todayIndex(
  week: readonly Date[],
  now: Date,
  timeZone = "UTC",
): number {
  return week.findIndex((day) => isSameDay(day, now, timeZone));
}

// Spec § 4.1: range readout, e.g. "May 3 – 9, 2026" or
// "Apr 26 – May 2, 2026" when the week spans a month boundary.
export function weekRangeLabel(week: readonly Date[]): string {
  const first = week[0];
  const last = week[6];
  if (!first || !last) return "";
  const monthFmt = (date: Date) => MONTHS_SHORT[date.getUTCMonth()] ?? "Jan";
  const sameMonth = first.getUTCMonth() === last.getUTCMonth();
  const left = `${monthFmt(first)} ${String(first.getUTCDate())}`;
  const right = sameMonth
    ? `${String(last.getUTCDate())}, ${String(last.getUTCFullYear())}`
    : `${monthFmt(last)} ${String(last.getUTCDate())}, ${String(last.getUTCFullYear())}`;
  return `${left} – ${right}`;
}

// Spec § 3 eyebrow: "WEEK OF MAY 3, 2026". Always derived off the
// Sunday start so navigation arrows update it in one step.
export function weekEyebrow(weekStart: Date): string {
  const month = (MONTHS_LONG[weekStart.getUTCMonth()] ?? "January").toUpperCase();
  return `WEEK OF ${month} ${String(weekStart.getUTCDate())}, ${String(weekStart.getUTCFullYear())}`;
}
