import { SessionBookingDomainError } from "./errors";

type WallClock = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}>;

export function zonedWallClockAt(instant: Date, timeZone: string): WallClock {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
  } catch {
    throw new SessionBookingDomainError("INVALID_SLOT", "The studio timezone is invalid");
  }

  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      formatter
        .formatToParts(instant)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
  } catch {
    throw new SessionBookingDomainError("INVALID_SLOT", "The session time is invalid");
  }

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday ?? ""] ?? -1,
  };
}

export function wallClockDateKey(wall: Pick<WallClock, "year" | "month" | "day">): string {
  return `${String(wall.year).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

export function studioLocalDateTimeUtcCandidates(input: {
  date: string;
  startMin: number;
  timeZone: string;
}): Date[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  if (
    !match ||
    !Number.isSafeInteger(input.startMin) ||
    input.startMin < 0 ||
    input.startMin > 1439
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The session date or time is invalid");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (
    validation.getUTCFullYear() !== year ||
    validation.getUTCMonth() !== month - 1 ||
    validation.getUTCDate() !== day
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The session date is invalid");
  }
  const hour = Math.floor(input.startMin / 60);
  const minute = input.startMin % 60;
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  for (const deltaHours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = new Date(wallUtc + deltaHours * 60 * 60 * 1000);
    const wall = zonedWallClockAt(sample, input.timeZone);
    offsets.add(
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - sample.getTime(),
    );
  }
  return [...offsets]
    .map((offset) => new Date(wallUtc - offset))
    .filter((candidate) => {
      const wall = zonedWallClockAt(candidate, input.timeZone);
      return (
        wall.year === year &&
        wall.month === month &&
        wall.day === day &&
        wall.hour === hour &&
        wall.minute === minute
      );
    })
    .sort((left, right) => left.getTime() - right.getTime());
}

export function studioLocalDateTimeToUtc(input: {
  date: string;
  startMin: number;
  timeZone: string;
}): Date {
  const earliest = studioLocalDateTimeUtcCandidates(input)[0];
  if (!earliest) {
    throw new SessionBookingDomainError(
      "INVALID_SLOT",
      "That studio-local time does not exist because of a daylight-saving change",
    );
  }
  return earliest;
}

export function zonedLocalDateKey(instant: Date, timeZone: string): string {
  return wallClockDateKey(zonedWallClockAt(instant, timeZone));
}

export const studioLocalDateKey = zonedLocalDateKey;

export const sessionStartFromLocalSlot = (input: {
  date: string;
  startMin: number;
  producerTimeZone: string;
}): Date =>
  studioLocalDateTimeToUtc({
    date: input.date,
    startMin: input.startMin,
    timeZone: input.producerTimeZone,
  });

export const producerLocalDateKey = zonedLocalDateKey;

export function producerLocalDateKeys(startDate: string, count: number): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match || !Number.isSafeInteger(count) || count < 0 || count > 14 + 365) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The studio calendar range is invalid");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  if (
    anchor.getUTCFullYear() !== year ||
    anchor.getUTCMonth() !== month - 1 ||
    anchor.getUTCDate() !== day
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The studio calendar date is invalid");
  }
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, day + index));
    return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  });
}

export function producerLocalDateRange(
  now: Date,
  producerTimeZone: string,
  count: number,
): string[] {
  return producerLocalDateKeys(producerLocalDateKey(now, producerTimeZone), count);
}

export function sessionAvailabilityHorizonDays(minLeadHours: number, baseDays = 14): number {
  if (
    !Number.isSafeInteger(minLeadHours) ||
    minLeadHours < 0 ||
    minLeadHours > 365 * 24 ||
    !Number.isSafeInteger(baseDays) ||
    baseDays <= 0
  ) {
    throw new SessionBookingDomainError(
      "INVALID_ALLOWANCE",
      "The purchased session lead time is invalid",
    );
  }
  const horizonDays = baseDays + Math.ceil(minLeadHours / 24);
  if (horizonDays > 14 + 365) {
    throw new SessionBookingDomainError(
      "INVALID_ALLOWANCE",
      "The purchased session lead time exceeds the calendar horizon",
    );
  }
  return horizonDays;
}

export function minimumLeadTimeSatisfied(input: {
  startsAt: Date;
  now: Date;
  minLeadHours: number;
}): boolean {
  if (
    Number.isNaN(input.startsAt.getTime()) ||
    Number.isNaN(input.now.getTime()) ||
    !Number.isSafeInteger(input.minLeadHours) ||
    input.minLeadHours < 0 ||
    input.minLeadHours > 365 * 24
  ) {
    throw new SessionBookingDomainError("INVALID_ALLOWANCE", "The session lead time is invalid");
  }
  return input.startsAt.getTime() >= input.now.getTime() + input.minLeadHours * 60 * 60 * 1000;
}
