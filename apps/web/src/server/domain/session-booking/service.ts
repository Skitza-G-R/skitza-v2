import { createHash, randomUUID } from "node:crypto";

export type SessionUseOutcome =
  | "reserved"
  | "completed"
  | "cancelled_on_time"
  | "cancelled_by_producer"
  | "cancelled_late"
  | "no_show";

export type SessionBookingErrorCode =
  | "PURCHASE_INACTIVE"
  | "PROJECT_INACTIVE"
  | "ALLOWANCE_CLOSED"
  | "DURATION_MISMATCH"
  | "LEAD_TIME_VIOLATION"
  | "ALLOWANCE_EXHAUSTED"
  | "INVALID_ALLOWANCE"
  | "INVALID_SLOT"
  | "OUTSIDE_AVAILABILITY"
  | "BLACKOUT"
  | "BOOKING_CONFLICT"
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "CANCELLATION_WINDOW"
  | "OPERATION_KEY_CONFLICT"
  | "BOOKING_DISABLED"
  | "HELD_EXPIRED"
  | "TOO_EARLY";

export class SessionBookingDomainError extends Error {
  readonly code: SessionBookingErrorCode;

  constructor(code: SessionBookingErrorCode, message: string) {
    super(message);
    this.name = "SessionBookingDomainError";
    this.code = code;
  }
}

export function sessionUseConsumesAllowance(outcome: SessionUseOutcome): boolean {
  return (
    outcome === "reserved" ||
    outcome === "completed" ||
    outcome === "cancelled_late" ||
    outcome === "no_show"
  );
}

export type SessionBookingStatus =
  | "pending_approval"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "completed"
  | "no_show";

export type SessionBookingActorKind = "artist" | "producer" | "system";
export type SessionBookingTransitionKind =
  | "created"
  | "confirmed"
  | "rejected"
  | "artist_cancelled"
  | "producer_cancelled"
  | "rescheduled"
  | "completed"
  | "no_show";

export type SessionBookingRecord = Readonly<{
  id: string;
  producerId: string;
  projectId: string;
  purchaseId: string;
  sessionAllowanceId: string;
  artistName: string;
  artistEmail: string;
  startsAt: Date;
  durationMin: number;
  operationKey: string;
  operationDigest: string;
  rescheduledFromBookingId: string | null;
  allowanceUseId: string;
  cancellationPolicyHoursSnapshot: number;
  cancellationPolicySnapshottedAt: Date;
  cancellationPolicyBackfilled: boolean;
  heldExpiresAt: Date | null;
  heldExpiredAt: Date | null;
  heldExpiryReason: "approval_timeout" | null;
  status: SessionBookingStatus;
  outcome: SessionUseOutcome;
  statusChangedAt: Date | null;
  outcomeChangedAt: Date | null;
  createdAt: Date;
}>;

export type SessionBookingAllowance = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  bookingEnabledSnapshot: boolean;
  kind: "fixed" | "unlimited";
  sessionLimit: number | null;
  durationMin: number;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  closedAt: Date | null;
}>;

export type SessionBookingCreateContext = Readonly<{
  producer: Readonly<{
    id: string;
    timeZone: string;
    autoConfirmBookings: boolean;
    cancellationPolicyHours: number;
  }>;
  project: Readonly<{
    id: string;
    lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  }>;
  purchase: Readonly<{
    id: string;
    lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  }>;
  allowance: SessionBookingAllowance;
  artist: Readonly<{ clerkUserId: string | null; name: string; email: string }>;
  availabilityBlocks: readonly Readonly<{ weekday: number; startMin: number; endMin: number }>[];
  blackouts: readonly Readonly<{ startDate: string; endDate: string }>[];
}>;

export type SessionBookingContext = SessionBookingCreateContext &
  Readonly<{ booking: SessionBookingRecord }>;

export type SessionBookingScheduleEntry = Readonly<{
  id: string;
  startsAt: Date;
  durationMin: number;
  bufferMinutes: number;
}>;

export type NewSessionBookingRecord = Omit<
  SessionBookingRecord,
  "id" | "statusChangedAt" | "outcomeChangedAt" | "createdAt"
> &
  Readonly<{ occurredAt: Date }>;

export type SessionBookingTransitionEventDraft = Readonly<{
  bookingId: string;
  producerId: string;
  operationKey: string;
  operationDigest: string;
  kind: SessionBookingTransitionKind;
  actorKind: SessionBookingActorKind;
  actorId: string | null;
  fromStatus: SessionBookingStatus | null;
  toStatus: SessionBookingStatus;
  fromOutcome: SessionUseOutcome | null;
  toOutcome: SessionUseOutcome;
  oldStartsAt: Date | null;
  newStartsAt: Date | null;
  occurredAt: Date;
}>;

export type StoredSessionBookingTransitionEvent = SessionBookingTransitionEventDraft &
  Readonly<{ id: string }>;

export type SessionBookingAtomicScope =
  | Readonly<{
      kind: "create";
      producerId: string;
      projectId: string;
      purchaseId: string;
      sessionAllowanceId: string;
    }>
  | Readonly<{ kind: "booking"; bookingId: string; producerId?: string }>;

export interface SessionBookingTransaction {
  loadCreateContext(input: {
    producerId: string;
    projectId: string;
    purchaseId: string;
    sessionAllowanceId: string;
    actorClerkUserId: string;
  }): Promise<SessionBookingCreateContext | null>;
  loadBookingContext(input: {
    bookingId: string;
    producerId?: string;
    actorClerkUserId?: string;
  }): Promise<SessionBookingContext | null>;
  findBookingByOperationKey(
    producerId: string,
    operationKey: string,
  ): Promise<SessionBookingRecord | null>;
  findReplacementBooking(bookingId: string): Promise<SessionBookingRecord | null>;
  findTransitionEvent(
    bookingId: string,
    operationKey: string,
  ): Promise<StoredSessionBookingTransitionEvent | null>;
  listAllowanceUses(
    producerId: string,
    sessionAllowanceId: string,
  ): Promise<
    readonly Readonly<{
      bookingId: string;
      allowanceUseId: string;
      outcome: SessionUseOutcome;
    }>[]
  >;
  listScheduleEntries(producerId: string): Promise<readonly SessionBookingScheduleEntry[]>;
  insertBooking(input: NewSessionBookingRecord): Promise<SessionBookingRecord>;
  updateBooking(input: {
    bookingId: string;
    producerId: string;
    expectedStatus: "pending_approval" | "confirmed";
    status: SessionBookingStatus;
    outcome: SessionUseOutcome;
    occurredAt: Date;
    heldExpiredAt?: Date;
    heldExpiryReason?: "approval_timeout";
  }): Promise<SessionBookingRecord>;
  insertTransitionEvent(
    input: SessionBookingTransitionEventDraft,
  ): Promise<StoredSessionBookingTransitionEvent>;
}

export interface SessionBookingRepository {
  atomically<T>(
    scope: SessionBookingAtomicScope,
    work: (transaction: SessionBookingTransaction) => Promise<T>,
  ): Promise<T>;
}

export function initialSessionBookingStatus(
  autoConfirm: boolean,
): "pending_approval" | "confirmed" {
  return autoConfirm ? "confirmed" : "pending_approval";
}

export function artistCancellationOutcome(input: {
  startsAt: Date;
  now: Date;
  cancellationPolicyHours: number;
}): "cancelled_on_time" | "cancelled_late" {
  if (
    Number.isNaN(input.startsAt.getTime()) ||
    Number.isNaN(input.now.getTime()) ||
    !Number.isSafeInteger(input.cancellationPolicyHours) ||
    input.cancellationPolicyHours < 0
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The cancellation policy is invalid");
  }
  const deadline = input.startsAt.getTime() - input.cancellationPolicyHours * 60 * 60 * 1000;
  return input.now.getTime() < deadline ? "cancelled_on_time" : "cancelled_late";
}

type WallClock = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}>;

function wallClockAt(instant: Date, timeZone: string): WallClock {
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
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
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

function dateKey(wall: Pick<WallClock, "year" | "month" | "day">): string {
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
    const wall = wallClockAt(sample, input.timeZone);
    offsets.add(
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - sample.getTime(),
    );
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wallUtc - offset))
    .filter((candidate) => {
      const wall = wallClockAt(candidate, input.timeZone);
      return (
        wall.year === year &&
        wall.month === month &&
        wall.day === day &&
        wall.hour === hour &&
        wall.minute === minute
      );
    })
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates;
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

export function studioLocalDateKey(instant: Date, timeZone: string): string {
  return dateKey(wallClockAt(instant, timeZone));
}

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

export const producerLocalDateKey = studioLocalDateKey;

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

export function assertSessionSlotAvailable(
  input: Readonly<{
    startsAt: Date;
    durationMin: number;
    bufferMinutes: number;
    producerTimeZone: string;
    availabilityBlocks: readonly Readonly<{ weekday: number; startMin: number; endMin: number }>[];
    blackouts: readonly Readonly<{ startDate: string; endDate: string }>[];
    existingBookings: readonly SessionBookingScheduleEntry[];
    ignoreBookingId?: string;
  }>,
): void {
  if (
    Number.isNaN(input.startsAt.getTime()) ||
    !Number.isSafeInteger(input.durationMin) ||
    input.durationMin <= 0 ||
    !Number.isSafeInteger(input.bufferMinutes) ||
    input.bufferMinutes < 0
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The requested session slot is invalid");
  }
  const startWall = wallClockAt(input.startsAt, input.producerTimeZone);
  const endsAt = new Date(input.startsAt.getTime() + input.durationMin * 60 * 1000);
  const endWall = wallClockAt(endsAt, input.producerTimeZone);
  const startDate = dateKey(startWall);
  const endDate = dateKey(endWall);
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
    throw new SessionBookingDomainError(
      "OUTSIDE_AVAILABILITY",
      "The requested session is outside the producer's availability",
    );
  }
  if (
    input.blackouts.some(
      (blackout) => startDate >= blackout.startDate && startDate <= blackout.endDate,
    )
  ) {
    throw new SessionBookingDomainError("BLACKOUT", "The producer is unavailable on this date");
  }

  const requestedEnd = endsAt.getTime();
  const requestedBufferMs = input.bufferMinutes * 60 * 1000;
  const conflict = input.existingBookings.some((existing) => {
    if (existing.id === input.ignoreBookingId) return false;
    if (
      Number.isNaN(existing.startsAt.getTime()) ||
      !Number.isSafeInteger(existing.durationMin) ||
      existing.durationMin <= 0 ||
      !Number.isSafeInteger(existing.bufferMinutes) ||
      existing.bufferMinutes < 0
    ) {
      throw new SessionBookingDomainError("INVALID_SLOT", "An existing session slot is invalid");
    }
    const existingEnd =
      existing.startsAt.getTime() + (existing.durationMin + existing.bufferMinutes) * 60 * 1000;
    return (
      input.startsAt.getTime() < existingEnd &&
      existing.startsAt.getTime() < requestedEnd + requestedBufferMs
    );
  });
  if (conflict) {
    throw new SessionBookingDomainError(
      "BOOKING_CONFLICT",
      "The session slot is no longer available",
    );
  }
}

export function assertSessionBookingAllowed(
  input: Readonly<{
    purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
    allowance: Readonly<{
      bookingEnabledSnapshot: boolean;
      kind: "fixed" | "unlimited";
      sessionLimit: number | null;
      durationMin: number;
      minLeadHours: number;
      closedAt: Date | null;
    }>;
    existingOutcomes: readonly SessionUseOutcome[];
    requestedDurationMin: number;
    startsAt: Date;
    now: Date;
  }>,
): void {
  if (input.purchaseLifecycleStatus !== "active") {
    throw new SessionBookingDomainError(
      "PURCHASE_INACTIVE",
      "The purchase is not active for session booking",
    );
  }
  if (input.projectLifecycleStatus !== "active") {
    throw new SessionBookingDomainError(
      "PROJECT_INACTIVE",
      "The project is not active for session booking",
    );
  }
  if (input.allowance.closedAt !== null) {
    throw new SessionBookingDomainError("ALLOWANCE_CLOSED", "The session allowance is closed");
  }
  if (!input.allowance.bookingEnabledSnapshot) {
    throw new SessionBookingDomainError(
      "BOOKING_DISABLED",
      "This purchase does not include artist session booking",
    );
  }
  if (
    !Number.isSafeInteger(input.allowance.durationMin) ||
    input.allowance.durationMin <= 0 ||
    !Number.isSafeInteger(input.allowance.minLeadHours) ||
    input.allowance.minLeadHours < 0
  ) {
    throw new SessionBookingDomainError("INVALID_ALLOWANCE", "The session allowance is invalid");
  }
  if (input.requestedDurationMin !== input.allowance.durationMin) {
    throw new SessionBookingDomainError(
      "DURATION_MISMATCH",
      "The requested duration does not match the purchased session allowance",
    );
  }
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.now.getTime())) {
    throw new SessionBookingDomainError("INVALID_ALLOWANCE", "The session time is invalid");
  }
  const earliestStart = input.now.getTime() + input.allowance.minLeadHours * 60 * 60 * 1000;
  if (input.startsAt.getTime() < earliestStart) {
    throw new SessionBookingDomainError(
      "LEAD_TIME_VIOLATION",
      "The session does not meet the purchased minimum lead time",
    );
  }

  if (input.allowance.kind === "unlimited") {
    if (input.allowance.sessionLimit !== null) {
      throw new SessionBookingDomainError(
        "INVALID_ALLOWANCE",
        "An unlimited allowance cannot have a fixed limit",
      );
    }
    return;
  }

  if (
    !Number.isSafeInteger(input.allowance.sessionLimit) ||
    input.allowance.sessionLimit === null ||
    input.allowance.sessionLimit <= 0
  ) {
    throw new SessionBookingDomainError(
      "INVALID_ALLOWANCE",
      "A fixed allowance must have a positive limit",
    );
  }
  const used = input.existingOutcomes.filter(sessionUseConsumesAllowance).length;
  if (used >= input.allowance.sessionLimit) {
    throw new SessionBookingDomainError(
      "ALLOWANCE_EXHAUSTED",
      "No purchased sessions remain on this allowance",
    );
  }
}

function assertOperationKey(operationKey: string): void {
  if (
    operationKey !== operationKey.trim() ||
    operationKey.length < 1 ||
    operationKey.length > 200
  ) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The booking operation key is invalid");
  }
}

function operationDigest(kind: string, payload: Record<string, unknown>): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ kind, ...payload }), "utf8")
    .digest("hex")}`;
}

function assertOperationReplay(
  existing: Readonly<{ operationDigest: string }>,
  expectedDigest: string,
): void {
  if (existing.operationDigest !== expectedDigest) {
    throw new SessionBookingDomainError(
      "OPERATION_KEY_CONFLICT",
      "This operation key already belongs to a different booking command",
    );
  }
}

function bookingAtTransition(
  booking: SessionBookingRecord,
  event: StoredSessionBookingTransitionEvent,
): SessionBookingRecord {
  return {
    ...booking,
    status: event.toStatus,
    outcome: event.toOutcome,
    statusChangedAt: event.occurredAt,
    outcomeChangedAt: event.occurredAt,
  };
}

function assertActiveStatus(
  booking: SessionBookingRecord,
): asserts booking is SessionBookingRecord & {
  status: "pending_approval" | "confirmed";
} {
  if (booking.status !== "pending_approval" && booking.status !== "confirmed") {
    throw new SessionBookingDomainError(
      "INVALID_STATUS",
      `A ${booking.status} booking cannot make this transition`,
    );
  }
}

export function sessionBookingCapabilities(input: {
  booking: Pick<
    SessionBookingRecord,
    "status" | "startsAt" | "cancellationPolicyHoursSnapshot" | "heldExpiresAt"
  >;
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  allowanceClosedAt: Date | null;
  now: Date;
}): Readonly<{
  cancellationDeadline: Date;
  isOnTime: boolean;
  canCancel: boolean;
  canReschedule: boolean;
}> {
  const cancellationDeadline = new Date(
    input.booking.startsAt.getTime() -
      input.booking.cancellationPolicyHoursSnapshot * 60 * 60 * 1000,
  );
  const activeBooking =
    input.booking.status === "pending_approval" || input.booking.status === "confirmed";
  const heldBeforeStart =
    input.booking.status === "pending_approval" &&
    input.now.getTime() < input.booking.startsAt.getTime() &&
    input.booking.heldExpiresAt !== null &&
    input.now.getTime() < input.booking.heldExpiresAt.getTime();
  const isOnTime =
    artistCancellationOutcome({
      startsAt: input.booking.startsAt,
      now: input.now,
      cancellationPolicyHours: input.booking.cancellationPolicyHoursSnapshot,
    }) === "cancelled_on_time";
  return {
    cancellationDeadline,
    isOnTime,
    // A Held request is only a temporary reservation. The artist can withdraw
    // it until the session starts, independently of the confirmed-session
    // cancellation policy. Confirmed sessions use the strict cutoff.
    canCancel:
      activeBooking &&
      (heldBeforeStart || (input.booking.status === "confirmed" && isOnTime)),
    canReschedule:
      input.booking.status === "confirmed" &&
      isOnTime &&
      input.purchaseLifecycleStatus === "active" &&
      input.projectLifecycleStatus === "active" &&
      input.allowanceClosedAt === null,
  };
}

export function sessionAllowanceCanBook(input: {
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  allowanceClosedAt: Date | null;
  bookingEnabledSnapshot?: boolean;
  allowanceKind: "fixed" | "unlimited";
  sessionLimit: number | null;
  existingOutcomes?: readonly SessionUseOutcome[];
  existingUses?: readonly Readonly<{
    allowanceUseId: string;
    outcome: SessionUseOutcome;
  }>[];
}): boolean {
  if (
    input.purchaseLifecycleStatus !== "active" ||
    input.projectLifecycleStatus !== "active" ||
    input.allowanceClosedAt !== null ||
    input.bookingEnabledSnapshot === false
  ) {
    return false;
  }
  if (input.allowanceKind === "unlimited") return input.sessionLimit === null;
  if (input.sessionLimit === null || input.sessionLimit <= 0) return false;
  const used =
    input.existingUses === undefined
      ? (input.existingOutcomes ?? []).filter(sessionUseConsumesAllowance).length
      : new Set(
          input.existingUses
            .filter((use) => sessionUseConsumesAllowance(use.outcome))
            .map((use) => use.allowanceUseId),
        ).size;
  return used < input.sessionLimit;
}

type SessionBookingRequestedStart = Readonly<{
  startsAt?: Date;
  localSlot?: Readonly<{ date: string; startMin: number }>;
}>;

function commandNow(injectedNow?: Date): Date {
  const now = injectedNow ? new Date(injectedNow) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The command time is invalid");
  }
  return now;
}

function requestedSessionStart(
  input: SessionBookingRequestedStart,
  producerTimeZone: string,
): Date {
  if (input.localSlot && input.startsAt) {
    throw new SessionBookingDomainError(
      "INVALID_SLOT",
      "Choose either a local session slot or an exact start time",
    );
  }
  if (input.localSlot) {
    return sessionStartFromLocalSlot({
      date: input.localSlot.date,
      startMin: input.localSlot.startMin,
      producerTimeZone,
    });
  }
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The requested session time is invalid");
  }
  return new Date(input.startsAt);
}

function requestedStartOperationIdentity(
  input: SessionBookingRequestedStart,
): Readonly<Record<string, unknown>> {
  if (input.localSlot && input.startsAt) {
    throw new SessionBookingDomainError(
      "INVALID_SLOT",
      "Choose either a local session slot or an exact start time",
    );
  }
  if (input.localSlot) {
    return { localDate: input.localSlot.date, startMin: input.localSlot.startMin };
  }
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The requested session time is invalid");
  }
  return { startsAt: input.startsAt.toISOString() };
}

export type CreateSessionBookingInput = Readonly<{
  producerId: string;
  projectId: string;
  purchaseId: string;
  sessionAllowanceId: string;
  actorClerkUserId: string;
  durationMin: number;
  operationKey: string;
  now?: Date;
}> &
  SessionBookingRequestedStart;

export type CreateSessionBookingResult = Readonly<{
  booking: SessionBookingRecord;
  created: boolean;
}>;

async function createSessionBookingInTransaction(
  transaction: SessionBookingTransaction,
  input: CreateSessionBookingInput,
  options: Readonly<{
    rescheduledFromBookingId: string | null;
    allowanceUseId?: string;
    ignoredBookingId?: string;
    transitionKind: "created" | "rescheduled";
    operationDigestOverride?: string;
  }>,
): Promise<CreateSessionBookingResult> {
  const context = await transaction.loadCreateContext(input);
  if (!context) {
    throw new SessionBookingDomainError(
      "NOT_FOUND",
      "The purchased session allowance was not found",
    );
  }
  const digest =
    options.operationDigestOverride ??
    operationDigest("create", {
      producerId: input.producerId,
      projectId: input.projectId,
      purchaseId: input.purchaseId,
      sessionAllowanceId: input.sessionAllowanceId,
      ...requestedStartOperationIdentity(input),
      durationMin: input.durationMin,
      rescheduledFromBookingId: options.rescheduledFromBookingId,
    });
  const replay = await transaction.findBookingByOperationKey(input.producerId, input.operationKey);
  if (replay) {
    assertOperationReplay(replay, digest);
    if (
      replay.projectId !== input.projectId ||
      replay.purchaseId !== input.purchaseId ||
      replay.sessionAllowanceId !== input.sessionAllowanceId ||
      replay.rescheduledFromBookingId !== options.rescheduledFromBookingId
    ) {
      throw new SessionBookingDomainError(
        "OPERATION_KEY_CONFLICT",
        "This operation key belongs to another purchased session",
      );
    }
    const event = await transaction.findTransitionEvent(replay.id, input.operationKey);
    if (!event || event.kind !== options.transitionKind) {
      throw new SessionBookingDomainError(
        "OPERATION_KEY_CONFLICT",
        "The stored booking command is missing its immutable transition",
      );
    }
    assertOperationReplay(event, digest);
    return { booking: bookingAtTransition(replay, event), created: false };
  }

  // The repository enters this helper only after taking the shared schedule,
  // project, purchase, and allowance locks. Resolve mutable producer policy
  // (timezone) and the effective clock only for a genuinely new command.
  // Replays use their immutable transition and cannot be broken by a later
  // timezone change (including a newly introduced DST gap).
  const startsAt = requestedSessionStart(input, context.producer.timeZone);
  const now = commandNow(input.now);

  const uses = await transaction.listAllowanceUses(input.producerId, input.sessionAllowanceId);
  const distinctConsumingUses = new Map<string, SessionUseOutcome>();
  for (const use of uses) {
    if (
      use.bookingId !== options.ignoredBookingId &&
      sessionUseConsumesAllowance(use.outcome)
    ) {
      distinctConsumingUses.set(use.allowanceUseId, use.outcome);
    }
  }
  assertSessionBookingAllowed({
    purchaseLifecycleStatus: context.purchase.lifecycleStatus,
    projectLifecycleStatus: context.project.lifecycleStatus,
    allowance: context.allowance,
    existingOutcomes: [...distinctConsumingUses.values()],
    requestedDurationMin: input.durationMin,
    startsAt,
    now,
  });
  assertSessionSlotAvailable({
    startsAt,
    durationMin: input.durationMin,
    bufferMinutes: context.allowance.bufferMinutes,
    producerTimeZone: context.producer.timeZone,
    availabilityBlocks: context.availabilityBlocks,
    blackouts: context.blackouts,
    existingBookings: await transaction.listScheduleEntries(input.producerId),
    ...(options.ignoredBookingId ? { ignoreBookingId: options.ignoredBookingId } : {}),
  });

  const status = initialSessionBookingStatus(context.producer.autoConfirmBookings);
  const heldExpiresAt =
    status === "pending_approval"
      ? new Date(Math.min(now.getTime() + 24 * 60 * 60 * 1000, startsAt.getTime()))
      : null;
  const booking = await transaction.insertBooking({
    producerId: input.producerId,
    projectId: input.projectId,
    purchaseId: input.purchaseId,
    sessionAllowanceId: input.sessionAllowanceId,
    artistName: context.artist.name,
    artistEmail: context.artist.email,
    startsAt,
    durationMin: input.durationMin,
    operationKey: input.operationKey,
    operationDigest: digest,
    rescheduledFromBookingId: options.rescheduledFromBookingId,
    allowanceUseId: options.allowanceUseId ?? randomUUID(),
    cancellationPolicyHoursSnapshot: context.producer.cancellationPolicyHours,
    cancellationPolicySnapshottedAt: now,
    cancellationPolicyBackfilled: false,
    heldExpiresAt,
    heldExpiredAt: null,
    heldExpiryReason: null,
    status,
    outcome: "reserved",
    occurredAt: now,
  });
  await transaction.insertTransitionEvent({
    bookingId: booking.id,
    producerId: booking.producerId,
    operationKey: input.operationKey,
    operationDigest: digest,
    kind: options.transitionKind,
    actorKind: "artist",
    actorId: input.actorClerkUserId,
    fromStatus: null,
    toStatus: booking.status,
    fromOutcome: null,
    toOutcome: booking.outcome,
    oldStartsAt: null,
    newStartsAt: booking.startsAt,
    occurredAt: now,
  });
  return { booking, created: true };
}

export async function createSessionBooking(
  repository: SessionBookingRepository,
  input: CreateSessionBookingInput,
): Promise<CreateSessionBookingResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    {
      kind: "create",
      producerId: input.producerId,
      projectId: input.projectId,
      purchaseId: input.purchaseId,
      sessionAllowanceId: input.sessionAllowanceId,
    },
    (transaction) =>
      createSessionBookingInTransaction(transaction, input, {
        rescheduledFromBookingId: null,
        transitionKind: "created",
      }),
  );
}

type BookingTransitionInput = Readonly<{
  bookingId: string;
  producerId?: string;
  actorClerkUserId: string;
  operationKey: string;
  now?: Date;
  reason?: string | null;
}>;

type BookingTransitionResult = Readonly<{
  booking: SessionBookingRecord;
  changed: boolean;
}>;

async function transitionSessionBooking(
  repository: SessionBookingRepository,
  input: BookingTransitionInput,
  spec: Readonly<{
    command: string;
    kind: Exclude<SessionBookingTransitionKind, "created" | "rescheduled">;
    actorKind: "artist" | "producer";
    assertAllowed: (context: SessionBookingContext, now: Date) => void;
    next: (context: SessionBookingContext) => Readonly<{
      status: SessionBookingStatus;
      outcome: SessionUseOutcome;
    }>;
    cancelPendingReplacement?: boolean;
  }>,
): Promise<BookingTransitionResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    {
      kind: "booking",
      bookingId: input.bookingId,
      ...(input.producerId ? { producerId: input.producerId } : {}),
    },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        ...(input.producerId ? { producerId: input.producerId } : {}),
        ...(spec.actorKind === "artist" ? { actorClerkUserId: input.actorClerkUserId } : {}),
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const digest = operationDigest(spec.command, {
        bookingId: input.bookingId,
        producerId: input.producerId ?? null,
        reason: input.reason?.trim() || null,
      });
      const replay = await transaction.findTransitionEvent(input.bookingId, input.operationKey);
      if (replay) {
        assertOperationReplay(replay, digest);
        return { booking: bookingAtTransition(context.booking, replay), changed: false };
      }

      const now = commandNow(input.now);
      spec.assertAllowed(context, now);
      const next = spec.next(context);
      const updated = await transaction.updateBooking({
        bookingId: context.booking.id,
        producerId: context.booking.producerId,
        expectedStatus: context.booking.status as "pending_approval" | "confirmed",
        status: next.status,
        outcome: next.outcome,
        occurredAt: now,
      });
      await transaction.insertTransitionEvent({
        bookingId: updated.id,
        producerId: updated.producerId,
        operationKey: input.operationKey,
        operationDigest: digest,
        kind: spec.kind,
        actorKind: spec.actorKind,
        actorId: input.actorClerkUserId,
        fromStatus: context.booking.status,
        toStatus: updated.status,
        fromOutcome: context.booking.outcome,
        toOutcome: updated.outcome,
        oldStartsAt: context.booking.startsAt,
        newStartsAt: null,
        occurredAt: now,
      });
      if (spec.cancelPendingReplacement) {
        const replacement = await transaction.findReplacementBooking(context.booking.id);
        if (replacement?.status === "pending_approval") {
          const cancelledReplacement = await transaction.updateBooking({
            bookingId: replacement.id,
            producerId: replacement.producerId,
            expectedStatus: "pending_approval",
            status: "cancelled",
            outcome: next.outcome,
            occurredAt: now,
          });
          await transaction.insertTransitionEvent({
            bookingId: cancelledReplacement.id,
            producerId: cancelledReplacement.producerId,
            operationKey: input.operationKey,
            operationDigest: digest,
            kind: spec.kind,
            actorKind: spec.actorKind,
            actorId: input.actorClerkUserId,
            fromStatus: replacement.status,
            toStatus: cancelledReplacement.status,
            fromOutcome: replacement.outcome,
            toOutcome: cancelledReplacement.outcome,
            oldStartsAt: replacement.startsAt,
            newStartsAt: null,
            occurredAt: now,
          });
        }
      }
      return { booking: updated, changed: true };
    },
  );
}

function assertPending(context: SessionBookingContext): void {
  if (context.booking.status !== "pending_approval") {
    throw new SessionBookingDomainError(
      "INVALID_STATUS",
      `A ${context.booking.status} booking cannot be approved or rejected`,
    );
  }
}

function assertHeldUnexpired(context: SessionBookingContext, now: Date): void {
  if (
    context.booking.status === "pending_approval" &&
    (context.booking.heldExpiresAt === null ||
      now.getTime() >= context.booking.heldExpiresAt.getTime())
  ) {
    throw new SessionBookingDomainError(
      "HELD_EXPIRED",
      "This held request has expired and cannot be changed",
    );
  }
}

export async function confirmSessionBooking(
  repository: SessionBookingRepository,
  input: BookingTransitionInput & { producerId: string },
): Promise<BookingTransitionResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId, producerId: input.producerId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        producerId: input.producerId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const digest = operationDigest("producer-confirm", {
        bookingId: input.bookingId,
        producerId: input.producerId,
        reason: input.reason?.trim() || null,
      });
      const replay = await transaction.findTransitionEvent(input.bookingId, input.operationKey);
      if (replay) {
        assertOperationReplay(replay, digest);
        return { booking: bookingAtTransition(context.booking, replay), changed: false };
      }
      const now = commandNow(input.now);
      assertPending(context);
      assertHeldUnexpired(context, now);
      if (
        context.purchase.lifecycleStatus !== "active" ||
        context.project.lifecycleStatus !== "active" ||
        context.allowance.closedAt !== null ||
        !context.allowance.bookingEnabledSnapshot
      ) {
        throw new SessionBookingDomainError(
          "PROJECT_INACTIVE",
          "The purchased session allowance is no longer active",
        );
      }
      const original =
        context.booking.rescheduledFromBookingId === null
          ? null
          : await transaction.loadBookingContext({
              bookingId: context.booking.rescheduledFromBookingId,
              producerId: context.booking.producerId,
            });
      if (context.booking.rescheduledFromBookingId !== null && original === null) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "The original session for this replacement was not found",
        );
      }
      if (
        original &&
        (original.booking.status !== "confirmed" ||
          original.booking.allowanceUseId !== context.booking.allowanceUseId)
      ) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "The original session is no longer available for this replacement",
        );
      }
      const updated = await transaction.updateBooking({
        bookingId: context.booking.id,
        producerId: context.booking.producerId,
        expectedStatus: "pending_approval",
        status: "confirmed",
        outcome: "reserved",
        occurredAt: now,
      });
      await transaction.insertTransitionEvent({
        bookingId: updated.id,
        producerId: updated.producerId,
        operationKey: input.operationKey,
        operationDigest: digest,
        kind: "confirmed",
        actorKind: "producer",
        actorId: input.actorClerkUserId,
        fromStatus: context.booking.status,
        toStatus: updated.status,
        fromOutcome: context.booking.outcome,
        toOutcome: updated.outcome,
        oldStartsAt: context.booking.startsAt,
        newStartsAt: null,
        occurredAt: now,
      });
      if (original) {
        const cancelledOriginal = await transaction.updateBooking({
          bookingId: original.booking.id,
          producerId: original.booking.producerId,
          expectedStatus: "confirmed",
          status: "cancelled",
          outcome: "cancelled_on_time",
          occurredAt: now,
        });
        await transaction.insertTransitionEvent({
          bookingId: cancelledOriginal.id,
          producerId: cancelledOriginal.producerId,
          operationKey: input.operationKey,
          operationDigest: digest,
          kind: "rescheduled",
          actorKind: "producer",
          actorId: input.actorClerkUserId,
          fromStatus: original.booking.status,
          toStatus: cancelledOriginal.status,
          fromOutcome: original.booking.outcome,
          toOutcome: cancelledOriginal.outcome,
          oldStartsAt: original.booking.startsAt,
          newStartsAt: updated.startsAt,
          occurredAt: now,
        });
      }
      return { booking: updated, changed: true };
    },
  );
}

export function rejectSessionBooking(
  repository: SessionBookingRepository,
  input: BookingTransitionInput & { producerId: string },
): Promise<BookingTransitionResult> {
  return transitionSessionBooking(repository, input, {
    command: "producer-reject",
    kind: "rejected",
    actorKind: "producer",
    assertAllowed: (context, now) => {
      assertPending(context);
      assertHeldUnexpired(context, now);
    },
    next: () => ({ status: "rejected", outcome: "cancelled_by_producer" }),
  });
}

export async function expireHeldSessionBooking(
  repository: SessionBookingRepository,
  input: Readonly<{
    bookingId: string;
    operationKey: string;
    now?: Date;
  }>,
): Promise<BookingTransitionResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({ bookingId: input.bookingId });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const digest = operationDigest("system-expire-held", {
        bookingId: input.bookingId,
        reason: "approval_timeout",
      });
      const replay = await transaction.findTransitionEvent(input.bookingId, input.operationKey);
      if (replay) {
        assertOperationReplay(replay, digest);
        return { booking: bookingAtTransition(context.booking, replay), changed: false };
      }
      assertPending(context);
      const now = commandNow(input.now);
      if (
        context.booking.heldExpiresAt === null ||
        now.getTime() < context.booking.heldExpiresAt.getTime()
      ) {
        throw new SessionBookingDomainError(
          "TOO_EARLY",
          "This held request has not reached its approval timeout",
        );
      }
      const updated = await transaction.updateBooking({
        bookingId: context.booking.id,
        producerId: context.booking.producerId,
        expectedStatus: "pending_approval",
        status: "cancelled",
        outcome: "cancelled_by_producer",
        occurredAt: now,
        heldExpiredAt: now,
        heldExpiryReason: "approval_timeout",
      });
      await transaction.insertTransitionEvent({
        bookingId: updated.id,
        producerId: updated.producerId,
        operationKey: input.operationKey,
        operationDigest: digest,
        kind: "producer_cancelled",
        actorKind: "system",
        actorId: null,
        fromStatus: context.booking.status,
        toStatus: updated.status,
        fromOutcome: context.booking.outcome,
        toOutcome: updated.outcome,
        oldStartsAt: context.booking.startsAt,
        newStartsAt: null,
        occurredAt: now,
      });
      return { booking: updated, changed: true };
    },
  );
}

export function cancelProducerSessionBooking(
  repository: SessionBookingRepository,
  input: BookingTransitionInput & { producerId: string },
): Promise<BookingTransitionResult> {
  return transitionSessionBooking(repository, input, {
    command: "producer-cancel",
    kind: "producer_cancelled",
    actorKind: "producer",
    assertAllowed: (context, now) => {
      assertActiveStatus(context.booking);
      assertHeldUnexpired(context, now);
    },
    next: () => ({ status: "cancelled", outcome: "cancelled_by_producer" }),
    cancelPendingReplacement: true,
  });
}

export function cancelArtistSessionBooking(
  repository: SessionBookingRepository,
  input: Omit<BookingTransitionInput, "producerId">,
): Promise<BookingTransitionResult> {
  return transitionSessionBooking(repository, input, {
    command: "artist-cancel",
    kind: "artist_cancelled",
    actorKind: "artist",
    assertAllowed: (context, now) => {
      assertActiveStatus(context.booking);
      if (context.booking.status === "pending_approval") {
        assertHeldUnexpired(context, now);
        if (now.getTime() >= context.booking.startsAt.getTime()) {
          throw new SessionBookingDomainError(
            "CANCELLATION_WINDOW",
            "This held request can no longer be withdrawn online",
          );
        }
        return;
      }
      if (
        artistCancellationOutcome({
          startsAt: context.booking.startsAt,
          now,
          cancellationPolicyHours: context.booking.cancellationPolicyHoursSnapshot,
        }) !== "cancelled_on_time"
      ) {
        throw new SessionBookingDomainError(
          "CANCELLATION_WINDOW",
          "This session is too close to cancel online",
        );
      }
    },
    next: () => ({ status: "cancelled", outcome: "cancelled_on_time" }),
    cancelPendingReplacement: true,
  });
}

export function recordLateArtistCancellation(
  repository: SessionBookingRepository,
  input: BookingTransitionInput & { producerId: string },
): Promise<BookingTransitionResult> {
  return transitionSessionBooking(repository, input, {
    command: "producer-record-late-artist-cancel",
    kind: "artist_cancelled",
    actorKind: "producer",
    assertAllowed: (context, now) => {
      assertActiveStatus(context.booking);
      if (
        artistCancellationOutcome({
          startsAt: context.booking.startsAt,
          now,
          cancellationPolicyHours: context.booking.cancellationPolicyHoursSnapshot,
        }) !== "cancelled_late"
      ) {
        throw new SessionBookingDomainError(
          "CANCELLATION_WINDOW",
          "An on-time artist cancellation must return the purchased session use",
        );
      }
    },
    next: () => ({ status: "cancelled", outcome: "cancelled_late" }),
  });
}

export function markSessionNoShow(
  repository: SessionBookingRepository,
  input: BookingTransitionInput & { producerId: string },
): Promise<BookingTransitionResult> {
  return transitionSessionBooking(repository, input, {
    command: "producer-no-show",
    kind: "no_show",
    actorKind: "producer",
    assertAllowed: ({ booking }, now) => {
      if (booking.status !== "confirmed") {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Only a confirmed session can be a no-show",
        );
      }
      if (now < booking.startsAt) {
        throw new SessionBookingDomainError("TOO_EARLY", "A future session cannot be a no-show");
      }
    },
    next: () => ({ status: "no_show", outcome: "no_show" }),
  });
}

export function completeSessionBooking(
  repository: SessionBookingRepository,
  input: BookingTransitionInput & { producerId: string },
): Promise<BookingTransitionResult> {
  return transitionSessionBooking(repository, input, {
    command: "producer-complete",
    kind: "completed",
    actorKind: "producer",
    assertAllowed: ({ booking }, now) => {
      if (booking.status !== "confirmed") {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Only a confirmed session can be completed",
        );
      }
      const endsAt = booking.startsAt.getTime() + booking.durationMin * 60 * 1000;
      if (now.getTime() < endsAt) {
        throw new SessionBookingDomainError(
          "TOO_EARLY",
          "A session cannot complete before it ends",
        );
      }
    },
    next: () => ({ status: "completed", outcome: "completed" }),
  });
}

export type RescheduleArtistSessionBookingInput = Readonly<{
  bookingId: string;
  actorClerkUserId: string;
  operationKey: string;
  now?: Date;
}> &
  SessionBookingRequestedStart;

export type RescheduleArtistSessionBookingResult = Readonly<{
  booking: SessionBookingRecord;
  replacedBooking: SessionBookingRecord;
  created: boolean;
}>;

export async function rescheduleArtistSessionBooking(
  repository: SessionBookingRepository,
  input: RescheduleArtistSessionBookingInput,
): Promise<RescheduleArtistSessionBookingResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        actorClerkUserId: input.actorClerkUserId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const digest = operationDigest("artist-reschedule", {
        bookingId: input.bookingId,
        ...requestedStartOperationIdentity(input),
        durationMin: context.booking.durationMin,
      });
      const replacementReplay = await transaction.findReplacementBooking(input.bookingId);
      if (replacementReplay) {
        assertOperationReplay(replacementReplay, digest);
        const replacementEvent = await transaction.findTransitionEvent(
          replacementReplay.id,
          input.operationKey,
        );
        if (!replacementEvent || replacementEvent.kind !== "rescheduled") {
          throw new SessionBookingDomainError(
            "OPERATION_KEY_CONFLICT",
            "The replacement is missing its immutable reschedule transition",
          );
        }
        assertOperationReplay(replacementEvent, digest);
        const originalEvent = await transaction.findTransitionEvent(
          input.bookingId,
          input.operationKey,
        );
        if (originalEvent) assertOperationReplay(originalEvent, digest);
        return {
          booking: bookingAtTransition(replacementReplay, replacementEvent),
          replacedBooking: originalEvent
            ? bookingAtTransition(context.booking, originalEvent)
            : context.booking,
          created: false,
        };
      }
      const orphanedReplay = await transaction.findTransitionEvent(
        input.bookingId,
        input.operationKey,
      );
      if (orphanedReplay) {
        throw new SessionBookingDomainError(
          "OPERATION_KEY_CONFLICT",
          "The stored reschedule transition is missing its replacement",
        );
      }
      const startsAt = requestedSessionStart(input, context.producer.timeZone);
      const now = commandNow(input.now);
      if (context.booking.status !== "confirmed") {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Only a confirmed session can be rescheduled",
        );
      }
      if (
        artistCancellationOutcome({
          startsAt: context.booking.startsAt,
          now,
          cancellationPolicyHours: context.booking.cancellationPolicyHoursSnapshot,
        }) !== "cancelled_on_time"
      ) {
        throw new SessionBookingDomainError(
          "CANCELLATION_WINDOW",
          "This session is too close to reschedule online",
        );
      }

      const replacementResult = await createSessionBookingInTransaction(
        transaction,
        {
          producerId: context.booking.producerId,
          projectId: context.booking.projectId,
          purchaseId: context.booking.purchaseId,
          sessionAllowanceId: context.booking.sessionAllowanceId,
          actorClerkUserId: input.actorClerkUserId,
          startsAt,
          durationMin: context.booking.durationMin,
          operationKey: input.operationKey,
          now,
        },
        {
          rescheduledFromBookingId: context.booking.id,
          allowanceUseId: context.booking.allowanceUseId,
          ignoredBookingId: context.booking.id,
          transitionKind: "rescheduled",
          operationDigestOverride: digest,
        },
      );
      if (!replacementResult.created) {
        throw new SessionBookingDomainError(
          "OPERATION_KEY_CONFLICT",
          "A replacement exists without its reschedule transition",
        );
      }
      let replaced = context.booking;
      if (replacementResult.booking.status === "confirmed") {
        replaced = await transaction.updateBooking({
          bookingId: context.booking.id,
          producerId: context.booking.producerId,
          expectedStatus: context.booking.status,
          status: "cancelled",
          outcome: "cancelled_on_time",
          occurredAt: now,
        });
        await transaction.insertTransitionEvent({
          bookingId: replaced.id,
          producerId: replaced.producerId,
          operationKey: input.operationKey,
          operationDigest: digest,
          kind: "rescheduled",
          actorKind: "artist",
          actorId: input.actorClerkUserId,
          fromStatus: context.booking.status,
          toStatus: replaced.status,
          fromOutcome: context.booking.outcome,
          toOutcome: replaced.outcome,
          oldStartsAt: context.booking.startsAt,
          newStartsAt: replacementResult.booking.startsAt,
          occurredAt: now,
        });
      }
      return {
        booking: replacementResult.booking,
        replacedBooking: replaced,
        created: true,
      };
    },
  );
}
