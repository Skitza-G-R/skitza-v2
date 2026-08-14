import { SessionBookingDomainError } from "./errors";
import {
  minimumLeadTimeSatisfied,
  producerLocalDateKeys,
  producerLocalDateRange,
  sessionAvailabilityHorizonDays,
  studioLocalDateTimeUtcCandidates,
  wallClockDateKey,
  zonedLocalDateKey,
  zonedWallClockAt,
} from "./time";
import type {
  SessionAvailabilityBlackout,
  SessionAvailabilityBlock,
  SessionBookingScheduleEntry,
  SessionBusyInterval,
} from "./types";

export type SessionSlotIssueCode =
  | "OUTSIDE_AVAILABILITY"
  | "BLACKOUT"
  | "LEAD_TIME_VIOLATION"
  | "BOOKING_CONFLICT"
  | "GOOGLE_BUSY"
  | "BUFFER_CONFLICT"
  | "DAILY_LIMIT";

export type SessionSlotIssue = Readonly<{
  code: SessionSlotIssueCode;
  severity: "hard_conflict" | "warning";
  message: string;
}>;

export type SessionSlotActor = "artist" | "producer" | "producer_google_hard";

export type ClassifySessionSlotInput = Readonly<{
  startsAt: Date;
  durationMin: number;
  bufferMinutes: number;
  producerTimeZone: string;
  availabilityBlocks: readonly SessionAvailabilityBlock[];
  blackouts: readonly SessionAvailabilityBlackout[];
  existingBookings: readonly SessionBookingScheduleEntry[];
  googleBusyIntervals?: readonly SessionBusyInterval[];
  maxSessionsPerDay?: number | null;
  ignoreBookingId?: string;
  now?: Date;
  minLeadHours?: number;
  actor: SessionSlotActor;
}>;

function slotIssue(
  actor: SessionSlotActor,
  code: SessionSlotIssueCode,
  message: string,
): SessionSlotIssue {
  const producerWarning =
    actor !== "artist" &&
    (code === "OUTSIDE_AVAILABILITY" ||
      code === "BLACKOUT" ||
      (code === "GOOGLE_BUSY" && actor === "producer") ||
      code === "BUFFER_CONFLICT" ||
      code === "DAILY_LIMIT");
  return {
    code,
    severity: producerWarning ? "warning" : "hard_conflict",
    message,
  };
}

export function classifySessionSlot(input: ClassifySessionSlotInput): readonly SessionSlotIssue[] {
  if (
    Number.isNaN(input.startsAt.getTime()) ||
    !Number.isSafeInteger(input.durationMin) ||
    input.durationMin <= 0 ||
    !Number.isSafeInteger(input.bufferMinutes) ||
    input.bufferMinutes < 0 ||
    (input.maxSessionsPerDay !== undefined &&
      input.maxSessionsPerDay !== null &&
      (!Number.isSafeInteger(input.maxSessionsPerDay) || input.maxSessionsPerDay <= 0)) ||
    (input.now === undefined) !== (input.minLeadHours === undefined)
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The requested session slot is invalid");
  }

  const issues: SessionSlotIssue[] = [];
  const startWall = zonedWallClockAt(input.startsAt, input.producerTimeZone);
  const endsAt = new Date(input.startsAt.getTime() + input.durationMin * 60 * 1000);
  const endWall = zonedWallClockAt(endsAt, input.producerTimeZone);
  const startDate = wallClockDateKey(startWall);
  const endDate = wallClockDateKey(endWall);
  const startMin = startWall.hour * 60 + startWall.minute;
  const nextDate = producerLocalDateKeys(startDate, 2)[1];
  const endsAtNextMidnight = endDate === nextDate && endWall.hour === 0 && endWall.minute === 0;
  const endMin = endsAtNextMidnight ? 24 * 60 : endWall.hour * 60 + endWall.minute;
  if (
    startWall.weekday < 0 ||
    (endDate !== startDate && !endsAtNextMidnight) ||
    !input.availabilityBlocks.some(
      (block) =>
        block.weekday === startWall.weekday && startMin >= block.startMin && endMin <= block.endMin,
    )
  ) {
    issues.push(
      slotIssue(
        input.actor,
        "OUTSIDE_AVAILABILITY",
        "The requested session is outside the producer's availability",
      ),
    );
  }
  if (
    input.blackouts.some(
      (blackout) => startDate >= blackout.startDate && startDate <= blackout.endDate,
    )
  ) {
    issues.push(slotIssue(input.actor, "BLACKOUT", "The producer is unavailable on this date"));
  }
  if (
    input.now !== undefined &&
    input.minLeadHours !== undefined &&
    !minimumLeadTimeSatisfied({
      startsAt: input.startsAt,
      now: input.now,
      minLeadHours: input.minLeadHours,
    })
  ) {
    issues.push(
      slotIssue(
        input.actor,
        "LEAD_TIME_VIOLATION",
        "The session does not meet the purchased minimum lead time",
      ),
    );
  }

  const requestedEnd = endsAt.getTime();
  const requestedBufferMs = input.bufferMinutes * 60 * 1000;
  let coreConflict = false;
  let bufferConflict = false;
  let sessionsOnDate = 0;
  for (const existing of input.existingBookings) {
    if (existing.id === input.ignoreBookingId) continue;
    if (
      Number.isNaN(existing.startsAt.getTime()) ||
      !Number.isSafeInteger(existing.durationMin) ||
      existing.durationMin <= 0 ||
      !Number.isSafeInteger(existing.bufferMinutes) ||
      existing.bufferMinutes < 0
    ) {
      throw new SessionBookingDomainError("INVALID_SLOT", "An existing session slot is invalid");
    }
    const existingCoreEnd = existing.startsAt.getTime() + existing.durationMin * 60 * 1000;
    const existingBufferedEnd = existingCoreEnd + existing.bufferMinutes * 60 * 1000;
    if (input.startsAt.getTime() < existingCoreEnd && existing.startsAt.getTime() < requestedEnd) {
      coreConflict = true;
    } else if (
      input.startsAt.getTime() < existingBufferedEnd &&
      existing.startsAt.getTime() < requestedEnd + requestedBufferMs
    ) {
      bufferConflict = true;
    }
    if (zonedLocalDateKey(existing.startsAt, input.producerTimeZone) === startDate) {
      sessionsOnDate += 1;
    }
  }
  if (coreConflict) {
    issues.push(
      slotIssue(input.actor, "BOOKING_CONFLICT", "The session overlaps another Skitza session"),
    );
  }
  const googleBusyConflict = (input.googleBusyIntervals ?? []).some((busy) => {
    if (
      Number.isNaN(busy.startsAt.getTime()) ||
      Number.isNaN(busy.endsAt.getTime()) ||
      busy.startsAt.getTime() >= busy.endsAt.getTime()
    ) {
      throw new SessionBookingDomainError("INVALID_SLOT", "A Google busy interval is invalid");
    }
    return (
      input.startsAt.getTime() < busy.endsAt.getTime() && busy.startsAt.getTime() < requestedEnd
    );
  });
  if (googleBusyConflict) {
    issues.push(
      slotIssue(input.actor, "GOOGLE_BUSY", "This time overlaps a busy time in Google Calendar"),
    );
  }
  if (bufferConflict) {
    issues.push(
      slotIssue(input.actor, "BUFFER_CONFLICT", "The session overlaps the studio buffer"),
    );
  }
  if (
    input.maxSessionsPerDay !== undefined &&
    input.maxSessionsPerDay !== null &&
    sessionsOnDate >= input.maxSessionsPerDay
  ) {
    issues.push(
      slotIssue(input.actor, "DAILY_LIMIT", "The producer's daily session limit has been reached"),
    );
  }
  return issues;
}

export function assertSessionSlotAvailable(input: Omit<ClassifySessionSlotInput, "actor">): void {
  const issue = classifySessionSlot({ ...input, actor: "artist" })[0];
  if (issue) throw new SessionBookingDomainError(issue.code, issue.message);
}

export type ExactSessionSlot = Readonly<{
  startsAt: Date;
  endsAt: Date;
  studioDate: string;
  studioStartMin: number;
}>;

export type ExactSessionSlotDay = Readonly<{
  date: string;
  slots: readonly ExactSessionSlot[];
}>;

export type ProducerExactSessionSlotsInput = Readonly<{
  now: Date;
  canBook: boolean;
  producerTimeZone: string;
  durationMin: number;
  bufferMinutes: number;
  minLeadHours: number;
  maxSessionsPerDay?: number | null;
  availabilityBlocks: readonly SessionAvailabilityBlock[];
  blackouts: readonly SessionAvailabilityBlackout[];
  existingBookings: readonly SessionBookingScheduleEntry[];
  googleBusyIntervals?: readonly SessionBusyInterval[];
  ignoreBookingId?: string;
}>;

export function generateArtistExactSessionSlots(
  input: Readonly<{
    now: Date;
    canBook: boolean;
    producerTimeZone: string;
    artistTimeZone: string;
    durationMin: number;
    bufferMinutes: number;
    minLeadHours: number;
    maxSessionsPerDay?: number | null;
    availabilityBlocks: readonly SessionAvailabilityBlock[];
    blackouts: readonly SessionAvailabilityBlackout[];
    existingBookings: readonly SessionBookingScheduleEntry[];
    googleBusyIntervals?: readonly SessionBusyInterval[];
    ignoreBookingId?: string;
    slotIncrementMin?: number;
    availabilityWindowDays?: number;
  }>,
): Readonly<{
  days: readonly ExactSessionSlotDay[];
  today: string;
}> {
  const slotIncrementMin = input.slotIncrementMin ?? 30;
  if (
    Number.isNaN(input.now.getTime()) ||
    !Number.isSafeInteger(slotIncrementMin) ||
    slotIncrementMin <= 0 ||
    slotIncrementMin > 24 * 60
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The slot interval is invalid");
  }

  const blocksByWeekday = new Map<number, SessionAvailabilityBlock[]>();
  for (const block of input.availabilityBlocks) {
    const blocks = blocksByWeekday.get(block.weekday) ?? [];
    blocks.push(block);
    blocksByWeekday.set(block.weekday, blocks);
  }
  for (const blocks of blocksByWeekday.values()) {
    blocks.sort((left, right) => left.startMin - right.startMin);
  }

  const slotsByArtistDay = new Map<string, ExactSessionSlot[]>();
  const seenStarts = new Set<number>();
  let producerDates: string[];
  if (input.availabilityWindowDays === undefined) {
    producerDates = producerLocalDateRange(
      input.now,
      input.producerTimeZone,
      sessionAvailabilityHorizonDays(input.minLeadHours),
    );
  } else {
    sessionAvailabilityHorizonDays(input.minLeadHours, input.availabilityWindowDays);
    const leadBoundary = new Date(
      input.now.getTime() + input.minLeadHours * 60 * 60 * 1000,
    );
    const leadBoundaryDate = zonedLocalDateKey(leadBoundary, input.producerTimeZone);
    const boundaryWeekday = new Date(`${leadBoundaryDate}T00:00:00.000Z`).getUTCDay();
    let boundaryHasCandidateBeforeLead = false;
    let boundaryHasCandidateAtOrAfterLead = false;
    for (const block of blocksByWeekday.get(boundaryWeekday) ?? []) {
      for (
        let studioStartMin = block.startMin;
        studioStartMin + input.durationMin <= block.endMin;
        studioStartMin += slotIncrementMin
      ) {
        for (const startsAt of studioLocalDateTimeUtcCandidates({
          date: leadBoundaryDate,
          startMin: studioStartMin,
          timeZone: input.producerTimeZone,
        })) {
          if (startsAt.getTime() < leadBoundary.getTime()) {
            boundaryHasCandidateBeforeLead = true;
          } else {
            boundaryHasCandidateAtOrAfterLead = true;
          }
        }
      }
    }
    const shiftPastLeadBoundary =
      boundaryHasCandidateBeforeLead && !boundaryHasCandidateAtOrAfterLead;
    const firstWindowDate = shiftPastLeadBoundary
      ? producerLocalDateKeys(leadBoundaryDate, 2)[1]
      : leadBoundaryDate;
    if (!firstWindowDate) {
      throw new SessionBookingDomainError("INVALID_SLOT", "The studio calendar range is invalid");
    }
    producerDates = producerLocalDateKeys(firstWindowDate, input.availabilityWindowDays);
  }
  if (input.canBook) {
    for (const studioDate of producerDates) {
      const weekday = new Date(`${studioDate}T00:00:00.000Z`).getUTCDay();
      for (const block of blocksByWeekday.get(weekday) ?? []) {
        for (
          let studioStartMin = block.startMin;
          studioStartMin + input.durationMin <= block.endMin;
          studioStartMin += slotIncrementMin
        ) {
          for (const startsAt of studioLocalDateTimeUtcCandidates({
            date: studioDate,
            startMin: studioStartMin,
            timeZone: input.producerTimeZone,
          })) {
            if (seenStarts.has(startsAt.getTime())) continue;
            try {
              assertSessionSlotAvailable({
                startsAt,
                durationMin: input.durationMin,
                bufferMinutes: input.bufferMinutes,
                producerTimeZone: input.producerTimeZone,
                availabilityBlocks: input.availabilityBlocks,
                blackouts: input.blackouts,
                existingBookings: input.existingBookings,
                ...(input.googleBusyIntervals
                  ? { googleBusyIntervals: input.googleBusyIntervals }
                  : {}),
                now: input.now,
                minLeadHours: input.minLeadHours,
                ...(input.maxSessionsPerDay !== undefined
                  ? { maxSessionsPerDay: input.maxSessionsPerDay }
                  : {}),
                ...(input.ignoreBookingId ? { ignoreBookingId: input.ignoreBookingId } : {}),
              });
            } catch (error) {
              if (!(error instanceof SessionBookingDomainError)) throw error;
              continue;
            }
            seenStarts.add(startsAt.getTime());
            const artistDate = zonedLocalDateKey(startsAt, input.artistTimeZone);
            const slots = slotsByArtistDay.get(artistDate) ?? [];
            slots.push({
              startsAt,
              endsAt: new Date(startsAt.getTime() + input.durationMin * 60 * 1000),
              studioDate,
              studioStartMin,
            });
            slotsByArtistDay.set(artistDate, slots);
          }
        }
      }
    }
  }

  return {
    days: [...slotsByArtistDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, slots]) => ({
        date,
        slots: slots.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime()),
      }))
      .filter((day) => day.slots.length > 0),
    today: zonedLocalDateKey(input.now, input.artistTimeZone),
  };
}

/**
 * Producer-facing exact availability for manual booking and rescheduling.
 *
 * The shared artist generator remains the single source of truth for policy
 * filtering. Producer availability uses studio-local days, fixed 15-minute
 * increments, and includes empty days so the calendar can render a full day
 * as unavailable without learning anything about Google events.
 */
export function generateProducerExactSessionSlots(input: ProducerExactSessionSlotsInput): Readonly<{
  days: readonly ExactSessionSlotDay[];
  today: string;
}> {
  const generated = generateArtistExactSessionSlots({
    ...input,
    artistTimeZone: input.producerTimeZone,
    slotIncrementMin: 15,
  });
  const slotsByDate = new Map(generated.days.map((day) => [day.date, day.slots]));
  const producerDates = producerLocalDateRange(
    input.now,
    input.producerTimeZone,
    sessionAvailabilityHorizonDays(input.minLeadHours),
  );

  return {
    days: producerDates.map((date) => ({ date, slots: slotsByDate.get(date) ?? [] })),
    today: generated.today,
  };
}
