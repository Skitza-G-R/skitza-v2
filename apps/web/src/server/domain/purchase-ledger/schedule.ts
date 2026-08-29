export type PaymentReminderKind =
  | "automatic_3_days_before"
  | "automatic_due"
  | "automatic_3_days_late"
  | "automatic_weekly_late";

export type PaymentReminderOccurrence = Readonly<{
  kind: PaymentReminderKind;
  scheduledFor: Date;
}>;

type WallClock = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return new Date(value);
}

function assertTimeZone(timeZone: string): void {
  if (timeZone.trim().length === 0) throw new Error("timeZone must not be empty");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw new Error("timeZone must be a valid IANA time zone");
  }
}

function wallClockAt(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
    millisecond: instant.getUTCMilliseconds(),
  };
}

function wallClockNumber(value: WallClock): number {
  return Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
    value.millisecond,
  );
}

function sameWallClock(left: WallClock, right: WallClock): boolean {
  return wallClockNumber(left) === wallClockNumber(right);
}

/**
 * Resolve a producer-local wall clock without using the host machine's local
 * timezone. Ambiguous clocks choose the earlier instant; a DST gap follows
 * Temporal's compatible behavior and advances by the size of the gap.
 */
function instantForWallClock(value: WallClock, timeZone: string): Date {
  const localNumber = wallClockNumber(value);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(localNumber + hours * 60 * 60 * 1_000);
    const rendered = wallClockAt(sample, timeZone);
    offsets.add(wallClockNumber(rendered) - sample.getTime());
  }

  const exact = [...offsets]
    .map((offset) => new Date(localNumber - offset))
    .filter((candidate) => sameWallClock(wallClockAt(candidate, timeZone), value))
    .sort((left, right) => left.getTime() - right.getTime());
  if (exact[0]) return exact[0];

  const compatible = [...offsets]
    .map((offset) => new Date(localNumber - offset))
    .map((candidate) => ({ candidate, shown: wallClockAt(candidate, timeZone) }))
    .filter(
      ({ shown }) =>
        shown.year === value.year &&
        shown.month === value.month &&
        shown.day === value.day &&
        wallClockNumber(shown) > localNumber,
    )
    .sort(
      (left, right) =>
        wallClockNumber(left.shown) - wallClockNumber(right.shown) ||
        left.candidate.getTime() - right.candidate.getTime(),
    );
  if (compatible[0]) return compatible[0].candidate;
  throw new Error("The monthly installment wall-clock date could not be resolved");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftWallClockDays(value: WallClock, days: number): WallClock {
  const shifted = new Date(
    Date.UTC(
      value.year,
      value.month - 1,
      value.day + days,
      value.hour,
      value.minute,
      value.second,
      value.millisecond,
    ),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
}

/**
 * SK-270: turn a calendar day a producer typed (`YYYY-MM-DD`) into the exact
 * instant that day begins in the producer's own time zone.
 *
 * Everything downstream reads a stored due date back through that same zone —
 * `isOverdueOnLocalDate` compares producer-local day numbers, and
 * `monthlyInstallmentDates` takes its anniversaries from the anchor's
 * producer-local wall clock. Storing the day as UTC midnight instead would
 * land on the previous producer-local day for every zone west of UTC, so an
 * import would read as overdue the moment it was entered and every monthly
 * anniversary would fall a day early.
 */
export function localCalendarDayStart(calendarDay: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDay)) {
    throw new Error("calendarDay must be a YYYY-MM-DD day");
  }
  assertTimeZone(timeZone);
  const [year, month, day] = calendarDay.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("calendarDay must be a real calendar day");
  }
  return instantForWallClock(
    { year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timeZone,
  );
}

export function monthlyInstallmentDates(
  input: Readonly<{
    firstConfirmedAt: Date;
    installmentCount: number;
    timeZone: string;
  }>,
): readonly Readonly<{ position: number; dueAt: Date }>[] {
  const anchor = validDate(input.firstConfirmedAt, "firstConfirmedAt");
  if (!Number.isSafeInteger(input.installmentCount) || input.installmentCount < 1) {
    throw new Error("installmentCount must be a positive integer");
  }
  assertTimeZone(input.timeZone);
  const local = wallClockAt(anchor, input.timeZone);

  return Object.freeze(
    Array.from({ length: input.installmentCount - 1 }, (_, index) => {
      const position = index + 2;
      const absoluteMonth = local.year * 12 + local.month - 1 + position - 1;
      const year = Math.floor(absoluteMonth / 12);
      const month = (absoluteMonth % 12) + 1;
      const dueAt = instantForWallClock(
        { ...local, year, month, day: Math.min(local.day, daysInMonth(year, month)) },
        input.timeZone,
      );
      return Object.freeze({ position, dueAt });
    }),
  );
}

export function paymentReminderOccurrences(
  dueAtValue: Date,
  throughValue: Date,
  timeZone: string,
): readonly PaymentReminderOccurrence[] {
  const dueAt = validDate(dueAtValue, "dueAt");
  const through = validDate(throughValue, "through");
  assertTimeZone(timeZone);
  const dueWallClock = wallClockAt(dueAt, timeZone);
  const atDayOffset = (days: number) =>
    instantForWallClock(shiftWallClockDays(dueWallClock, days), timeZone);
  const rows: PaymentReminderOccurrence[] = [
    { kind: "automatic_3_days_before", scheduledFor: atDayOffset(-3) },
    { kind: "automatic_due", scheduledFor: new Date(dueAt) },
    { kind: "automatic_3_days_late", scheduledFor: atDayOffset(3) },
  ];
  for (let daysLate = 10; ; daysLate += 7) {
    const scheduledFor = atDayOffset(daysLate);
    if (scheduledFor.getTime() > through.getTime()) break;
    rows.push({
      kind: "automatic_weekly_late",
      scheduledFor,
    });
  }
  return Object.freeze(
    rows
      .filter((row) => row.scheduledFor.getTime() <= through.getTime())
      .map((row) => Object.freeze(row)),
  );
}

function localDateNumber(value: Date, timeZone: string): number {
  const local = wallClockAt(value, timeZone);
  return local.year * 10_000 + local.month * 100 + local.day;
}

export function isOverdueOnLocalDate(dueAtValue: Date, asOfValue: Date, timeZone: string): boolean {
  const dueAt = validDate(dueAtValue, "dueAt");
  const asOf = validDate(asOfValue, "asOf");
  assertTimeZone(timeZone);
  return localDateNumber(asOf, timeZone) > localDateNumber(dueAt, timeZone);
}
