export type GoogleCalendarBusyInterval = Readonly<{
  startsAt: Date;
  endsAt: Date;
}>;

const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export class GoogleCalendarBusyIntervalError extends Error {
  constructor() {
    super("Invalid Google Calendar busy interval");
    this.name = "GoogleCalendarBusyIntervalError";
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function parseRfc3339Instant(value: unknown): number {
  if (typeof value !== "string") throw new GoogleCalendarBusyIntervalError();
  const match = RFC3339_INSTANT.exec(value);
  if (!match) throw new GoogleCalendarBusyIntervalError();
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new GoogleCalendarBusyIntervalError();
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new GoogleCalendarBusyIntervalError();
  return instant;
}

function validWindow(timeMin: Date, timeMax: Date): Readonly<{ min: number; max: number }> {
  const min = timeMin.getTime();
  const max = timeMax.getTime();
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    throw new GoogleCalendarBusyIntervalError();
  }
  return { min, max };
}

/**
 * Converts Google's RFC3339 FreeBusy values to UTC instants. Intervals remain
 * half-open: the start is busy and the end is free. Values are clipped to the
 * requested window, sorted, and merged without retaining event information.
 */
export function normalizeGoogleCalendarBusyIntervals(
  input: Readonly<{
    intervals: readonly unknown[];
    timeMin: Date;
    timeMax: Date;
  }>,
): readonly GoogleCalendarBusyInterval[] {
  const { min, max } = validWindow(input.timeMin, input.timeMax);
  const normalized: GoogleCalendarBusyInterval[] = [];
  for (const interval of input.intervals) {
    if (interval === null || typeof interval !== "object" || Array.isArray(interval)) {
      throw new GoogleCalendarBusyIntervalError();
    }
    const value = interval as Record<string, unknown>;
    const rawStart = parseRfc3339Instant(value.start);
    const rawEnd = parseRfc3339Instant(value.end);
    if (rawStart >= rawEnd) throw new GoogleCalendarBusyIntervalError();
    const start = Math.max(rawStart, min);
    const end = Math.min(rawEnd, max);
    if (start >= end) continue;
    normalized.push({ startsAt: new Date(start), endsAt: new Date(end) });
  }

  normalized.sort(
    (left, right) =>
      left.startsAt.getTime() - right.startsAt.getTime() ||
      left.endsAt.getTime() - right.endsAt.getTime(),
  );
  const merged: GoogleCalendarBusyInterval[] = [];
  for (const interval of normalized) {
    const previous = merged.at(-1);
    if (!previous || interval.startsAt.getTime() > previous.endsAt.getTime()) {
      merged.push(interval);
      continue;
    }
    if (interval.endsAt.getTime() > previous.endsAt.getTime()) {
      merged[merged.length - 1] = {
        startsAt: previous.startsAt,
        endsAt: interval.endsAt,
      };
    }
  }
  return merged;
}
