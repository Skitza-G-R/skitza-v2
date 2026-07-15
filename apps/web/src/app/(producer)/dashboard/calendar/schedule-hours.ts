const MINUTES_PER_HOUR = 60;
const MIN_HOUR = 0;
const MAX_HOUR = 24;
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 19;

export type ScheduleAvailabilityBlock = {
  startMin: number;
  endMin: number;
};

type ScheduleRangeSession = {
  startsAt: string;
  durationMin: number;
};

export type ScheduleHourRange = {
  startHour: number;
  /** Exclusive end hour. A value of 20 renders rows through 19:00–20:00. */
  endHour: number;
};

function clampHour(hour: number): number {
  return Math.min(MAX_HOUR, Math.max(MIN_HOUR, hour));
}

export function deriveScheduleHourRange(
  availabilityBlocks: readonly ScheduleAvailabilityBlock[],
  sessions: readonly ScheduleRangeSession[],
  timeZone = "UTC",
): ScheduleHourRange {
  const validBlocks = availabilityBlocks.filter(
    (block) => block.endMin > block.startMin,
  );

  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;

  if (validBlocks.length > 0) {
    startHour = clampHour(
      Math.floor(
        Math.min(...validBlocks.map((block) => block.startMin)) /
          MINUTES_PER_HOUR,
      ),
    );
    endHour = clampHour(
      Math.ceil(
        Math.max(...validBlocks.map((block) => block.endMin)) /
          MINUTES_PER_HOUR,
      ),
    );
  }

  for (const session of sessions) {
    const startsAt = new Date(session.startsAt);
    if (Number.isNaN(startsAt.getTime()) || session.durationMin <= 0) continue;

    const sessionTime = calendarDateTimeParts(startsAt, timeZone);
    const sessionStartMin =
      sessionTime.hour * MINUTES_PER_HOUR + sessionTime.minute;
    const sessionStartHour = clampHour(
      Math.floor(sessionStartMin / MINUTES_PER_HOUR),
    );
    const sessionEndHour = clampHour(
      Math.ceil(
        (sessionStartMin + session.durationMin) / MINUTES_PER_HOUR,
      ),
    );

    startHour = Math.min(startHour, sessionStartHour);
    endHour = Math.max(endHour, sessionEndHour);
  }

  return endHour > startHour
    ? { startHour, endHour }
    : { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
}
import { calendarDateTimeParts } from "./calendar-time";
