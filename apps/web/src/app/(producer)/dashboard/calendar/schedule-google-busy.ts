const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MINUTES_PER_DAY = 24 * 60;
const QUARTER_MINUTES = 15;
const QUARTER_MS = QUARTER_MINUTES * 60 * 1_000;
const OFFSET_SAMPLE_HOURS = [-36, -24, -12, 0, 12, 24, 36] as const;

export type ScheduleGoogleBusyHealth =
  | "healthy"
  | "not_connected"
  | "reconnect_required"
  | "unavailable";

export type ScheduleGoogleBusyProtection = "google_aware" | "skitza_only";

export type ScheduleGoogleBusyInterval = Readonly<{
  startsAt: string;
  endsAt: string;
}>;

export type ScheduleGoogleBusyWorkingBlock = Readonly<{
  weekday: number;
  startMin: number;
  endMin: number;
}>;

export type ScheduleGoogleBusyBand = Readonly<{
  key: string;
  studioDate: string;
  startMin: number;
  endMin: number;
  durationMin: number;
  /** Studio wall-clock midpoint for vertically centering the visual label. */
  centerMin: number;
  /** Partial occurs only when a repeated DST wall time has a free real instant. */
  coverage: "blocked" | "partial";
}>;

export type ScheduleGoogleBusyDayState = "available" | "closed" | "google_full" | "unknown";

export type ScheduleGoogleBusyDay = Readonly<{
  studioDate: string;
  weekday: number;
  state: ScheduleGoogleBusyDayState;
  bands: readonly ScheduleGoogleBusyBand[];
  /** Wall-clock starts touched by at least one real Google-busy instant. */
  busyStartMinutes: readonly number[];
  /** Starts for which every real DST candidate overlaps Google busy time. */
  blockedStartMinutes: readonly number[];
  /** Repeated wall-clock starts with both busy and free real candidates. */
  partialBusyStartMinutes: readonly number[];
  /** Real 15-minute starts contained in the producer's working blocks. */
  workingStartMinutes: readonly number[];
}>;

export type ScheduleGoogleBusyModel = Readonly<{
  weekStart: string;
  googleBusyCurrent: boolean;
  days: readonly ScheduleGoogleBusyDay[];
}>;

export type BuildScheduleGoogleBusyModelInput = Readonly<{
  weekStart: string;
  studioTimeZone: string;
  workingBlocks: readonly ScheduleGoogleBusyWorkingBlock[];
  protection: ScheduleGoogleBusyProtection;
  health: ScheduleGoogleBusyHealth;
  intervals: readonly ScheduleGoogleBusyInterval[];
  /** Inclusive studio minute rendered at the top of the grid. Defaults to 0. */
  visibleStartMin?: number;
  /** Exclusive studio minute rendered at the bottom of the grid. Defaults to 1440. */
  visibleEndMin?: number;
}>;

type CivilDate = Readonly<{ year: number; month: number; day: number }>;
type ZonedParts = CivilDate & Readonly<{ hour: number; minute: number }>;
type BusyInstant = Readonly<{ start: number; end: number }>;

function parseCivilDate(value: string): CivilDate {
  const match = DATE_KEY.exec(value);
  if (!match) throw new Error("Invalid studio date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (
    validation.getUTCFullYear() !== year ||
    validation.getUTCMonth() !== month - 1 ||
    validation.getUTCDate() !== day
  ) {
    throw new Error("Invalid studio date");
  }
  return { year, month, day };
}

function civilDateKey(date: CivilDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(
    date.day,
  ).padStart(2, "0")}`;
}

function studioDateKeys(weekStart: string): string[] {
  const start = parseCivilDate(weekStart);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + index));
    return civilDateKey({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  });
}

function createStudioFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function zonedParts(formatter: Intl.DateTimeFormat, instant: number): ZonedParts {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function possibleOffsets(studioDate: string, formatter: Intl.DateTimeFormat): readonly number[] {
  const date = parseCivilDate(studioDate);
  const wallMidnight = Date.UTC(date.year, date.month - 1, date.day);
  const offsets = new Set<number>();
  for (const deltaHours of OFFSET_SAMPLE_HOURS) {
    const sample = wallMidnight + deltaHours * 60 * 60 * 1_000;
    const wall = zonedParts(formatter, sample);
    offsets.add(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - sample);
  }
  return [...offsets];
}

function studioMinuteCandidates(
  input: Readonly<{
    studioDate: string;
    startMin: number;
    formatter: Intl.DateTimeFormat;
    offsets: readonly number[];
  }>,
): readonly number[] {
  const date = parseCivilDate(input.studioDate);
  const hour = Math.floor(input.startMin / 60);
  const minute = input.startMin % 60;
  const wallUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const candidates = new Set<number>();
  for (const offset of input.offsets) {
    const candidate = wallUtc - offset;
    const wall = zonedParts(input.formatter, candidate);
    if (
      wall.year === date.year &&
      wall.month === date.month &&
      wall.day === date.day &&
      wall.hour === hour &&
      wall.minute === minute
    ) {
      candidates.add(candidate);
    }
  }
  return [...candidates].sort((left, right) => left - right);
}

function normalizeBusyIntervals(
  intervals: readonly ScheduleGoogleBusyInterval[],
): Readonly<{ valid: boolean; intervals: readonly BusyInstant[] }> {
  const normalized: BusyInstant[] = [];
  for (const interval of intervals) {
    const start = Date.parse(interval.startsAt);
    const end = Date.parse(interval.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      return { valid: false, intervals: [] };
    }
    normalized.push({ start, end });
  }
  normalized.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: BusyInstant[] = [];
  for (const interval of normalized) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push(interval);
    } else if (interval.end > previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: interval.end };
    }
  }
  return { valid: true, intervals: merged };
}

function overlapsBusy(start: number, end: number, intervals: readonly BusyInstant[]): boolean {
  return intervals.some((interval) => start < interval.end && interval.start < end);
}

function validateVisibleRange(startMin: number, endMin: number): void {
  if (
    !Number.isSafeInteger(startMin) ||
    !Number.isSafeInteger(endMin) ||
    startMin < 0 ||
    endMin > MINUTES_PER_DAY ||
    startMin >= endMin ||
    startMin % QUARTER_MINUTES !== 0 ||
    endMin % QUARTER_MINUTES !== 0
  ) {
    throw new Error("Invalid visible calendar range");
  }
}

function validWorkingBlock(block: ScheduleGoogleBusyWorkingBlock): boolean {
  return (
    Number.isSafeInteger(block.weekday) &&
    block.weekday >= 0 &&
    block.weekday <= 6 &&
    Number.isSafeInteger(block.startMin) &&
    Number.isSafeInteger(block.endMin) &&
    block.startMin >= 0 &&
    block.endMin <= MINUTES_PER_DAY &&
    block.startMin < block.endMin
  );
}

function candidateFitsWorkingBlock(
  input: Readonly<{
    startMin: number;
    block: ScheduleGoogleBusyWorkingBlock;
  }>,
): boolean {
  return (
    input.startMin >= input.block.startMin && input.startMin + QUARTER_MINUTES <= input.block.endMin
  );
}

function mergeBands(
  studioDate: string,
  quarters: readonly Readonly<{
    startMin: number;
    coverage: ScheduleGoogleBusyBand["coverage"];
  }>[],
): readonly ScheduleGoogleBusyBand[] {
  const bands: ScheduleGoogleBusyBand[] = [];
  for (const quarter of quarters) {
    const previous = bands.at(-1);
    if (
      previous &&
      previous.endMin === quarter.startMin &&
      previous.coverage === quarter.coverage
    ) {
      const endMin = quarter.startMin + QUARTER_MINUTES;
      bands[bands.length - 1] = {
        ...previous,
        key: `${studioDate}:${String(previous.startMin)}-${String(endMin)}`,
        endMin,
        durationMin: endMin - previous.startMin,
        centerMin: (previous.startMin + endMin) / 2,
      };
      continue;
    }
    const endMin = quarter.startMin + QUARTER_MINUTES;
    bands.push({
      key: `${studioDate}:${String(quarter.startMin)}-${String(endMin)}`,
      studioDate,
      startMin: quarter.startMin,
      endMin,
      durationMin: QUARTER_MINUTES,
      centerMin: quarter.startMin + QUARTER_MINUTES / 2,
      coverage: quarter.coverage,
    });
  }
  return bands;
}

/**
 * Projects privacy-safe UTC FreeBusy intervals onto a seven-day studio wall
 * clock. Bands are quarter-hour aligned because calendar creation snaps to the
 * same increment. A day is Google-full only when no real working candidate is
 * free; reduced or malformed data is discarded and reported as unknown.
 */
export function buildScheduleGoogleBusyModel(
  input: BuildScheduleGoogleBusyModelInput,
): ScheduleGoogleBusyModel {
  const visibleStartMin = input.visibleStartMin ?? 0;
  const visibleEndMin = input.visibleEndMin ?? MINUTES_PER_DAY;
  validateVisibleRange(visibleStartMin, visibleEndMin);
  const formatter = createStudioFormatter(input.studioTimeZone);
  const dates = studioDateKeys(input.weekStart);
  const workingBlocks = input.workingBlocks.filter(validWorkingBlock);
  const normalized = normalizeBusyIntervals(input.intervals);
  const googleBusyCurrent =
    input.protection === "google_aware" && input.health === "healthy" && normalized.valid;
  const busyIntervals = googleBusyCurrent ? normalized.intervals : [];

  const days = dates.map<ScheduleGoogleBusyDay>((studioDate) => {
    const marker = parseCivilDate(studioDate);
    const weekday = new Date(Date.UTC(marker.year, marker.month - 1, marker.day)).getUTCDay();
    const dayBlocks = workingBlocks.filter((block) => block.weekday === weekday);
    const offsets = possibleOffsets(studioDate, formatter);
    const busyStartMinutes: number[] = [];
    const blockedStartMinutes: number[] = [];
    const partialBusyStartMinutes: number[] = [];
    const workingStartMinutes = new Set<number>();
    const visualQuarters: {
      startMin: number;
      coverage: ScheduleGoogleBusyBand["coverage"];
    }[] = [];
    let workingCandidateCount = 0;
    let hasFreeWorkingCandidate = false;

    for (let startMin = 0; startMin < MINUTES_PER_DAY; startMin += QUARTER_MINUTES) {
      const candidates = studioMinuteCandidates({
        studioDate,
        startMin,
        formatter,
        offsets,
      });
      const busyCandidates = googleBusyCurrent
        ? candidates.filter((candidate) =>
            overlapsBusy(candidate, candidate + QUARTER_MS, busyIntervals),
          )
        : [];
      const anyBusy = busyCandidates.length > 0;
      const fullyBusy = candidates.length > 0 && busyCandidates.length === candidates.length;
      if (anyBusy) busyStartMinutes.push(startMin);
      if (fullyBusy) blockedStartMinutes.push(startMin);
      if (anyBusy && !fullyBusy) partialBusyStartMinutes.push(startMin);
      if (anyBusy && startMin >= visibleStartMin && startMin < visibleEndMin) {
        visualQuarters.push({
          startMin,
          coverage: fullyBusy ? "blocked" : "partial",
        });
      }

      for (const candidate of candidates) {
        const working = dayBlocks.some((block) =>
          candidateFitsWorkingBlock({
            startMin,
            block,
          }),
        );
        if (!working) continue;
        workingCandidateCount += 1;
        workingStartMinutes.add(startMin);
        if (!googleBusyCurrent || !overlapsBusy(candidate, candidate + QUARTER_MS, busyIntervals)) {
          hasFreeWorkingCandidate = true;
        }
      }
    }

    const state: ScheduleGoogleBusyDayState =
      workingCandidateCount === 0
        ? "closed"
        : !googleBusyCurrent
          ? "unknown"
          : hasFreeWorkingCandidate
            ? "available"
            : "google_full";
    return {
      studioDate,
      weekday,
      state,
      bands: mergeBands(studioDate, visualQuarters),
      busyStartMinutes,
      blockedStartMinutes,
      partialBusyStartMinutes,
      workingStartMinutes: [...workingStartMinutes].sort((left, right) => left - right),
    };
  });

  return {
    weekStart: input.weekStart,
    googleBusyCurrent,
    days,
  };
}

export function scheduleGoogleBusyDay(
  model: ScheduleGoogleBusyModel,
  studioDate: string,
): ScheduleGoogleBusyDay | null {
  return model.days.find((day) => day.studioDate === studioDate) ?? null;
}

export function isScheduleGoogleBusyStart(
  model: ScheduleGoogleBusyModel,
  studioDate: string,
  studioStartMin: number,
): boolean {
  return (
    scheduleGoogleBusyDay(model, studioDate)?.blockedStartMinutes.includes(studioStartMin) ?? false
  );
}
