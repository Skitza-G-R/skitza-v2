import { createHash, randomUUID } from "node:crypto";
import type {
  CalendarOutboxPayloadSnapshot,
  CalendarSyncJobPayloadSnapshot,
  GoogleCalendarSyncJobPayloadSnapshot,
} from "@skitza/db";
import type { GoogleCalendarLinkedEventLookup } from "~/server/google-calendar";
import type {
  GoogleCalendarPreparedReconciliation,
  GoogleCalendarReconciliationApplyResult,
} from "~/server/calendar/google-reconciliation";
import {
  SessionBookingDomainError,
  assertSessionBookingAllowed,
  classifySessionSlot,
  generateProducerExactSessionSlots,
  sessionAllowanceCanBook,
  sessionStartFromLocalSlot,
  sessionUseConsumesAllowance,
} from "~/server/booking";
import type {
  ExactSessionSlotDay,
  SessionBusyInterval,
  SessionBookingBillingTreatment,
  SessionBookingScheduleEntry,
  SessionSlotActor,
  SessionUseOutcome,
} from "~/server/booking";

export {
  SessionBookingDomainError,
  assertSessionBookingAllowed,
  assertSessionSlotAvailable,
  classifySessionSlot,
  producerLocalDateKey,
  producerLocalDateKeys,
  producerLocalDateRange,
  sessionAllowanceCanBook,
  sessionAvailabilityHorizonDays,
  sessionBillingOptions,
  sessionStartFromLocalSlot,
  sessionUseConsumesAllowance,
  studioLocalDateKey,
  studioLocalDateTimeToUtc,
  studioLocalDateTimeUtcCandidates,
} from "~/server/booking";
export type {
  ClassifySessionSlotInput,
  SessionBillingOptions,
  SessionBookingBillingTreatment,
  SessionBusyInterval,
  SessionBookingErrorCode,
  SessionBookingScheduleEntry,
  SessionSlotActor,
  SessionSlotIssue,
  SessionSlotIssueCode,
  SessionUseOutcome,
} from "~/server/booking";

export type SessionBookingStatus =
  | "pending_approval"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "completed"
  | "no_show";

export type SessionBookingActorKind = "artist" | "producer" | "system";
export type SessionBookingOrigin = "legacy" | "artist_request" | "producer_manual";
export type SessionBookingArtistRsvpStatus = "needs_action" | "accepted" | "declined" | "tentative";
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
  title: string | null;
  origin: SessionBookingOrigin;
  billingTreatment: SessionBookingBillingTreatment;
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
  calendarRevision: number;
  artistRsvpStatus: SessionBookingArtistRsvpStatus | null;
  artistRsvpRespondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
    name: string;
    email: string;
    closedAt: Date | null;
    timeZone: string;
    autoConfirmBookings: boolean;
    cancellationPolicyHours: number;
    maxSessionsPerDay: number | null;
  }>;
  project: Readonly<{
    id: string;
    title: string;
    lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  }>;
  purchase: Readonly<{
    id: string;
    lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    defaultSessionTitle: string;
  }>;
  allowance: SessionBookingAllowance;
  artist: Readonly<{ clerkUserId: string | null; name: string; email: string }>;
  availabilityBlocks: readonly Readonly<{ weekday: number; startMin: number; endMin: number }>[];
  blackouts: readonly Readonly<{ startDate: string; endDate: string }>[];
}>;

export type SessionBookingContext = SessionBookingCreateContext &
  Readonly<{ booking: SessionBookingRecord }>;

export type NewSessionBookingRecord = Omit<
  SessionBookingRecord,
  "id" | "statusChangedAt" | "outcomeChangedAt" | "createdAt" | "updatedAt"
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

export type SessionBookingChangeRequestKind = "cancel" | "reschedule";
export type SessionBookingChangeRequestStatus = "pending" | "approved" | "rejected";
export type SessionBookingChangeRequestRecord = Readonly<{
  id: string;
  bookingId: string;
  producerId: string;
  kind: SessionBookingChangeRequestKind;
  status: SessionBookingChangeRequestStatus;
  proposedStartsAt: Date | null;
  requestOperationKey: string;
  requestOperationDigest: string;
  requestedByClerkUserId: string;
  requestedAt: Date;
  decisionOperationKey: string | null;
  decisionOperationDigest: string | null;
  decidedByClerkUserId: string | null;
  decidedAt: Date | null;
  replacementBookingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type NewSessionBookingChangeRequestRecord = Omit<
  SessionBookingChangeRequestRecord,
  "id" | "createdAt" | "updatedAt"
> &
  Readonly<{ occurredAt: Date }>;

export type CalendarSyncJobRecord = Readonly<{
  id: string;
  bookingId: string;
  producerId: string;
  deliveryChannel: "ics" | "google";
  bookingCalendarLinkId: string | null;
  operation: "send_ics" | "upsert_google_event" | "delete_google_event" | "reconcile_google_event";
  desiredRevision: number;
  idempotencyKey: string;
  payloadSnapshot: CalendarOutboxPayloadSnapshot;
  manualRetryCount: number;
  lastManualRetryAt: Date | null;
  lastManualRetryActor: string | null;
  lastManualRetryOperationKey: string | null;
  lastManualRetryOperationDigest: string | null;
}>;

export type NewCalendarSyncJobRecord = Omit<
  CalendarSyncJobRecord,
  | "id"
  | "manualRetryCount"
  | "lastManualRetryAt"
  | "lastManualRetryActor"
  | "lastManualRetryOperationKey"
  | "lastManualRetryOperationDigest"
> &
  Readonly<{
    occurredAt: Date;
    manualRetryCount?: number;
    lastManualRetryAt?: Date;
    lastManualRetryOperationKey?: string;
    lastManualRetryOperationDigest?: string;
    lastManualRetryActor?: string;
  }>;

export type SessionBookingGoogleCalendarSyncStatus =
  | "synced"
  | "pending"
  | "not_synced"
  | "missing"
  | "conflict"
  | "disconnected";

export const GOOGLE_CALENDAR_SYNC_STATUS_BATCH_LIMIT = 200;

export type SessionBookingGoogleCalendarSyncStatusEntry = Readonly<{
  bookingId: string;
  status: SessionBookingGoogleCalendarSyncStatus;
}>;

export type BookingCalendarLinkRecord = Readonly<{
  id: string;
  producerId: string;
  allowanceUseId: string;
  currentBookingId: string;
  connectionId: string;
  accountVersion: number;
  desiredRevision: number;
  providerEventEtag: string | null;
  providerEventUpdatedAt: Date | null;
  providerState: "uncreated" | "active" | "deleted";
  syncState: SessionBookingGoogleCalendarSyncStatus;
  syncStateChangedAt: Date;
  lastInboundReconciledAt: Date | null;
  lastSyncErrorCode:
    | "provider_unavailable"
    | "rate_limited"
    | "permission_denied"
    | "reconnect_required"
    | "invalid_provider_event"
    | "stale_skitza_revision"
    | "skitza_overlap"
    | "watch_create_failed"
    | "watch_renew_failed"
    | "watch_stop_failed"
    | "reconciliation_failed"
    | "unknown"
    | null;
}>;

export type SessionBookingGoogleReconciliationContext = Readonly<{
  link: BookingCalendarLinkRecord;
  currentBookingId: string;
  capturedRevision: number;
}>;

export type SessionBookingAtomicScope =
  | Readonly<{
      kind: "create";
      producerId: string;
      projectId: string;
      purchaseId: string;
      sessionAllowanceId: string;
    }>
  | Readonly<{ kind: "booking"; bookingId: string; producerId?: string }>
  | Readonly<{ kind: "change_request"; requestId: string; producerId: string }>;

export interface SessionBookingTransaction {
  loadCreateContext(input: {
    producerId: string;
    projectId: string;
    purchaseId: string;
    sessionAllowanceId: string;
    actorClerkUserId: string;
  }): Promise<SessionBookingCreateContext | null>;
  loadProducerManualCreateContext(input: {
    producerId: string;
    clientContactId: string;
    projectId: string;
    purchaseId: string;
    sessionAllowanceId: string;
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
  loadChangeRequest(input: {
    requestId: string;
    producerId?: string;
  }): Promise<SessionBookingChangeRequestRecord | null>;
  findChangeRequestByOperationKey(
    bookingId: string,
    operationKey: string,
  ): Promise<SessionBookingChangeRequestRecord | null>;
  findPendingChangeRequest(bookingId: string): Promise<SessionBookingChangeRequestRecord | null>;
  listAllowanceUses(
    producerId: string,
    sessionAllowanceId: string,
  ): Promise<
    readonly Readonly<{
      bookingId: string;
      allowanceUseId: string;
      outcome: SessionUseOutcome;
      billingTreatment: SessionBookingBillingTreatment;
    }>[]
  >;
  listScheduleEntries(producerId: string): Promise<readonly SessionBookingScheduleEntry[]>;
  loadGoogleCalendarReconciliationContext(input: {
    jobId: string;
    producerId: string;
    bookingCalendarLinkId: string;
    leaseToken: string;
  }): Promise<SessionBookingGoogleReconciliationContext | null>;
  loadBookingCalendarRecoveryLink(input: {
    bookingId: string;
    producerId: string;
  }): Promise<BookingCalendarLinkRecord | null>;
  findGoogleCalendarRecoveryJob(input: {
    producerId: string;
    bookingCalendarLinkId: string;
    operationKey: string;
  }): Promise<CalendarSyncJobRecord | null>;
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
  updateBookingCalendarProjection(input: {
    bookingId: string;
    producerId: string;
    expectedCalendarRevision: number;
    nextCalendarRevision: number;
    title?: string | null;
    artistRsvpStatus?: SessionBookingArtistRsvpStatus | null;
    artistRsvpRespondedAt?: Date | null;
    occurredAt: Date;
  }): Promise<SessionBookingRecord>;
  insertTransitionEvent(
    input: SessionBookingTransitionEventDraft,
  ): Promise<StoredSessionBookingTransitionEvent>;
  insertChangeRequest(
    input: NewSessionBookingChangeRequestRecord,
  ): Promise<SessionBookingChangeRequestRecord>;
  decideChangeRequest(input: {
    requestId: string;
    producerId: string;
    status: "approved" | "rejected";
    decisionOperationKey: string;
    decisionOperationDigest: string;
    decidedByClerkUserId: string;
    decidedAt: Date;
    replacementBookingId: string | null;
  }): Promise<SessionBookingChangeRequestRecord>;
  findCalendarSyncJob(input: {
    uid: string;
    desiredRevision: number;
  }): Promise<CalendarSyncJobRecord | null>;
  findGoogleCalendarSyncJob(input: {
    producerId: string;
    bookingCalendarLinkId: string;
    desiredRevision: number;
  }): Promise<CalendarSyncJobRecord | null>;
  findCalendarSyncJobForEvent(input: {
    bookingId: string;
    producerId: string;
    occurredAt: Date;
    intent: "opaque_hold" | "confirmed" | "delete";
  }): Promise<CalendarSyncJobRecord | null>;
  prepareBookingCalendarLink(input: {
    bookingId: string;
    producerId: string;
    allowanceUseId: string;
    desiredRevision: number;
    allowCreate: boolean;
    occurredAt: Date;
  }): Promise<BookingCalendarLinkRecord | null>;
  advanceGoogleCalendarLink(input: {
    linkId: string;
    producerId: string;
    expectedCurrentBookingId: string;
    expectedDesiredRevision: number;
    currentBookingId: string;
    desiredRevision: number;
    syncState: SessionBookingGoogleCalendarSyncStatus;
    lastSyncErrorCode: BookingCalendarLinkRecord["lastSyncErrorCode"];
    providerEventEtag?: string;
    providerEventUpdatedAt?: Date;
    lastInboundReconciledAt?: Date;
    occurredAt: Date;
  }): Promise<BookingCalendarLinkRecord>;
  completeGoogleCalendarReconciliationJob(input: {
    jobId: string;
    producerId: string;
    bookingCalendarLinkId: string;
    capturedRevision: number;
    leaseToken: string;
    completedAt: Date;
  }): Promise<boolean>;
  insertCalendarSyncJob(input: NewCalendarSyncJobRecord): Promise<CalendarSyncJobRecord>;
}

export interface SessionBookingRepository {
  findBookingGoogleCalendarSyncStatuses(input: {
    bookingIds: readonly string[];
    producerId: string;
  }): Promise<readonly SessionBookingGoogleCalendarSyncStatusEntry[]>;
  findProducerManualSessionBookingByOperationKey(input: {
    producerId: string;
    operationKey: string;
  }): Promise<Readonly<{
    booking: SessionBookingRecord;
    event: StoredSessionBookingTransitionEvent | null;
    calendarSyncJobId: string | null;
  }> | null>;
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

function icsCalendarSyncPayload(input: {
  context: SessionBookingCreateContext;
  booking: SessionBookingRecord;
  method: "REQUEST" | "CANCEL";
  occurredAt: Date;
}): CalendarSyncJobPayloadSnapshot {
  const producerName = input.context.producer.name.trim() || "Skitza producer";
  return {
    schemaVersion: 1,
    method: input.method,
    uid: `booking-${input.booking.allowanceUseId}@skitza.app`,
    sequence: input.booking.calendarRevision,
    dtstampUtc: input.occurredAt.toISOString(),
    startsAtUtc: input.booking.startsAt.toISOString(),
    endsAtUtc: new Date(
      input.booking.startsAt.getTime() + input.booking.durationMin * 60 * 1000,
    ).toISOString(),
    summary: input.booking.title?.trim() || input.context.purchase.defaultSessionTitle,
    description: "A confirmed Skitza session.",
    organizer: { name: producerName, email: input.context.producer.email },
    attendee: { name: input.booking.artistName, email: input.booking.artistEmail },
  };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function calendarPayloadDigest(payload: CalendarOutboxPayloadSnapshot): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalJson(payload)), "utf8")
    .digest("hex")}`;
}

async function enqueueIcsCalendarSyncJob(
  transaction: SessionBookingTransaction,
  context: SessionBookingCreateContext,
  booking: SessionBookingRecord,
  method: "REQUEST" | "CANCEL",
  occurredAt: Date,
): Promise<CalendarSyncJobRecord> {
  const payloadSnapshot = icsCalendarSyncPayload({ context, booking, method, occurredAt });
  const existing = await transaction.findCalendarSyncJob({
    uid: payloadSnapshot.uid,
    desiredRevision: booking.calendarRevision,
  });
  const idempotencyKey = `calendar:send_ics:${payloadSnapshot.uid}:${String(booking.calendarRevision)}`;
  if (existing) {
    if (
      existing.bookingId !== booking.id ||
      existing.producerId !== booking.producerId ||
      existing.deliveryChannel !== "ics" ||
      existing.bookingCalendarLinkId !== null ||
      existing.operation !== "send_ics" ||
      existing.idempotencyKey !== idempotencyKey ||
      calendarPayloadDigest(existing.payloadSnapshot) !== calendarPayloadDigest(payloadSnapshot)
    ) {
      throw new SessionBookingDomainError(
        "OPERATION_KEY_CONFLICT",
        "This calendar revision already belongs to a different delivery command",
      );
    }
    return existing;
  }
  return transaction.insertCalendarSyncJob({
    bookingId: booking.id,
    producerId: booking.producerId,
    deliveryChannel: "ics",
    bookingCalendarLinkId: null,
    operation: "send_ics",
    desiredRevision: booking.calendarRevision,
    idempotencyKey,
    payloadSnapshot,
    occurredAt,
  });
}

type BookingCalendarIntent = "opaque_hold" | "confirmed" | "delete_hold" | "delete_confirmed";

function confirmedGoogleCalendarSummary(
  context: SessionBookingCreateContext,
  booking: SessionBookingRecord,
): string {
  const projectName = context.project.title.trim() || "Session";
  const producerName = context.producer.name.trim() || "Skitza producer";
  const artistName = booking.artistName.trim() || context.artist.name.trim() || "Artist";
  return `${projectName} · ${producerName} & ${artistName}`;
}

function googleCalendarSyncPayload(input: {
  link: BookingCalendarLinkRecord;
  context: SessionBookingCreateContext;
  booking: SessionBookingRecord;
  intent: BookingCalendarIntent;
  notificationMode?: "none" | "all";
}): GoogleCalendarSyncJobPayloadSnapshot {
  const privateProperties = {
    skitzaLink: input.link.id,
    skitzaRevision: String(input.booking.calendarRevision),
    skitzaSchema: "1" as const,
  };
  if (input.intent === "delete_hold" || input.intent === "delete_confirmed") {
    return {
      schemaVersion: 2,
      action: "delete",
      notificationMode:
        input.notificationMode ?? (input.intent === "delete_confirmed" ? "all" : "none"),
      sequence: input.booking.calendarRevision,
      privateProperties,
    };
  }

  const confirmed = input.intent === "confirmed";
  return {
    schemaVersion: 2,
    action: "upsert",
    eventKind: confirmed ? "confirmed" : "opaque_hold",
    notificationMode: input.notificationMode ?? (confirmed ? "all" : "none"),
    sequence: input.booking.calendarRevision,
    startsAtUtc: input.booking.startsAt.toISOString(),
    endsAtUtc: new Date(
      input.booking.startsAt.getTime() + input.booking.durationMin * 60 * 1000,
    ).toISOString(),
    summary: confirmed ? confirmedGoogleCalendarSummary(input.context, input.booking) : "Reserved",
    artistSafeUrl: confirmed ? `https://skitza.app/artist/sessions/${input.booking.id}` : null,
    attendee: confirmed
      ? { name: input.booking.artistName, email: input.booking.artistEmail }
      : null,
    privateProperties,
  };
}

async function enqueueBookingCalendarJob(
  transaction: SessionBookingTransaction,
  context: SessionBookingCreateContext,
  booking: SessionBookingRecord,
  intent: BookingCalendarIntent,
  occurredAt: Date,
): Promise<CalendarSyncJobRecord | null> {
  const deleting = intent === "delete_hold" || intent === "delete_confirmed";
  const link = await transaction.prepareBookingCalendarLink({
    bookingId: booking.id,
    producerId: booking.producerId,
    allowanceUseId: booking.allowanceUseId,
    desiredRevision: booking.calendarRevision,
    allowCreate: !deleting,
    occurredAt,
  });
  if (!link) {
    if (intent === "confirmed") {
      return enqueueIcsCalendarSyncJob(transaction, context, booking, "REQUEST", occurredAt);
    }
    if (intent === "delete_confirmed") {
      return enqueueIcsCalendarSyncJob(transaction, context, booking, "CANCEL", occurredAt);
    }
    return null;
  }

  const operation = deleting ? "delete_google_event" : "upsert_google_event";
  const payloadSnapshot = googleCalendarSyncPayload({ link, context, booking, intent });
  const existing = await transaction.findGoogleCalendarSyncJob({
    producerId: booking.producerId,
    bookingCalendarLinkId: link.id,
    desiredRevision: booking.calendarRevision,
  });
  const idempotencyKey = `google:${operation}:${link.id}:r${String(booking.calendarRevision)}`;
  if (existing) {
    if (
      existing.bookingId !== booking.id ||
      existing.producerId !== booking.producerId ||
      existing.deliveryChannel !== "google" ||
      existing.bookingCalendarLinkId !== link.id ||
      existing.operation !== operation ||
      existing.idempotencyKey !== idempotencyKey ||
      calendarPayloadDigest(existing.payloadSnapshot) !== calendarPayloadDigest(payloadSnapshot)
    ) {
      throw new SessionBookingDomainError(
        "OPERATION_KEY_CONFLICT",
        "This calendar revision already belongs to a different delivery command",
      );
    }
    return existing;
  }

  return transaction.insertCalendarSyncJob({
    bookingId: booking.id,
    producerId: booking.producerId,
    deliveryChannel: "google",
    bookingCalendarLinkId: link.id,
    operation,
    desiredRevision: booking.calendarRevision,
    idempotencyKey,
    payloadSnapshot,
    occurredAt,
  });
}

async function enqueueGoogleCalendarCorrection(
  transaction: SessionBookingTransaction,
  context: SessionBookingCreateContext,
  booking: SessionBookingRecord,
  link: BookingCalendarLinkRecord,
  occurredAt: Date,
  recovery?: Readonly<{
    operationKey: string;
    operationDigest: string;
    actorClerkUserId: string;
  }>,
): Promise<CalendarSyncJobRecord> {
  const operation = "upsert_google_event" as const;
  const payloadSnapshot = googleCalendarSyncPayload({
    link,
    context,
    booking,
    intent: "confirmed",
    notificationMode: "none",
  });
  const idempotencyKey = `google:${operation}:${link.id}:r${String(booking.calendarRevision)}`;
  const existing = await transaction.findGoogleCalendarSyncJob({
    producerId: booking.producerId,
    bookingCalendarLinkId: link.id,
    desiredRevision: booking.calendarRevision,
  });
  if (existing) {
    if (
      existing.bookingId !== booking.id ||
      existing.operation !== operation ||
      existing.idempotencyKey !== idempotencyKey ||
      calendarPayloadDigest(existing.payloadSnapshot) !== calendarPayloadDigest(payloadSnapshot)
    ) {
      throw new SessionBookingDomainError(
        "OPERATION_KEY_CONFLICT",
        "This calendar correction already belongs to another booking state",
      );
    }
    return existing;
  }
  return transaction.insertCalendarSyncJob({
    bookingId: booking.id,
    producerId: booking.producerId,
    deliveryChannel: "google",
    bookingCalendarLinkId: link.id,
    operation,
    desiredRevision: booking.calendarRevision,
    idempotencyKey,
    payloadSnapshot,
    occurredAt,
    ...(recovery
      ? {
          manualRetryCount: 1,
          lastManualRetryAt: occurredAt,
          lastManualRetryActor: recovery.actorClerkUserId,
          lastManualRetryOperationKey: recovery.operationKey,
          lastManualRetryOperationDigest: recovery.operationDigest,
        }
      : {}),
  });
}

function hasCoreSkitzaOverlap(
  entries: readonly SessionBookingScheduleEntry[],
  input: Readonly<{
    startsAt: Date;
    durationMin: number;
    ignoreBookingId: string;
  }>,
): boolean {
  const requestedStart = input.startsAt.getTime();
  const requestedEnd = requestedStart + input.durationMin * 60 * 1_000;
  return entries.some((entry) => {
    if (entry.id === input.ignoreBookingId) return false;
    const existingStart = entry.startsAt.getTime();
    const existingEnd = existingStart + entry.durationMin * 60 * 1_000;
    return requestedStart < existingEnd && existingStart < requestedEnd;
  });
}

function rsvpProjection(
  booking: SessionBookingRecord,
  status: SessionBookingArtistRsvpStatus | null,
  respondedAt: Date,
): Readonly<{
  changed: boolean;
  artistRsvpStatus: SessionBookingArtistRsvpStatus | null;
  artistRsvpRespondedAt: Date | null;
}> {
  if (booking.artistRsvpStatus === status) {
    return {
      changed: false,
      artistRsvpStatus: booking.artistRsvpStatus,
      artistRsvpRespondedAt: booking.artistRsvpRespondedAt,
    };
  }
  return {
    changed: true,
    artistRsvpStatus: status,
    artistRsvpRespondedAt:
      status === null || status === "needs_action" ? null : new Date(respondedAt),
  };
}

export async function applyGoogleCalendarSessionReconciliation(
  repository: SessionBookingRepository,
  prepared: GoogleCalendarPreparedReconciliation,
  lookup: GoogleCalendarLinkedEventLookup,
  input: Readonly<{ leaseToken: string; reconciledAt: Date }>,
): Promise<GoogleCalendarReconciliationApplyResult> {
  return repository.atomically(
    {
      kind: "booking",
      bookingId: prepared.currentBookingId,
      producerId: prepared.job.producerId,
    },
    async (transaction) => {
      const reconciliation = await transaction.loadGoogleCalendarReconciliationContext({
        jobId: prepared.job.id,
        producerId: prepared.job.producerId,
        bookingCalendarLinkId: prepared.job.bookingCalendarLinkId,
        leaseToken: input.leaseToken,
      });
      if (!reconciliation) return { outcome: "lease_lost" };
      const context = await transaction.loadBookingContext({
        bookingId: reconciliation.currentBookingId,
        producerId: prepared.job.producerId,
      });
      if (!context) return { outcome: "lease_lost" };
      const originalLink = reconciliation.link;
      const booking = context.booking;
      const concurrentSkitzaChange =
        reconciliation.capturedRevision !== originalLink.desiredRevision ||
        prepared.currentBookingId !== originalLink.currentBookingId ||
        prepared.link.desiredRevision !== originalLink.desiredRevision ||
        prepared.link.providerEventEtag !== originalLink.providerEventEtag;

      const advanceLink = async (
        values: Readonly<{
          booking: SessionBookingRecord;
          syncState: SessionBookingGoogleCalendarSyncStatus;
          lastSyncErrorCode: BookingCalendarLinkRecord["lastSyncErrorCode"];
          event?: Readonly<{ etag: string; updatedAt: Date }>;
        }>,
      ) =>
        transaction.advanceGoogleCalendarLink({
          linkId: originalLink.id,
          producerId: originalLink.producerId,
          expectedCurrentBookingId: originalLink.currentBookingId,
          expectedDesiredRevision: originalLink.desiredRevision,
          currentBookingId: values.booking.id,
          desiredRevision: values.booking.calendarRevision,
          syncState: values.syncState,
          lastSyncErrorCode: values.lastSyncErrorCode,
          ...(values.event
            ? {
                providerEventEtag: values.event.etag,
                providerEventUpdatedAt: values.event.updatedAt,
              }
            : {}),
          lastInboundReconciledAt: input.reconciledAt,
          occurredAt: input.reconciledAt,
        });

      const complete = async () => {
        const completed = await transaction.completeGoogleCalendarReconciliationJob({
          jobId: prepared.job.id,
          producerId: prepared.job.producerId,
          bookingCalendarLinkId: prepared.job.bookingCalendarLinkId,
          capturedRevision: reconciliation.capturedRevision,
          leaseToken: input.leaseToken,
          completedAt: input.reconciledAt,
        });
        if (!completed) {
          throw new SessionBookingDomainError(
            "INVALID_STATUS",
            "The Google Calendar reconciliation lease changed",
          );
        }
      };

      if (lookup.outcome === "missing") {
        await advanceLink({
          booking,
          syncState: concurrentSkitzaChange ? "conflict" : "missing",
          lastSyncErrorCode: concurrentSkitzaChange ? "stale_skitza_revision" : null,
        });
        await complete();
        return { outcome: concurrentSkitzaChange ? "conflict" : "missing" };
      }

      if (lookup.outcome === "not_modified") {
        const preserveProblem =
          originalLink.syncState === "missing" || originalLink.syncState === "conflict";
        await advanceLink({
          booking,
          syncState: concurrentSkitzaChange
            ? "conflict"
            : preserveProblem
              ? originalLink.syncState
              : "synced",
          lastSyncErrorCode: concurrentSkitzaChange
            ? "stale_skitza_revision"
            : preserveProblem
              ? originalLink.lastSyncErrorCode
              : null,
        });
        await complete();
        return { outcome: concurrentSkitzaChange ? "conflict" : "unchanged" };
      }

      if (!("event" in lookup)) return { outcome: "lease_lost" };
      const event = lookup.event;
      const linkage = event.linkage;
      if (
        event.eventId !== prepared.link.providerEventId ||
        linkage === null ||
        linkage.opaqueLink !== originalLink.id
      ) {
        await advanceLink({
          booking,
          syncState: "not_synced",
          lastSyncErrorCode: "invalid_provider_event",
        });
        await complete();
        return { outcome: "conflict" };
      }

      if (event.status === "cancelled") {
        await advanceLink({ booking, syncState: "missing", lastSyncErrorCode: null });
        await complete();
        return { outcome: "missing" };
      }

      const providerFactsRegressed =
        originalLink.providerEventUpdatedAt !== null &&
        event.updatedAt.getTime() < originalLink.providerEventUpdatedAt.getTime();
      if (
        concurrentSkitzaChange ||
        booking.status !== "confirmed" ||
        linkage.revision !== reconciliation.capturedRevision ||
        providerFactsRegressed
      ) {
        await advanceLink({
          booking,
          syncState: "conflict",
          lastSyncErrorCode: "stale_skitza_revision",
          ...(prepared.link.providerEventEtag === originalLink.providerEventEtag &&
          !providerFactsRegressed
            ? { event: { etag: event.etag, updatedAt: event.updatedAt } }
            : {}),
        });
        await complete();
        return { outcome: "conflict" };
      }

      const rsvp = rsvpProjection(booking, event.artistRsvp, event.updatedAt);
      const titleNeedsCorrection =
        event.summary !== confirmedGoogleCalendarSummary(context, booking);

      const correctBooking = async (
        correction: Readonly<{
          syncState: "pending" | "conflict" | "not_synced";
          errorCode: BookingCalendarLinkRecord["lastSyncErrorCode"];
          title?: string | null;
        }>,
      ) => {
        const updated = await transaction.updateBookingCalendarProjection({
          bookingId: booking.id,
          producerId: booking.producerId,
          expectedCalendarRevision: booking.calendarRevision,
          nextCalendarRevision: booking.calendarRevision + 1,
          ...(Object.prototype.hasOwnProperty.call(correction, "title")
            ? { title: correction.title ?? null }
            : {}),
          ...(rsvp.changed
            ? {
                artistRsvpStatus: rsvp.artistRsvpStatus,
                artistRsvpRespondedAt: rsvp.artistRsvpRespondedAt,
              }
            : {}),
          occurredAt: input.reconciledAt,
        });
        const link = await advanceLink({
          booking: updated,
          syncState: correction.syncState,
          lastSyncErrorCode: correction.errorCode,
          event: { etag: event.etag, updatedAt: event.updatedAt },
        });
        await enqueueGoogleCalendarCorrection(
          transaction,
          context,
          updated,
          link,
          input.reconciledAt,
        );
        await complete();
      };

      if (event.timing.kind === "unsupported") {
        await correctBooking({
          syncState: "not_synced",
          errorCode: "invalid_provider_event",
        });
        return { outcome: "corrected" };
      }

      const moved = event.timing.startsAt.getTime() !== booking.startsAt.getTime();
      const canonicalRemoteEnd = new Date(
        event.timing.startsAt.getTime() + booking.durationMin * 60 * 1_000,
      );
      const resized = event.timing.endsAt.getTime() !== canonicalRemoteEnd.getTime();

      if (moved) {
        const overlaps = hasCoreSkitzaOverlap(
          await transaction.listScheduleEntries(booking.producerId),
          {
            startsAt: event.timing.startsAt,
            durationMin: booking.durationMin,
            ignoreBookingId: booking.id,
          },
        );
        if (overlaps) {
          await correctBooking({
            syncState: "conflict",
            errorCode: "skitza_overlap",
          });
          return { outcome: "conflict" };
        }

        const operationKey = `google-reconcile:${prepared.job.id}`;
        const digest = operationDigest("google-calendar-move", {
          bookingId: booking.id,
          startsAt: event.timing.startsAt.toISOString(),
          title: booking.title,
          providerUpdatedAt: event.updatedAt.toISOString(),
        });
        const replacement = await transaction.insertBooking({
          producerId: booking.producerId,
          projectId: booking.projectId,
          purchaseId: booking.purchaseId,
          sessionAllowanceId: booking.sessionAllowanceId,
          title: booking.title,
          origin: booking.origin,
          billingTreatment: booking.billingTreatment,
          artistName: booking.artistName,
          artistEmail: booking.artistEmail,
          startsAt: event.timing.startsAt,
          durationMin: booking.durationMin,
          operationKey,
          operationDigest: digest,
          rescheduledFromBookingId: booking.id,
          allowanceUseId: booking.allowanceUseId,
          cancellationPolicyHoursSnapshot: context.producer.cancellationPolicyHours,
          cancellationPolicySnapshottedAt: input.reconciledAt,
          cancellationPolicyBackfilled: false,
          heldExpiresAt: null,
          heldExpiredAt: null,
          heldExpiryReason: null,
          status: "confirmed",
          outcome: "reserved",
          calendarRevision: booking.calendarRevision + 1,
          artistRsvpStatus: rsvp.artistRsvpStatus,
          artistRsvpRespondedAt: rsvp.artistRsvpRespondedAt,
          occurredAt: input.reconciledAt,
        });
        await transaction.insertTransitionEvent({
          bookingId: replacement.id,
          producerId: replacement.producerId,
          operationKey,
          operationDigest: digest,
          kind: "rescheduled",
          actorKind: "system",
          actorId: null,
          fromStatus: null,
          toStatus: replacement.status,
          fromOutcome: null,
          toOutcome: replacement.outcome,
          oldStartsAt: null,
          newStartsAt: replacement.startsAt,
          occurredAt: input.reconciledAt,
        });
        const replaced = await transaction.updateBooking({
          bookingId: booking.id,
          producerId: booking.producerId,
          expectedStatus: "confirmed",
          status: "cancelled",
          outcome: "cancelled_on_time",
          occurredAt: input.reconciledAt,
        });
        await transaction.insertTransitionEvent({
          bookingId: replaced.id,
          producerId: replaced.producerId,
          operationKey,
          operationDigest: digest,
          kind: "rescheduled",
          actorKind: "system",
          actorId: null,
          fromStatus: booking.status,
          toStatus: replaced.status,
          fromOutcome: booking.outcome,
          toOutcome: replaced.outcome,
          oldStartsAt: booking.startsAt,
          newStartsAt: replacement.startsAt,
          occurredAt: input.reconciledAt,
        });
        const link = await advanceLink({
          booking: replacement,
          syncState: "pending",
          lastSyncErrorCode: null,
          event: { etag: event.etag, updatedAt: event.updatedAt },
        });
        await enqueueGoogleCalendarCorrection(
          transaction,
          context,
          replacement,
          link,
          input.reconciledAt,
        );
        await complete();
        return { outcome: "corrected" };
      }

      if (resized || titleNeedsCorrection) {
        await correctBooking({
          syncState: "pending",
          errorCode: null,
        });
        return { outcome: "corrected" };
      }

      let current = booking;
      if (rsvp.changed) {
        current = await transaction.updateBookingCalendarProjection({
          bookingId: booking.id,
          producerId: booking.producerId,
          expectedCalendarRevision: booking.calendarRevision,
          nextCalendarRevision: booking.calendarRevision,
          artistRsvpStatus: rsvp.artistRsvpStatus,
          artistRsvpRespondedAt: rsvp.artistRsvpRespondedAt,
          occurredAt: input.reconciledAt,
        });
      }
      await advanceLink({
        booking: current,
        syncState: "synced",
        lastSyncErrorCode: null,
        event: { etag: event.etag, updatedAt: event.updatedAt },
      });
      await complete();
      return { outcome: rsvp.changed ? "reconciled" : "unchanged" };
    },
  );
}

export async function getSessionBookingGoogleCalendarSyncStatuses(
  repository: SessionBookingRepository,
  input: Readonly<{ bookingIds: readonly string[]; producerId: string }>,
): Promise<readonly SessionBookingGoogleCalendarSyncStatusEntry[]> {
  const bookingIds = [...new Set(input.bookingIds)];
  if (bookingIds.length > GOOGLE_CALENDAR_SYNC_STATUS_BATCH_LIMIT) {
    throw new SessionBookingDomainError(
      "INVALID_SLOT",
      "Too many session calendar statuses were requested",
    );
  }
  if (bookingIds.length === 0) return [];
  return repository.findBookingGoogleCalendarSyncStatuses({
    bookingIds,
    producerId: input.producerId,
  });
}

export type RecoverSessionBookingGoogleCalendarSyncResult = Readonly<{
  status: SessionBookingGoogleCalendarSyncStatus;
  replayed: boolean;
}>;

async function requestSessionBookingGoogleCalendarCorrection(
  repository: SessionBookingRepository,
  input: Readonly<{
    bookingId: string;
    producerId: string;
    actorClerkUserId: string;
    operationKey: string;
    kind: "retry" | "restore";
    now?: Date;
  }>,
): Promise<RecoverSessionBookingGoogleCalendarSyncResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId, producerId: input.producerId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        producerId: input.producerId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const link = await transaction.loadBookingCalendarRecoveryLink({
        bookingId: input.bookingId,
        producerId: input.producerId,
      });
      if (!link) {
        throw new SessionBookingDomainError(
          "NOT_FOUND",
          "This session does not have an active Google Calendar link",
        );
      }
      const digest = operationDigest(`google-calendar-${input.kind}`, {
        bookingId: input.bookingId,
        producerId: input.producerId,
        linkId: link.id,
      });
      const replay = await transaction.findGoogleCalendarRecoveryJob({
        producerId: input.producerId,
        bookingCalendarLinkId: link.id,
        operationKey: input.operationKey,
      });
      if (replay) {
        assertOperationReplay(
          { operationDigest: replay.lastManualRetryOperationDigest ?? "" },
          digest,
        );
        return { status: link.syncState, replayed: true };
      }
      if (context.booking.status !== "confirmed") {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Only a confirmed session can be restored in Google Calendar",
        );
      }
      if (input.kind === "restore" && link.syncState !== "missing") {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "This Google Calendar event is not missing",
        );
      }
      if (
        input.kind === "retry" &&
        link.syncState !== "not_synced" &&
        link.syncState !== "conflict"
      ) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "This Google Calendar event is not ready to retry",
        );
      }
      const now = commandNow(input.now);
      const booking = await transaction.updateBookingCalendarProjection({
        bookingId: context.booking.id,
        producerId: context.booking.producerId,
        expectedCalendarRevision: context.booking.calendarRevision,
        nextCalendarRevision: context.booking.calendarRevision + 1,
        occurredAt: now,
      });
      const nextState =
        link.syncState === "missing" || link.syncState === "conflict" ? link.syncState : "pending";
      const advanced = await transaction.advanceGoogleCalendarLink({
        linkId: link.id,
        producerId: link.producerId,
        expectedCurrentBookingId: link.currentBookingId,
        expectedDesiredRevision: link.desiredRevision,
        currentBookingId: booking.id,
        desiredRevision: booking.calendarRevision,
        syncState: nextState,
        lastSyncErrorCode: nextState === "conflict" ? link.lastSyncErrorCode : null,
        occurredAt: now,
      });
      await enqueueGoogleCalendarCorrection(transaction, context, booking, advanced, now, {
        operationKey: input.operationKey,
        operationDigest: digest,
        actorClerkUserId: input.actorClerkUserId,
      });
      return { status: nextState, replayed: false };
    },
  );
}

export function retrySessionBookingGoogleCalendarSync(
  repository: SessionBookingRepository,
  input: Readonly<{
    bookingId: string;
    producerId: string;
    actorClerkUserId: string;
    operationKey: string;
    now?: Date;
  }>,
): Promise<RecoverSessionBookingGoogleCalendarSyncResult> {
  return requestSessionBookingGoogleCalendarCorrection(repository, { ...input, kind: "retry" });
}

export function restoreMissingSessionBookingGoogleCalendarEvent(
  repository: SessionBookingRepository,
  input: Readonly<{
    bookingId: string;
    producerId: string;
    actorClerkUserId: string;
    operationKey: string;
    now?: Date;
  }>,
): Promise<RecoverSessionBookingGoogleCalendarSyncResult> {
  return requestSessionBookingGoogleCalendarCorrection(repository, {
    ...input,
    kind: "restore",
  });
}

async function calendarSyncJobIdForEvent(
  transaction: SessionBookingTransaction,
  bookingId: string,
  producerId: string,
  occurredAt: Date,
  intent: "opaque_hold" | "confirmed" | "delete",
): Promise<string | null> {
  return (
    (
      await transaction.findCalendarSyncJobForEvent({
        bookingId,
        producerId,
        occurredAt,
        intent,
      })
    )?.id ?? null
  );
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

function assertProducerSessionHasNotEnded(
  booking: Pick<SessionBookingRecord, "startsAt" | "durationMin">,
  now: Date,
  action: "cancelled" | "rescheduled",
): void {
  const endsAt = booking.startsAt.getTime() + booking.durationMin * 60 * 1000;
  if (now.getTime() >= endsAt) {
    throw new SessionBookingDomainError("INVALID_STATUS", `An ended session cannot be ${action}`);
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
      activeBooking && (heldBeforeStart || (input.booking.status === "confirmed" && isOnTime)),
    canReschedule:
      input.booking.status === "confirmed" &&
      isOnTime &&
      input.purchaseLifecycleStatus === "active" &&
      input.projectLifecycleStatus === "active" &&
      input.allowanceClosedAt === null,
  };
}

type SessionBookingRequestedStart = Readonly<{
  startsAt?: Date;
  localSlot?: Readonly<{ date: string; startMin: number }>;
}>;

function normalizeSessionBookingTitle(
  requestedTitle: string | null | undefined,
  defaultTitle: string,
  allowNull: boolean,
): string | null {
  if (requestedTitle === null && allowNull) return null;
  const title = requestedTitle ?? defaultTitle;
  const normalized = title.trim();
  if (normalized.length < 1) {
    throw new SessionBookingDomainError("INVALID_SLOT", "The session title is invalid");
  }
  return normalized;
}

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
  operationKey: string;
  title?: string | null;
  origin?: SessionBookingOrigin;
  billingTreatment?: SessionBookingBillingTreatment;
  acknowledgedWarnings?: readonly string[];
  googleBusyIntervals?: readonly SessionBusyInterval[];
  now?: Date;
}> &
  SessionBookingRequestedStart;

export type CreateSessionBookingResult = Readonly<{
  booking: SessionBookingRecord;
  created: boolean;
  calendarSyncJobId: string | null;
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
    title?: string | null;
    origin?: SessionBookingOrigin;
    billingTreatment?: SessionBookingBillingTreatment;
    calendarRevision?: number;
    actorKind?: "artist" | "producer";
    slotActor?: SessionSlotActor;
    forceConfirmed?: boolean;
    preloadedContext?: SessionBookingCreateContext;
    acknowledgedWarnings?: readonly string[];
    acknowledgedReducedGoogleProtection?: boolean;
    requireExactWarningAcknowledgements?: boolean;
    manualClientContactId?: string;
    googleBusyIntervals?: readonly SessionBusyInterval[];
  }>,
): Promise<CreateSessionBookingResult> {
  const context = options.preloadedContext ?? (await transaction.loadCreateContext(input));
  if (!context) {
    throw new SessionBookingDomainError(
      "NOT_FOUND",
      "The purchased session allowance was not found",
    );
  }
  const title = normalizeSessionBookingTitle(
    options.title,
    context.purchase.defaultSessionTitle,
    options.transitionKind === "rescheduled",
  );
  const origin = options.origin ?? "artist_request";
  const billingTreatment = options.billingTreatment ?? "included";
  const titleIntent = options.title == null ? "use_default" : title;
  const digest =
    options.operationDigestOverride ??
    operationDigest("create", {
      producerId: input.producerId,
      projectId: input.projectId,
      purchaseId: input.purchaseId,
      sessionAllowanceId: input.sessionAllowanceId,
      ...requestedStartOperationIdentity(input),
      durationMin: context.allowance.durationMin,
      titleIntent,
      origin,
      billingTreatment,
      acknowledgedWarnings: [...(options.acknowledgedWarnings ?? [])].sort(),
      ...(options.acknowledgedReducedGoogleProtection
        ? { acknowledgedReducedGoogleProtection: true }
        : {}),
      manualClientContactId: options.manualClientContactId ?? null,
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
    const replayCalendarIntent =
      event.toStatus === "confirmed"
        ? "confirmed"
        : replay.rescheduledFromBookingId === null
          ? "opaque_hold"
          : null;
    return {
      booking: bookingAtTransition(replay, event),
      created: false,
      calendarSyncJobId: replayCalendarIntent
        ? await calendarSyncJobIdForEvent(
            transaction,
            replay.id,
            replay.producerId,
            event.occurredAt,
            replayCalendarIntent,
          )
        : null,
    };
  }

  if (context.producer.closedAt !== null) {
    throw new SessionBookingDomainError("NOT_FOUND", "The studio is unavailable");
  }

  // The repository enters this helper only after taking the shared schedule,
  // project, purchase, and allowance locks. Resolve mutable producer policy
  // (timezone) and the effective clock only for a genuinely new command.
  // Replays use their immutable transition and cannot be broken by a later
  // timezone change (including a newly introduced DST gap).
  const startsAt = requestedSessionStart(input, context.producer.timeZone);
  const now = commandNow(input.now);

  const uses = await transaction.listAllowanceUses(input.producerId, input.sessionAllowanceId);
  const distinctConsumingUses = new Map<
    string,
    Readonly<{
      allowanceUseId: string;
      outcome: SessionUseOutcome;
      billingTreatment: SessionBookingBillingTreatment;
    }>
  >();
  for (const use of uses) {
    if (
      use.bookingId !== options.ignoredBookingId &&
      sessionUseConsumesAllowance(use.outcome, use.billingTreatment)
    ) {
      distinctConsumingUses.set(use.allowanceUseId, use);
    }
  }
  assertSessionBookingAllowed({
    purchaseLifecycleStatus: context.purchase.lifecycleStatus,
    projectLifecycleStatus: context.project.lifecycleStatus,
    allowance: context.allowance,
    existingOutcomes: [...distinctConsumingUses.values()].map((use) => use.outcome),
    existingUses: [...distinctConsumingUses.values()],
    billingTreatment,
    billingTreatmentMode: options.transitionKind === "rescheduled" ? "preserve" : "choose",
    requestedDurationMin: context.allowance.durationMin,
    startsAt,
    now,
  });
  const slotIssues = classifySessionSlot({
    actor: options.slotActor ?? (options.actorKind === "producer" ? "producer" : "artist"),
    startsAt,
    durationMin: context.allowance.durationMin,
    bufferMinutes: context.allowance.bufferMinutes,
    producerTimeZone: context.producer.timeZone,
    availabilityBlocks: context.availabilityBlocks,
    blackouts: context.blackouts,
    existingBookings: await transaction.listScheduleEntries(input.producerId),
    ...(options.googleBusyIntervals ? { googleBusyIntervals: options.googleBusyIntervals } : {}),
    maxSessionsPerDay: context.producer.maxSessionsPerDay,
    now,
    minLeadHours: context.allowance.minLeadHours,
    ...(options.ignoredBookingId ? { ignoreBookingId: options.ignoredBookingId } : {}),
  });
  const hardConflict = slotIssues.find((issue) => issue.severity === "hard_conflict");
  if (hardConflict) {
    throw new SessionBookingDomainError(hardConflict.code, hardConflict.message);
  }
  const warningCodes: string[] = slotIssues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.code);
  const acknowledgedWarnings = new Set(options.acknowledgedWarnings ?? []);
  const unacknowledged = warningCodes.filter((code) => !acknowledgedWarnings.has(code));
  const unexpected = options.requireExactWarningAcknowledgements
    ? [...acknowledgedWarnings].filter(
        (code) => code !== "GOOGLE_BUSY" && !warningCodes.includes(code),
      )
    : [];
  if (unacknowledged.length > 0 || unexpected.length > 0) {
    throw new SessionBookingDomainError(
      "WARNING_ACKNOWLEDGEMENT_REQUIRED",
      "The acknowledged scheduling warnings no longer match the current preview",
    );
  }

  const status = options.forceConfirmed
    ? "confirmed"
    : initialSessionBookingStatus(context.producer.autoConfirmBookings);
  const heldExpiresAt =
    status === "pending_approval"
      ? new Date(Math.min(now.getTime() + 24 * 60 * 60 * 1000, startsAt.getTime()))
      : null;
  const booking = await transaction.insertBooking({
    producerId: input.producerId,
    projectId: input.projectId,
    purchaseId: input.purchaseId,
    sessionAllowanceId: input.sessionAllowanceId,
    title,
    origin,
    billingTreatment,
    artistName: context.artist.name,
    artistEmail: context.artist.email,
    startsAt,
    durationMin: context.allowance.durationMin,
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
    calendarRevision: options.calendarRevision ?? 1,
    artistRsvpStatus: null,
    artistRsvpRespondedAt: null,
    occurredAt: now,
  });
  await transaction.insertTransitionEvent({
    bookingId: booking.id,
    producerId: booking.producerId,
    operationKey: input.operationKey,
    operationDigest: digest,
    kind: options.transitionKind,
    actorKind: options.actorKind ?? "artist",
    actorId: input.actorClerkUserId,
    fromStatus: null,
    toStatus: booking.status,
    fromOutcome: null,
    toOutcome: booking.outcome,
    oldStartsAt: null,
    newStartsAt: booking.startsAt,
    occurredAt: now,
  });
  const calendarIntent: BookingCalendarIntent | null =
    booking.status === "confirmed"
      ? "confirmed"
      : booking.rescheduledFromBookingId === null
        ? "opaque_hold"
        : null;
  const calendarSyncJob = calendarIntent
    ? await enqueueBookingCalendarJob(transaction, context, booking, calendarIntent, now)
    : null;
  return { booking, created: true, calendarSyncJobId: calendarSyncJob?.id ?? null };
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
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.origin !== undefined ? { origin: input.origin } : {}),
        ...(input.billingTreatment !== undefined
          ? { billingTreatment: input.billingTreatment }
          : {}),
        ...(input.googleBusyIntervals ? { googleBusyIntervals: input.googleBusyIntervals } : {}),
      }),
  );
}

export type CreateProducerManualSessionBookingInput = Readonly<{
  producerId: string;
  clientContactId: string;
  projectId: string;
  purchaseId: string;
  sessionAllowanceId: string;
  actorClerkUserId: string;
  startsAt: Date;
  title?: string | null;
  billingTreatment: SessionBookingBillingTreatment;
  acknowledgedWarnings: readonly string[];
  acknowledgedReducedGoogleProtection?: boolean;
  googleBusyIntervals?: readonly SessionBusyInterval[];
  operationKey: string;
  now?: Date;
}>;

export type FindProducerManualSessionBookingReplayInput = Omit<
  CreateProducerManualSessionBookingInput,
  "purchaseId" | "sessionAllowanceId" | "actorClerkUserId" | "now"
>;

function producerManualSessionBookingDigest(
  input: FindProducerManualSessionBookingReplayInput,
  booking: SessionBookingRecord,
): string {
  const titleIntent =
    input.title == null
      ? "use_default"
      : normalizeSessionBookingTitle(input.title, "Session", false);
  return operationDigest("create", {
    producerId: input.producerId,
    projectId: input.projectId,
    purchaseId: booking.purchaseId,
    sessionAllowanceId: booking.sessionAllowanceId,
    ...requestedStartOperationIdentity({ startsAt: input.startsAt }),
    durationMin: booking.durationMin,
    titleIntent,
    origin: "producer_manual",
    billingTreatment: input.billingTreatment,
    acknowledgedWarnings: [...input.acknowledgedWarnings].sort(),
    ...(input.acknowledgedReducedGoogleProtection
      ? { acknowledgedReducedGoogleProtection: true }
      : {}),
    manualClientContactId: input.clientContactId,
    rescheduledFromBookingId: null,
  });
}

export async function findProducerManualSessionBookingReplay(
  repository: SessionBookingRepository,
  input: FindProducerManualSessionBookingReplayInput,
): Promise<CreateSessionBookingResult | null> {
  assertOperationKey(input.operationKey);
  const stored = await repository.findProducerManualSessionBookingByOperationKey({
    producerId: input.producerId,
    operationKey: input.operationKey,
  });
  if (!stored) return null;

  const digest = producerManualSessionBookingDigest(input, stored.booking);
  assertOperationReplay(stored.booking, digest);
  if (
    stored.booking.projectId !== input.projectId ||
    stored.booking.origin !== "producer_manual" ||
    stored.booking.rescheduledFromBookingId !== null ||
    !stored.event ||
    stored.event.kind !== "created" ||
    stored.event.operationKey !== input.operationKey
  ) {
    throw new SessionBookingDomainError(
      "OPERATION_KEY_CONFLICT",
      "This operation key belongs to another booking command",
    );
  }
  assertOperationReplay(stored.event, digest);
  if (stored.event.toStatus === "confirmed" && !stored.calendarSyncJobId) {
    throw new SessionBookingDomainError(
      "OPERATION_KEY_CONFLICT",
      "The stored manual session is missing its calendar delivery command",
    );
  }
  return {
    booking: bookingAtTransition(stored.booking, stored.event),
    created: false,
    calendarSyncJobId: stored.calendarSyncJobId,
  };
}

export async function createProducerManualSessionBooking(
  repository: SessionBookingRepository,
  input: CreateProducerManualSessionBookingInput,
): Promise<CreateSessionBookingResult> {
  assertOperationKey(input.operationKey);
  const replay = await findProducerManualSessionBookingReplay(repository, input);
  if (replay) return replay;
  return repository.atomically(
    {
      kind: "create",
      producerId: input.producerId,
      projectId: input.projectId,
      purchaseId: input.purchaseId,
      sessionAllowanceId: input.sessionAllowanceId,
    },
    async (transaction) => {
      const context = await transaction.loadProducerManualCreateContext({
        producerId: input.producerId,
        clientContactId: input.clientContactId,
        projectId: input.projectId,
        purchaseId: input.purchaseId,
        sessionAllowanceId: input.sessionAllowanceId,
      });
      if (!context) {
        throw new SessionBookingDomainError(
          "NOT_FOUND",
          "This client project no longer has one active bookable session package",
        );
      }
      return createSessionBookingInTransaction(
        transaction,
        {
          producerId: input.producerId,
          projectId: input.projectId,
          purchaseId: input.purchaseId,
          sessionAllowanceId: input.sessionAllowanceId,
          actorClerkUserId: input.actorClerkUserId,
          startsAt: input.startsAt,
          operationKey: input.operationKey,
          ...(input.now ? { now: input.now } : {}),
        },
        {
          rescheduledFromBookingId: null,
          transitionKind: "created",
          ...(input.title !== undefined ? { title: input.title } : {}),
          origin: "producer_manual",
          billingTreatment: input.billingTreatment,
          actorKind: "producer",
          slotActor: "producer_google_hard",
          forceConfirmed: true,
          preloadedContext: context,
          acknowledgedWarnings: input.acknowledgedWarnings,
          ...(input.acknowledgedReducedGoogleProtection
            ? { acknowledgedReducedGoogleProtection: true }
            : {}),
          manualClientContactId: input.clientContactId,
          ...(input.googleBusyIntervals ? { googleBusyIntervals: input.googleBusyIntervals } : {}),
        },
      );
    },
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
  calendarSyncJobId: string | null;
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
    calendarAction?: "delete";
    requireNoPendingChangeRequest?: boolean;
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
        return {
          booking: bookingAtTransition(context.booking, replay),
          changed: false,
          calendarSyncJobId: spec.calendarAction
            ? await calendarSyncJobIdForEvent(
                transaction,
                context.booking.id,
                context.booking.producerId,
                replay.occurredAt,
                "delete",
              )
            : null,
        };
      }
      if (
        spec.requireNoPendingChangeRequest &&
        (await transaction.findPendingChangeRequest(context.booking.id))
      ) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Decide the pending artist change request before changing this session",
        );
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
      const skipsPendingReplacementEvent =
        context.booking.status === "pending_approval" &&
        context.booking.rescheduledFromBookingId !== null;
      const calendarSyncJob =
        spec.calendarAction && !skipsPendingReplacementEvent
          ? await enqueueBookingCalendarJob(
              transaction,
              context,
              updated,
              context.booking.status === "confirmed" ? "delete_confirmed" : "delete_hold",
              now,
            )
          : null;
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
      return { booking: updated, changed: true, calendarSyncJobId: calendarSyncJob?.id ?? null };
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
        return {
          booking: bookingAtTransition(context.booking, replay),
          changed: false,
          calendarSyncJobId: await calendarSyncJobIdForEvent(
            transaction,
            context.booking.id,
            context.booking.producerId,
            replay.occurredAt,
            "confirmed",
          ),
        };
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
      const calendarSyncJob = await enqueueBookingCalendarJob(
        transaction,
        context,
        updated,
        "confirmed",
        now,
      );
      if (!calendarSyncJob) {
        throw new SessionBookingDomainError("INVALID_STATUS", "Calendar delivery insert failed");
      }
      return { booking: updated, changed: true, calendarSyncJobId: calendarSyncJob.id };
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
    calendarAction: "delete",
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
        return {
          booking: bookingAtTransition(context.booking, replay),
          changed: false,
          calendarSyncJobId: await calendarSyncJobIdForEvent(
            transaction,
            context.booking.id,
            context.booking.producerId,
            replay.occurredAt,
            "delete",
          ),
        };
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
      const calendarSyncJob =
        context.booking.rescheduledFromBookingId === null
          ? await enqueueBookingCalendarJob(transaction, context, updated, "delete_hold", now)
          : null;
      return { booking: updated, changed: true, calendarSyncJobId: calendarSyncJob?.id ?? null };
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
      assertProducerSessionHasNotEnded(context.booking, now, "cancelled");
    },
    next: () => ({ status: "cancelled", outcome: "cancelled_by_producer" }),
    cancelPendingReplacement: true,
    calendarAction: "delete",
    requireNoPendingChangeRequest: true,
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
    calendarAction: "delete",
    requireNoPendingChangeRequest: true,
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
    calendarAction: "delete",
    requireNoPendingChangeRequest: true,
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
    requireNoPendingChangeRequest: true,
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
    requireNoPendingChangeRequest: true,
  });
}

export type RescheduleArtistSessionBookingInput = Readonly<{
  bookingId: string;
  actorClerkUserId: string;
  operationKey: string;
  googleBusyIntervals?: readonly SessionBusyInterval[];
  now?: Date;
}> &
  SessionBookingRequestedStart;

export type RescheduleArtistSessionBookingResult = Readonly<{
  booking: SessionBookingRecord;
  replacedBooking: SessionBookingRecord;
  created: boolean;
  calendarSyncJobId: string | null;
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
          calendarSyncJobId:
            replacementEvent.toStatus === "confirmed"
              ? await calendarSyncJobIdForEvent(
                  transaction,
                  replacementReplay.id,
                  replacementReplay.producerId,
                  replacementEvent.occurredAt,
                  "confirmed",
                )
              : null,
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
      if (await transaction.findPendingChangeRequest(context.booking.id)) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Decide the pending artist change request before rescheduling this session",
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
          operationKey: input.operationKey,
          now,
        },
        {
          rescheduledFromBookingId: context.booking.id,
          allowanceUseId: context.booking.allowanceUseId,
          ignoredBookingId: context.booking.id,
          transitionKind: "rescheduled",
          operationDigestOverride: digest,
          title: context.booking.title,
          origin: context.booking.origin,
          billingTreatment: context.booking.billingTreatment,
          calendarRevision: context.booking.calendarRevision + 1,
          ...(input.googleBusyIntervals ? { googleBusyIntervals: input.googleBusyIntervals } : {}),
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
        calendarSyncJobId: replacementResult.calendarSyncJobId,
      };
    },
  );
}

export type ProducerSessionRescheduleAvailabilitySnapshot = Readonly<{
  bookingId: string;
  now: Date;
  canBook: boolean;
  studioTimeZone: string;
  durationMin: number;
  bufferMinutes: number;
  minLeadHours: number;
  maxSessionsPerDay: number | null;
  availabilityBlocks: SessionBookingContext["availabilityBlocks"];
  blackouts: SessionBookingContext["blackouts"];
  existingBookings: readonly SessionBookingScheduleEntry[];
}>;

export type ProducerSessionRescheduleAvailability = Readonly<{
  studioTimeZone: string;
  durationMin: number;
  today: string;
  days: readonly ExactSessionSlotDay[];
}>;

export async function loadProducerSessionRescheduleAvailabilitySnapshot(
  repository: SessionBookingRepository,
  input: Readonly<{
    bookingId: string;
    producerId: string;
    now?: Date;
  }>,
): Promise<ProducerSessionRescheduleAvailabilitySnapshot> {
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId, producerId: input.producerId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        producerId: input.producerId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const now = commandNow(input.now);
      assertConfirmedForReschedule(context);
      assertProducerSessionHasNotEnded(context.booking, now, "rescheduled");
      if (await transaction.findPendingChangeRequest(context.booking.id)) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Decide the pending artist change request before rescheduling this session",
        );
      }
      return {
        bookingId: context.booking.id,
        now,
        canBook: sessionAllowanceCanBook({
          purchaseLifecycleStatus: context.purchase.lifecycleStatus,
          projectLifecycleStatus: context.project.lifecycleStatus,
          allowanceClosedAt: context.allowance.closedAt,
          bookingEnabledSnapshot: context.allowance.bookingEnabledSnapshot,
          allowanceKind: context.allowance.kind,
          sessionLimit: context.allowance.sessionLimit,
          billingTreatmentMode: "preserve",
        }),
        studioTimeZone: context.producer.timeZone,
        durationMin: context.booking.durationMin,
        bufferMinutes: context.allowance.bufferMinutes,
        minLeadHours: context.allowance.minLeadHours,
        maxSessionsPerDay: context.producer.maxSessionsPerDay,
        availabilityBlocks: context.availabilityBlocks,
        blackouts: context.blackouts,
        existingBookings: await transaction.listScheduleEntries(context.booking.producerId),
      };
    },
  );
}

export function generateProducerSessionRescheduleAvailability(
  snapshot: ProducerSessionRescheduleAvailabilitySnapshot,
  googleBusyIntervals: readonly SessionBusyInterval[] = [],
): ProducerSessionRescheduleAvailability {
  const generated = generateProducerExactSessionSlots({
    now: snapshot.now,
    canBook: snapshot.canBook,
    producerTimeZone: snapshot.studioTimeZone,
    durationMin: snapshot.durationMin,
    bufferMinutes: snapshot.bufferMinutes,
    minLeadHours: snapshot.minLeadHours,
    maxSessionsPerDay: snapshot.maxSessionsPerDay,
    availabilityBlocks: snapshot.availabilityBlocks,
    blackouts: snapshot.blackouts,
    existingBookings: snapshot.existingBookings,
    googleBusyIntervals,
    ignoreBookingId: snapshot.bookingId,
  });
  return {
    studioTimeZone: snapshot.studioTimeZone,
    durationMin: snapshot.durationMin,
    today: generated.today,
    days: generated.days,
  };
}

export type PreviewProducerSessionRescheduleResult = Readonly<{
  booking: SessionBookingRecord;
  proposedStartsAt: Date;
  hardConflicts: readonly Readonly<{ code: string; message: string }>[];
  warnings: readonly Readonly<{ code: string; message: string }>[];
}>;

function assertConfirmedForReschedule(context: SessionBookingContext): void {
  if (context.booking.status !== "confirmed") {
    throw new SessionBookingDomainError(
      "INVALID_STATUS",
      "Only a confirmed session can be rescheduled",
    );
  }
}

async function producerRescheduleIssues(
  transaction: SessionBookingTransaction,
  context: SessionBookingContext,
  startsAt: Date,
  now: Date,
  googleBusyIntervals: readonly SessionBusyInterval[] = [],
) {
  return classifySessionSlot({
    actor: "producer_google_hard",
    startsAt,
    durationMin: context.booking.durationMin,
    bufferMinutes: context.allowance.bufferMinutes,
    producerTimeZone: context.producer.timeZone,
    availabilityBlocks: context.availabilityBlocks,
    blackouts: context.blackouts,
    existingBookings: await transaction.listScheduleEntries(context.booking.producerId),
    googleBusyIntervals,
    maxSessionsPerDay: context.producer.maxSessionsPerDay,
    now,
    minLeadHours: context.allowance.minLeadHours,
    ignoreBookingId: context.booking.id,
  });
}

export async function previewProducerSessionReschedule(
  repository: SessionBookingRepository,
  input: Readonly<{
    bookingId: string;
    producerId: string;
    startsAt: Date;
    googleBusyIntervals?: readonly SessionBusyInterval[];
    now?: Date;
  }>,
): Promise<PreviewProducerSessionRescheduleResult> {
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId, producerId: input.producerId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        producerId: input.producerId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const now = commandNow(input.now);
      assertConfirmedForReschedule(context);
      assertProducerSessionHasNotEnded(context.booking, now, "rescheduled");
      if (await transaction.findPendingChangeRequest(context.booking.id)) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Decide the pending artist change request before rescheduling this session",
        );
      }
      const startsAt = requestedSessionStart(
        { startsAt: input.startsAt },
        context.producer.timeZone,
      );
      const issues = await producerRescheduleIssues(
        transaction,
        context,
        startsAt,
        now,
        input.googleBusyIntervals,
      );
      return {
        booking: context.booking,
        proposedStartsAt: startsAt,
        hardConflicts: issues.filter((issue) => issue.severity === "hard_conflict"),
        warnings: issues.filter((issue) => issue.severity === "warning"),
      };
    },
  );
}

export type RescheduleProducerSessionBookingInput = Readonly<{
  bookingId: string;
  producerId: string;
  actorClerkUserId: string;
  startsAt: Date;
  warningAcknowledgements: readonly string[];
  acknowledgedReducedGoogleProtection?: boolean;
  googleBusyIntervals?: readonly SessionBusyInterval[];
  operationKey: string;
  now?: Date;
}>;

export async function rescheduleProducerSessionBooking(
  repository: SessionBookingRepository,
  input: RescheduleProducerSessionBookingInput,
): Promise<RescheduleArtistSessionBookingResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId, producerId: input.producerId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        producerId: input.producerId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const digest = operationDigest("producer-reschedule", {
        bookingId: input.bookingId,
        producerId: input.producerId,
        startsAt: input.startsAt.toISOString(),
        warningAcknowledgements: [...input.warningAcknowledgements].sort(),
        ...(input.acknowledgedReducedGoogleProtection
          ? { acknowledgedReducedGoogleProtection: true }
          : {}),
      });
      const replacementReplay = await transaction.findReplacementBooking(input.bookingId);
      if (replacementReplay) {
        assertOperationReplay(replacementReplay, digest);
        const replacementEvent = await transaction.findTransitionEvent(
          replacementReplay.id,
          input.operationKey,
        );
        const originalEvent = await transaction.findTransitionEvent(
          input.bookingId,
          input.operationKey,
        );
        if (!replacementEvent || !originalEvent) {
          throw new SessionBookingDomainError(
            "OPERATION_KEY_CONFLICT",
            "The stored reschedule command is incomplete",
          );
        }
        assertOperationReplay(replacementEvent, digest);
        assertOperationReplay(originalEvent, digest);
        return {
          booking: bookingAtTransition(replacementReplay, replacementEvent),
          replacedBooking: bookingAtTransition(context.booking, originalEvent),
          created: false,
          calendarSyncJobId: await calendarSyncJobIdForEvent(
            transaction,
            replacementReplay.id,
            replacementReplay.producerId,
            replacementEvent.occurredAt,
            "confirmed",
          ),
        };
      }
      assertConfirmedForReschedule(context);
      const now = commandNow(input.now);
      assertProducerSessionHasNotEnded(context.booking, now, "rescheduled");
      if (await transaction.findPendingChangeRequest(context.booking.id)) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Decide the pending artist change request before rescheduling this session",
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
          startsAt: input.startsAt,
          operationKey: input.operationKey,
          now,
        },
        {
          rescheduledFromBookingId: context.booking.id,
          allowanceUseId: context.booking.allowanceUseId,
          ignoredBookingId: context.booking.id,
          transitionKind: "rescheduled",
          operationDigestOverride: digest,
          title: context.booking.title,
          origin: context.booking.origin,
          billingTreatment: context.booking.billingTreatment,
          calendarRevision: context.booking.calendarRevision + 1,
          actorKind: "producer",
          slotActor: "producer_google_hard",
          forceConfirmed: true,
          preloadedContext: context,
          acknowledgedWarnings: input.warningAcknowledgements,
          requireExactWarningAcknowledgements: true,
          ...(input.googleBusyIntervals ? { googleBusyIntervals: input.googleBusyIntervals } : {}),
        },
      );
      const replacedBooking = await transaction.updateBooking({
        bookingId: context.booking.id,
        producerId: context.booking.producerId,
        expectedStatus: "confirmed",
        status: "cancelled",
        outcome: "cancelled_on_time",
        occurredAt: now,
      });
      await transaction.insertTransitionEvent({
        bookingId: replacedBooking.id,
        producerId: replacedBooking.producerId,
        operationKey: input.operationKey,
        operationDigest: digest,
        kind: "rescheduled",
        actorKind: "producer",
        actorId: input.actorClerkUserId,
        fromStatus: context.booking.status,
        toStatus: replacedBooking.status,
        fromOutcome: context.booking.outcome,
        toOutcome: replacedBooking.outcome,
        oldStartsAt: context.booking.startsAt,
        newStartsAt: replacementResult.booking.startsAt,
        occurredAt: now,
      });
      return {
        booking: replacementResult.booking,
        replacedBooking,
        created: true,
        calendarSyncJobId: replacementResult.calendarSyncJobId,
      };
    },
  );
}

export type SubmitArtistSessionChangeRequestInput = Readonly<{
  bookingId: string;
  actorClerkUserId: string;
  kind: SessionBookingChangeRequestKind;
  proposedStartsAt?: Date;
  googleBusyIntervals?: readonly SessionBusyInterval[];
  operationKey: string;
  now?: Date;
}>;

export async function submitArtistSessionChangeRequest(
  repository: SessionBookingRepository,
  input: SubmitArtistSessionChangeRequestInput,
): Promise<Readonly<{ request: SessionBookingChangeRequestRecord; replayed: boolean }>> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    { kind: "booking", bookingId: input.bookingId },
    async (transaction) => {
      const context = await transaction.loadBookingContext({
        bookingId: input.bookingId,
        actorClerkUserId: input.actorClerkUserId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      if (input.kind === "reschedule" && !(input.proposedStartsAt instanceof Date)) {
        throw new SessionBookingDomainError(
          "INVALID_SLOT",
          "A reschedule request requires a replacement time",
        );
      }
      const proposedStartsAt =
        input.kind === "reschedule"
          ? requestedSessionStart(
              { startsAt: input.proposedStartsAt as Date },
              context.producer.timeZone,
            )
          : null;
      if (input.kind === "cancel" && input.proposedStartsAt !== undefined) {
        throw new SessionBookingDomainError(
          "INVALID_SLOT",
          "A cancellation request cannot include a replacement time",
        );
      }
      const digest = operationDigest("artist-change-request", {
        bookingId: input.bookingId,
        kind: input.kind,
        proposedStartsAt: proposedStartsAt?.toISOString() ?? null,
      });
      const replay = await transaction.findChangeRequestByOperationKey(
        input.bookingId,
        input.operationKey,
      );
      if (replay) {
        assertOperationReplay({ operationDigest: replay.requestOperationDigest }, digest);
        return { request: replay, replayed: true };
      }
      if (context.booking.status !== "confirmed") {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "Only a confirmed session can have a change request",
        );
      }
      if (await transaction.findPendingChangeRequest(input.bookingId)) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "This session already has a pending change request",
        );
      }
      const now = commandNow(input.now);
      if (now.getTime() >= context.booking.startsAt.getTime()) {
        throw new SessionBookingDomainError(
          "CANCELLATION_WINDOW",
          "A session that has started can no longer be changed",
        );
      }
      if (
        input.kind === "reschedule" &&
        artistCancellationOutcome({
          startsAt: context.booking.startsAt,
          now,
          cancellationPolicyHours: context.booking.cancellationPolicyHoursSnapshot,
        }) !== "cancelled_on_time"
      ) {
        throw new SessionBookingDomainError(
          "CANCELLATION_WINDOW",
          "This session is too close to request a reschedule",
        );
      }
      if (proposedStartsAt) {
        const slotIssue = classifySessionSlot({
          actor: "artist",
          startsAt: proposedStartsAt,
          durationMin: context.booking.durationMin,
          bufferMinutes: context.allowance.bufferMinutes,
          producerTimeZone: context.producer.timeZone,
          availabilityBlocks: context.availabilityBlocks,
          blackouts: context.blackouts,
          existingBookings: await transaction.listScheduleEntries(context.booking.producerId),
          ...(input.googleBusyIntervals ? { googleBusyIntervals: input.googleBusyIntervals } : {}),
          maxSessionsPerDay: context.producer.maxSessionsPerDay,
          now,
          minLeadHours: context.allowance.minLeadHours,
          ignoreBookingId: context.booking.id,
        })[0];
        if (slotIssue) {
          throw new SessionBookingDomainError(slotIssue.code, slotIssue.message);
        }
      }
      const request = await transaction.insertChangeRequest({
        bookingId: context.booking.id,
        producerId: context.booking.producerId,
        kind: input.kind,
        status: "pending",
        proposedStartsAt,
        requestOperationKey: input.operationKey,
        requestOperationDigest: digest,
        requestedByClerkUserId: input.actorClerkUserId,
        requestedAt: now,
        decisionOperationKey: null,
        decisionOperationDigest: null,
        decidedByClerkUserId: null,
        decidedAt: null,
        replacementBookingId: null,
        occurredAt: now,
      });
      return { request, replayed: false };
    },
  );
}

export type DecideProducerSessionChangeRequestInput = Readonly<{
  requestId: string;
  producerId: string;
  actorClerkUserId: string;
  decision: "approved" | "rejected";
  operationKey: string;
  reason?: string | null;
  googleBusyIntervals?: readonly SessionBusyInterval[];
  now?: Date;
}>;

export type DecideProducerSessionChangeRequestResult = Readonly<{
  request: SessionBookingChangeRequestRecord;
  booking?: SessionBookingRecord;
  replacementBooking?: SessionBookingRecord;
  changed: boolean;
  calendarSyncJobId: string | null;
}>;

export async function decideProducerSessionChangeRequest(
  repository: SessionBookingRepository,
  input: DecideProducerSessionChangeRequestInput,
): Promise<DecideProducerSessionChangeRequestResult> {
  assertOperationKey(input.operationKey);
  return repository.atomically(
    { kind: "change_request", requestId: input.requestId, producerId: input.producerId },
    async (transaction) => {
      const request = await transaction.loadChangeRequest({
        requestId: input.requestId,
        producerId: input.producerId,
      });
      if (!request) {
        throw new SessionBookingDomainError(
          "NOT_FOUND",
          "The session change request was not found",
        );
      }
      const context = await transaction.loadBookingContext({
        bookingId: request.bookingId,
        producerId: input.producerId,
      });
      if (!context) throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
      const digest = operationDigest("producer-change-request-decision", {
        requestId: input.requestId,
        producerId: input.producerId,
        decision: input.decision,
        reason: input.reason?.trim() || null,
      });
      if (request.status !== "pending") {
        if (request.decisionOperationKey !== input.operationKey) {
          throw new SessionBookingDomainError(
            "INVALID_STATUS",
            "This session change request was already decided",
          );
        }
        assertOperationReplay({ operationDigest: request.decisionOperationDigest ?? "" }, digest);
        const sourceEvent = await transaction.findTransitionEvent(
          request.bookingId,
          input.operationKey,
        );
        const booking = sourceEvent ? bookingAtTransition(context.booking, sourceEvent) : undefined;
        const replacementContext = request.replacementBookingId
          ? await transaction.loadBookingContext({
              bookingId: request.replacementBookingId,
              producerId: input.producerId,
            })
          : null;
        const replacementEvent = replacementContext
          ? await transaction.findTransitionEvent(replacementContext.booking.id, input.operationKey)
          : null;
        return {
          request,
          ...(booking ? { booking } : {}),
          ...(replacementContext
            ? {
                replacementBooking: replacementEvent
                  ? bookingAtTransition(replacementContext.booking, replacementEvent)
                  : replacementContext.booking,
              }
            : {}),
          changed: false,
          calendarSyncJobId:
            request.status === "approved"
              ? request.kind === "cancel" && sourceEvent
                ? await calendarSyncJobIdForEvent(
                    transaction,
                    request.bookingId,
                    request.producerId,
                    sourceEvent.occurredAt,
                    "delete",
                  )
                : replacementContext && replacementEvent
                  ? await calendarSyncJobIdForEvent(
                      transaction,
                      replacementContext.booking.id,
                      replacementContext.booking.producerId,
                      replacementEvent.occurredAt,
                      "confirmed",
                    )
                  : null
              : null,
        };
      }
      const now = commandNow(input.now);
      if (input.decision === "rejected") {
        const rejected = await transaction.decideChangeRequest({
          requestId: request.id,
          producerId: request.producerId,
          status: "rejected",
          decisionOperationKey: input.operationKey,
          decisionOperationDigest: digest,
          decidedByClerkUserId: input.actorClerkUserId,
          decidedAt: now,
          replacementBookingId: null,
        });
        return { request: rejected, changed: true, calendarSyncJobId: null };
      }
      assertConfirmedForReschedule(context);
      if (request.kind === "cancel") {
        const outcome = artistCancellationOutcome({
          startsAt: context.booking.startsAt,
          now: request.requestedAt,
          cancellationPolicyHours: context.booking.cancellationPolicyHoursSnapshot,
        });
        const booking = await transaction.updateBooking({
          bookingId: context.booking.id,
          producerId: context.booking.producerId,
          expectedStatus: "confirmed",
          status: "cancelled",
          outcome,
          occurredAt: now,
        });
        await transaction.insertTransitionEvent({
          bookingId: booking.id,
          producerId: booking.producerId,
          operationKey: input.operationKey,
          operationDigest: digest,
          kind: "artist_cancelled",
          actorKind: "producer",
          actorId: input.actorClerkUserId,
          fromStatus: context.booking.status,
          toStatus: booking.status,
          fromOutcome: context.booking.outcome,
          toOutcome: booking.outcome,
          oldStartsAt: context.booking.startsAt,
          newStartsAt: null,
          occurredAt: now,
        });
        const calendarSyncJob = await enqueueBookingCalendarJob(
          transaction,
          context,
          booking,
          "delete_confirmed",
          now,
        );
        if (!calendarSyncJob) {
          throw new SessionBookingDomainError("INVALID_STATUS", "Calendar delivery insert failed");
        }
        const approved = await transaction.decideChangeRequest({
          requestId: request.id,
          producerId: request.producerId,
          status: "approved",
          decisionOperationKey: input.operationKey,
          decisionOperationDigest: digest,
          decidedByClerkUserId: input.actorClerkUserId,
          decidedAt: now,
          replacementBookingId: null,
        });
        return {
          request: approved,
          booking,
          changed: true,
          calendarSyncJobId: calendarSyncJob.id,
        };
      }
      if (!request.proposedStartsAt) {
        throw new SessionBookingDomainError(
          "INVALID_SLOT",
          "The requested replacement time is missing",
        );
      }
      if (
        artistCancellationOutcome({
          startsAt: context.booking.startsAt,
          now: request.requestedAt,
          cancellationPolicyHours: context.booking.cancellationPolicyHoursSnapshot,
        }) !== "cancelled_on_time"
      ) {
        throw new SessionBookingDomainError(
          "CANCELLATION_WINDOW",
          "The reschedule request was submitted after the cancellation cutoff",
        );
      }
      if (await transaction.findReplacementBooking(context.booking.id)) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "This session already has an immutable replacement",
        );
      }
      const replacement = await createSessionBookingInTransaction(
        transaction,
        {
          producerId: context.booking.producerId,
          projectId: context.booking.projectId,
          purchaseId: context.booking.purchaseId,
          sessionAllowanceId: context.booking.sessionAllowanceId,
          actorClerkUserId: input.actorClerkUserId,
          startsAt: request.proposedStartsAt,
          operationKey: input.operationKey,
          now,
        },
        {
          rescheduledFromBookingId: context.booking.id,
          allowanceUseId: context.booking.allowanceUseId,
          ignoredBookingId: context.booking.id,
          transitionKind: "rescheduled",
          operationDigestOverride: digest,
          title: context.booking.title,
          origin: context.booking.origin,
          billingTreatment: context.booking.billingTreatment,
          calendarRevision: context.booking.calendarRevision + 1,
          actorKind: "producer",
          slotActor: "artist",
          forceConfirmed: true,
          preloadedContext: context,
          ...(input.googleBusyIntervals ? { googleBusyIntervals: input.googleBusyIntervals } : {}),
        },
      );
      const booking = await transaction.updateBooking({
        bookingId: context.booking.id,
        producerId: context.booking.producerId,
        expectedStatus: "confirmed",
        status: "cancelled",
        outcome: "cancelled_on_time",
        occurredAt: now,
      });
      await transaction.insertTransitionEvent({
        bookingId: booking.id,
        producerId: booking.producerId,
        operationKey: input.operationKey,
        operationDigest: digest,
        kind: "rescheduled",
        actorKind: "producer",
        actorId: input.actorClerkUserId,
        fromStatus: context.booking.status,
        toStatus: booking.status,
        fromOutcome: context.booking.outcome,
        toOutcome: booking.outcome,
        oldStartsAt: context.booking.startsAt,
        newStartsAt: replacement.booking.startsAt,
        occurredAt: now,
      });
      const approved = await transaction.decideChangeRequest({
        requestId: request.id,
        producerId: request.producerId,
        status: "approved",
        decisionOperationKey: input.operationKey,
        decisionOperationDigest: digest,
        decidedByClerkUserId: input.actorClerkUserId,
        decidedAt: now,
        replacementBookingId: replacement.booking.id,
      });
      return {
        request: approved,
        booking,
        replacementBooking: replacement.booking,
        changed: true,
        calendarSyncJobId: replacement.calendarSyncJobId,
      };
    },
  );
}
