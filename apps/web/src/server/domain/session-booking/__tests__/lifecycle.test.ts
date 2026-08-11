import { describe, expect, it, vi } from "vitest";

import {
  applyGoogleCalendarSessionReconciliation,
  cancelArtistSessionBooking,
  cancelProducerSessionBooking,
  completeSessionBooking,
  confirmSessionBooking,
  createProducerManualSessionBooking,
  createSessionBooking,
  decideProducerSessionChangeRequest,
  expireHeldSessionBooking,
  findProducerManualSessionBookingReplay,
  generateProducerSessionRescheduleAvailability,
  getSessionBookingGoogleCalendarSyncStatuses,
  loadProducerSessionRescheduleAvailabilitySnapshot,
  markSessionNoShow,
  recordLateArtistCancellation,
  rejectSessionBooking,
  restoreMissingSessionBookingGoogleCalendarEvent,
  retrySessionBookingGoogleCalendarSync,
  previewProducerSessionReschedule,
  rescheduleArtistSessionBooking,
  rescheduleProducerSessionBooking,
  sessionBookingCapabilities,
  sessionUseConsumesAllowance,
  submitArtistSessionChangeRequest,
} from "../service";
import type { GoogleCalendarPreparedReconciliation } from "~/server/calendar/google-reconciliation";
import type {
  BookingCalendarLinkRecord,
  CalendarSyncJobRecord,
  CreateSessionBookingInput,
  NewCalendarSyncJobRecord,
  NewSessionBookingRecord,
  NewSessionBookingChangeRequestRecord,
  SessionBookingAtomicScope,
  SessionBookingContext,
  SessionBookingChangeRequestRecord,
  SessionBookingCreateContext,
  SessionBookingRecord,
  SessionBookingRepository,
  SessionBookingScheduleEntry,
  SessionBookingTransaction,
  SessionBookingTransitionEventDraft,
  SessionUseOutcome,
  StoredSessionBookingTransitionEvent,
} from "../service";

const baseNow = new Date("2026-07-19T06:00:00.000Z");

function createContext(
  overrides: {
    autoConfirmBookings?: boolean;
    cancellationPolicyHours?: number;
    maxSessionsPerDay?: number | null;
    projectLifecycleStatus?: SessionBookingCreateContext["project"]["lifecycleStatus"];
    purchaseLifecycleStatus?: SessionBookingCreateContext["purchase"]["lifecycleStatus"];
    allowanceKind?: "fixed" | "unlimited";
    sessionLimit?: number | null;
    closedAt?: Date | null;
    durationMin?: number;
    bufferMinutes?: number;
    minLeadHours?: number;
  } = {},
): SessionBookingCreateContext {
  const allowanceKind = overrides.allowanceKind ?? "fixed";
  return {
    producer: {
      id: "producer-sk68",
      name: "SK-68 Producer",
      email: "producer@example.invalid",
      timeZone: "UTC",
      autoConfirmBookings: overrides.autoConfirmBookings ?? false,
      cancellationPolicyHours: overrides.cancellationPolicyHours ?? 24,
      maxSessionsPerDay: overrides.maxSessionsPerDay ?? null,
    },
    project: {
      id: "project-sk68",
      title: "SK-68 Project",
      lifecycleStatus: overrides.projectLifecycleStatus ?? "active",
    },
    purchase: {
      id: "purchase-sk68",
      lifecycleStatus: overrides.purchaseLifecycleStatus ?? "active",
      defaultSessionTitle: "Studio session",
    },
    allowance: {
      id: "allowance-sk68",
      purchaseId: "purchase-sk68",
      producerId: "producer-sk68",
      bookingEnabledSnapshot: true,
      kind: allowanceKind,
      sessionLimit: overrides.sessionLimit ?? (allowanceKind === "fixed" ? 2 : null),
      durationMin: overrides.durationMin ?? 60,
      locationType: "studio",
      bufferMinutes: overrides.bufferMinutes ?? 15,
      minLeadHours: overrides.minLeadHours ?? 0,
      closedAt: overrides.closedAt ?? null,
    },
    artist: {
      clerkUserId: "artist-clerk-sk68",
      name: "SK-68 Artist",
      email: "sk68-artist@example.invalid",
    },
    availabilityBlocks: [{ weekday: 1, startMin: 9 * 60, endMin: 18 * 60 }],
    blackouts: [],
  };
}

class MemorySessionBookingRepository
  implements SessionBookingRepository, SessionBookingTransaction
{
  context: SessionBookingCreateContext;
  artistArchived = false;
  artistClerkLinked = true;
  readonly bookings: SessionBookingRecord[] = [];
  readonly events: StoredSessionBookingTransitionEvent[] = [];
  readonly changeRequests: SessionBookingChangeRequestRecord[] = [];
  readonly calendarJobs: CalendarSyncJobRecord[] = [];
  readonly bookingCalendarLinks: BookingCalendarLinkRecord[] = [];
  readonly calendarJobOccurredAt = new Map<string, Date>();
  activeReconciliation: Readonly<{
    jobId: string;
    linkId: string;
    leaseToken: string;
    capturedRevision: number;
  }> | null = null;
  googleConnected = false;
  googleConnectionId = "google-connection-sk194";
  googleAccountVersion = 1;
  failNextCalendarSyncInsert = false;
  #bookingSequence = 0;
  #eventSequence = 0;
  #changeRequestSequence = 0;
  #calendarJobSequence = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(context: SessionBookingCreateContext = createContext()) {
    this.context = context;
  }

  async findBookingGoogleCalendarSyncStatuses(input: {
    bookingIds: readonly string[];
    producerId: string;
  }) {
    await Promise.resolve();
    return input.bookingIds.flatMap((bookingId) => {
      const link = this.bookingCalendarLinks.find(
        (candidate) =>
          candidate.currentBookingId === bookingId && candidate.producerId === input.producerId,
      );
      return link
        ? [{ bookingId, status: this.googleConnected ? link.syncState : ("disconnected" as const) }]
        : [];
    });
  }

  async findProducerManualSessionBookingByOperationKey(input: {
    producerId: string;
    operationKey: string;
  }) {
    await Promise.resolve();
    const booking = this.bookings.find(
      (candidate) =>
        candidate.producerId === input.producerId && candidate.operationKey === input.operationKey,
    );
    if (!booking) return null;
    const event =
      this.events.find(
        (candidate) =>
          candidate.bookingId === booking.id && candidate.operationKey === input.operationKey,
      ) ?? null;
    const calendarSyncJobId = event
      ? (this.calendarJobs.find(
          (job) =>
            job.bookingId === booking.id &&
            this.calendarJobOccurredAt.get(job.id)?.getTime() === event.occurredAt.getTime(),
        )?.id ?? null)
      : null;
    return { booking, event, calendarSyncJobId };
  }

  atomically<T>(
    _scope: SessionBookingAtomicScope,
    work: (transaction: SessionBookingTransaction) => Promise<T>,
  ): Promise<T> {
    const result = this.#queue.then(async () => {
      const bookings = [...this.bookings];
      const events = [...this.events];
      const changeRequests = [...this.changeRequests];
      const calendarJobs = [...this.calendarJobs];
      const bookingCalendarLinks = [...this.bookingCalendarLinks];
      const calendarJobOccurredAt = new Map(this.calendarJobOccurredAt);
      const activeReconciliation = this.activeReconciliation;
      const sequences = {
        booking: this.#bookingSequence,
        event: this.#eventSequence,
        changeRequest: this.#changeRequestSequence,
        calendarJob: this.#calendarJobSequence,
      };
      try {
        return await work(this);
      } catch (error) {
        this.bookings.splice(0, this.bookings.length, ...bookings);
        this.events.splice(0, this.events.length, ...events);
        this.changeRequests.splice(0, this.changeRequests.length, ...changeRequests);
        this.calendarJobs.splice(0, this.calendarJobs.length, ...calendarJobs);
        this.bookingCalendarLinks.splice(
          0,
          this.bookingCalendarLinks.length,
          ...bookingCalendarLinks,
        );
        this.calendarJobOccurredAt.clear();
        for (const [jobId, occurredAt] of calendarJobOccurredAt) {
          this.calendarJobOccurredAt.set(jobId, occurredAt);
        }
        this.#bookingSequence = sequences.booking;
        this.#eventSequence = sequences.event;
        this.#changeRequestSequence = sequences.changeRequest;
        this.#calendarJobSequence = sequences.calendarJob;
        this.activeReconciliation = activeReconciliation;
        throw error;
      }
    });
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async loadCreateContext(input: {
    producerId: string;
    projectId: string;
    purchaseId: string;
    sessionAllowanceId: string;
    actorClerkUserId: string;
  }): Promise<SessionBookingCreateContext | null> {
    await Promise.resolve();
    const context = this.context;
    return !this.artistArchived &&
      this.artistClerkLinked &&
      input.producerId === context.producer.id &&
      input.projectId === context.project.id &&
      input.purchaseId === context.purchase.id &&
      input.sessionAllowanceId === context.allowance.id &&
      input.actorClerkUserId === context.artist.clerkUserId
      ? context
      : null;
  }

  async loadProducerManualCreateContext(input: {
    producerId: string;
    clientContactId: string;
    projectId: string;
    purchaseId: string;
    sessionAllowanceId: string;
  }): Promise<SessionBookingCreateContext | null> {
    await Promise.resolve();
    const context = this.context;
    return !this.artistArchived &&
      input.clientContactId === "client-sk68" &&
      input.producerId === context.producer.id &&
      input.projectId === context.project.id &&
      input.purchaseId === context.purchase.id &&
      input.sessionAllowanceId === context.allowance.id
      ? context
      : null;
  }

  async loadBookingContext(input: {
    bookingId: string;
    producerId?: string;
    actorClerkUserId?: string;
  }): Promise<SessionBookingContext | null> {
    await Promise.resolve();
    const booking = this.bookings.find((candidate) => candidate.id === input.bookingId);
    if (
      !booking ||
      (input.producerId !== undefined && input.producerId !== booking.producerId) ||
      (input.actorClerkUserId !== undefined &&
        (!this.artistClerkLinked ||
          this.artistArchived ||
          input.actorClerkUserId !== this.context.artist.clerkUserId))
    ) {
      return null;
    }
    return { ...this.context, booking };
  }

  async findBookingByOperationKey(
    producerId: string,
    operationKey: string,
  ): Promise<SessionBookingRecord | null> {
    await Promise.resolve();
    return (
      this.bookings.find(
        (booking) => booking.producerId === producerId && booking.operationKey === operationKey,
      ) ?? null
    );
  }

  async findReplacementBooking(bookingId: string): Promise<SessionBookingRecord | null> {
    await Promise.resolve();
    return this.bookings.find((booking) => booking.rescheduledFromBookingId === bookingId) ?? null;
  }

  async findTransitionEvent(
    bookingId: string,
    operationKey: string,
  ): Promise<StoredSessionBookingTransitionEvent | null> {
    await Promise.resolve();
    return (
      this.events.find(
        (event) => event.bookingId === bookingId && event.operationKey === operationKey,
      ) ?? null
    );
  }

  async loadChangeRequest(input: {
    requestId: string;
    producerId?: string;
  }): Promise<SessionBookingChangeRequestRecord | null> {
    await Promise.resolve();
    return (
      this.changeRequests.find(
        (request) =>
          request.id === input.requestId &&
          (input.producerId === undefined || request.producerId === input.producerId),
      ) ?? null
    );
  }

  async findChangeRequestByOperationKey(
    bookingId: string,
    operationKey: string,
  ): Promise<SessionBookingChangeRequestRecord | null> {
    await Promise.resolve();
    return (
      this.changeRequests.find(
        (request) =>
          request.bookingId === bookingId && request.requestOperationKey === operationKey,
      ) ?? null
    );
  }

  async findPendingChangeRequest(
    bookingId: string,
  ): Promise<SessionBookingChangeRequestRecord | null> {
    await Promise.resolve();
    return (
      this.changeRequests.find(
        (request) => request.bookingId === bookingId && request.status === "pending",
      ) ?? null
    );
  }

  async listAllowanceUses(
    producerId: string,
    sessionAllowanceId: string,
  ): Promise<
    readonly Readonly<{
      bookingId: string;
      allowanceUseId: string;
      outcome: SessionUseOutcome;
      billingTreatment: SessionBookingRecord["billingTreatment"];
    }>[]
  > {
    await Promise.resolve();
    return this.bookings
      .filter(
        (booking) =>
          booking.producerId === producerId && booking.sessionAllowanceId === sessionAllowanceId,
      )
      .map((booking) => ({
        bookingId: booking.id,
        allowanceUseId: booking.allowanceUseId,
        outcome: booking.outcome,
        billingTreatment: booking.billingTreatment,
      }));
  }

  async listScheduleEntries(producerId: string): Promise<readonly SessionBookingScheduleEntry[]> {
    await Promise.resolve();
    return this.bookings
      .filter(
        (booking) =>
          booking.producerId === producerId &&
          (booking.status === "pending_approval" || booking.status === "confirmed"),
      )
      .map((booking) => ({
        id: booking.id,
        startsAt: booking.startsAt,
        durationMin: booking.durationMin,
        bufferMinutes: this.context.allowance.bufferMinutes,
      }));
  }

  async loadGoogleCalendarReconciliationContext(input: {
    jobId: string;
    producerId: string;
    bookingCalendarLinkId: string;
    leaseToken: string;
  }) {
    await Promise.resolve();
    const active = this.activeReconciliation;
    const link = this.bookingCalendarLinks.find(
      (candidate) =>
        candidate.id === input.bookingCalendarLinkId && candidate.producerId === input.producerId,
    );
    return active &&
      link &&
      active.jobId === input.jobId &&
      active.linkId === input.bookingCalendarLinkId &&
      active.leaseToken === input.leaseToken
      ? {
          link,
          currentBookingId: link.currentBookingId,
          capturedRevision: active.capturedRevision,
        }
      : null;
  }

  async loadBookingCalendarRecoveryLink(input: { bookingId: string; producerId: string }) {
    await Promise.resolve();
    return (
      this.bookingCalendarLinks.find(
        (link) =>
          link.currentBookingId === input.bookingId &&
          link.producerId === input.producerId &&
          link.providerState === "active",
      ) ?? null
    );
  }

  async findGoogleCalendarRecoveryJob(input: {
    producerId: string;
    bookingCalendarLinkId: string;
    operationKey: string;
  }) {
    await Promise.resolve();
    return (
      this.calendarJobs.find(
        (job) =>
          job.producerId === input.producerId &&
          job.bookingCalendarLinkId === input.bookingCalendarLinkId &&
          job.lastManualRetryOperationKey === input.operationKey,
      ) ?? null
    );
  }

  async insertBooking(input: NewSessionBookingRecord): Promise<SessionBookingRecord> {
    await Promise.resolve();
    if (
      this.bookings.some(
        (booking) =>
          booking.producerId === input.producerId && booking.operationKey === input.operationKey,
      )
    ) {
      throw new Error("duplicate booking operation key");
    }
    if (
      input.rescheduledFromBookingId !== null &&
      this.bookings.some(
        (booking) => booking.rescheduledFromBookingId === input.rescheduledFromBookingId,
      )
    ) {
      throw new Error("duplicate booking replacement");
    }
    const { occurredAt, ...values } = input;
    const booking: SessionBookingRecord = {
      ...values,
      id: `booking-${String(++this.#bookingSequence)}`,
      statusChangedAt: occurredAt,
      outcomeChangedAt: occurredAt,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    this.bookings.push(booking);
    return booking;
  }

  async updateBooking(input: {
    bookingId: string;
    producerId: string;
    expectedStatus: "pending_approval" | "confirmed";
    status: SessionBookingRecord["status"];
    outcome: SessionUseOutcome;
    occurredAt: Date;
    heldExpiredAt?: Date;
    heldExpiryReason?: "approval_timeout";
  }): Promise<SessionBookingRecord> {
    await Promise.resolve();
    const index = this.bookings.findIndex(
      (booking) => booking.id === input.bookingId && booking.producerId === input.producerId,
    );
    const existing = this.bookings[index];
    if (!existing || existing.status !== input.expectedStatus) {
      throw new Error("booking compare-and-swap failed");
    }
    const updated: SessionBookingRecord = {
      ...existing,
      status: input.status,
      outcome: input.outcome,
      statusChangedAt: input.occurredAt,
      outcomeChangedAt: input.occurredAt,
      calendarRevision: existing.calendarRevision + 1,
      updatedAt: input.occurredAt,
      ...(input.heldExpiredAt
        ? {
            heldExpiredAt: input.heldExpiredAt,
            heldExpiryReason: input.heldExpiryReason ?? null,
          }
        : {}),
    };
    this.bookings[index] = updated;
    return updated;
  }

  async updateBookingCalendarProjection(input: {
    bookingId: string;
    producerId: string;
    expectedCalendarRevision: number;
    nextCalendarRevision: number;
    title?: string | null;
    artistRsvpStatus?: SessionBookingRecord["artistRsvpStatus"];
    artistRsvpRespondedAt?: Date | null;
    occurredAt: Date;
  }): Promise<SessionBookingRecord> {
    await Promise.resolve();
    const index = this.bookings.findIndex(
      (booking) => booking.id === input.bookingId && booking.producerId === input.producerId,
    );
    const existing = this.bookings[index];
    if (
      !existing ||
      existing.status !== "confirmed" ||
      existing.calendarRevision !== input.expectedCalendarRevision
    ) {
      throw new Error("booking calendar compare-and-swap failed");
    }
    const updated: SessionBookingRecord = {
      ...existing,
      calendarRevision: input.nextCalendarRevision,
      ...(Object.prototype.hasOwnProperty.call(input, "title")
        ? { title: input.title ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "artistRsvpStatus")
        ? {
            artistRsvpStatus: input.artistRsvpStatus ?? null,
            artistRsvpRespondedAt: input.artistRsvpRespondedAt ?? null,
          }
        : {}),
      updatedAt: input.occurredAt,
    };
    this.bookings[index] = updated;
    return updated;
  }

  async insertTransitionEvent(
    input: SessionBookingTransitionEventDraft,
  ): Promise<StoredSessionBookingTransitionEvent> {
    await Promise.resolve();
    if (
      this.events.some(
        (event) => event.bookingId === input.bookingId && event.operationKey === input.operationKey,
      )
    ) {
      throw new Error("duplicate booking transition operation key");
    }
    const event = { ...input, id: `event-${String(++this.#eventSequence)}` };
    this.events.push(event);
    return event;
  }

  async insertChangeRequest(
    input: NewSessionBookingChangeRequestRecord,
  ): Promise<SessionBookingChangeRequestRecord> {
    await Promise.resolve();
    if (
      this.changeRequests.some(
        (request) => request.bookingId === input.bookingId && request.status === "pending",
      )
    ) {
      throw new Error("duplicate pending request");
    }
    const { occurredAt, ...values } = input;
    const request: SessionBookingChangeRequestRecord = {
      ...values,
      id: `request-${String(++this.#changeRequestSequence)}`,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    this.changeRequests.push(request);
    return request;
  }

  async decideChangeRequest(input: {
    requestId: string;
    producerId: string;
    status: "approved" | "rejected";
    decisionOperationKey: string;
    decisionOperationDigest: string;
    decidedByClerkUserId: string;
    decidedAt: Date;
    replacementBookingId: string | null;
  }): Promise<SessionBookingChangeRequestRecord> {
    await Promise.resolve();
    const index = this.changeRequests.findIndex(
      (request) =>
        request.id === input.requestId &&
        request.producerId === input.producerId &&
        request.status === "pending",
    );
    const existing = this.changeRequests[index];
    if (!existing) throw new Error("request compare-and-swap failed");
    const request: SessionBookingChangeRequestRecord = {
      ...existing,
      status: input.status,
      decisionOperationKey: input.decisionOperationKey,
      decisionOperationDigest: input.decisionOperationDigest,
      decidedByClerkUserId: input.decidedByClerkUserId,
      decidedAt: input.decidedAt,
      replacementBookingId: input.replacementBookingId,
      updatedAt: input.decidedAt,
    };
    this.changeRequests[index] = request;
    return request;
  }

  async findCalendarSyncJob(input: {
    uid: string;
    desiredRevision: number;
  }): Promise<CalendarSyncJobRecord | null> {
    await Promise.resolve();
    return (
      this.calendarJobs.find(
        (job) =>
          job.deliveryChannel === "ics" &&
          job.payloadSnapshot.schemaVersion === 1 &&
          job.payloadSnapshot.uid === input.uid &&
          job.desiredRevision === input.desiredRevision,
      ) ?? null
    );
  }

  async findGoogleCalendarSyncJob(input: {
    producerId: string;
    bookingCalendarLinkId: string;
    desiredRevision: number;
  }): Promise<CalendarSyncJobRecord | null> {
    await Promise.resolve();
    return (
      this.calendarJobs.find(
        (job) =>
          job.deliveryChannel === "google" &&
          (job.operation === "upsert_google_event" || job.operation === "delete_google_event") &&
          job.producerId === input.producerId &&
          job.bookingCalendarLinkId === input.bookingCalendarLinkId &&
          job.desiredRevision === input.desiredRevision,
      ) ?? null
    );
  }

  async findCalendarSyncJobForEvent(input: {
    bookingId: string;
    producerId: string;
    occurredAt: Date;
    intent: "opaque_hold" | "confirmed" | "delete";
  }): Promise<CalendarSyncJobRecord | null> {
    await Promise.resolve();
    return (
      this.calendarJobs.find(
        (job) =>
          job.bookingId === input.bookingId &&
          job.producerId === input.producerId &&
          this.calendarJobOccurredAt.get(job.id)?.getTime() === input.occurredAt.getTime() &&
          (input.intent === "opaque_hold"
            ? job.payloadSnapshot.schemaVersion === 2 &&
              job.payloadSnapshot.action === "upsert" &&
              job.payloadSnapshot.eventKind === "opaque_hold"
            : input.intent === "confirmed"
              ? (job.payloadSnapshot.schemaVersion === 1 &&
                  job.payloadSnapshot.method === "REQUEST") ||
                (job.payloadSnapshot.schemaVersion === 2 &&
                  job.payloadSnapshot.action === "upsert" &&
                  job.payloadSnapshot.eventKind === "confirmed")
              : (job.payloadSnapshot.schemaVersion === 1 &&
                  job.payloadSnapshot.method === "CANCEL") ||
                (job.payloadSnapshot.schemaVersion === 2 &&
                  job.payloadSnapshot.action === "delete")),
      ) ?? null
    );
  }

  async prepareBookingCalendarLink(input: {
    bookingId: string;
    producerId: string;
    allowanceUseId: string;
    desiredRevision: number;
    allowCreate: boolean;
    occurredAt: Date;
  }): Promise<BookingCalendarLinkRecord | null> {
    await Promise.resolve();
    const index = this.bookingCalendarLinks.findIndex(
      (link) =>
        link.producerId === input.producerId &&
        link.allowanceUseId === input.allowanceUseId &&
        link.connectionId === this.googleConnectionId &&
        link.accountVersion === this.googleAccountVersion,
    );
    const existing = this.bookingCalendarLinks[index];
    if (existing) {
      if (input.desiredRevision < existing.desiredRevision) {
        throw new Error("calendar revision moved backwards");
      }
      const updated = {
        ...existing,
        currentBookingId: input.bookingId,
        desiredRevision: input.desiredRevision,
      };
      this.bookingCalendarLinks[index] = updated;
      return updated;
    }
    if (!input.allowCreate || !this.googleConnected) return null;
    const link: BookingCalendarLinkRecord = {
      id: `calendar-link-${String(this.bookingCalendarLinks.length + 1)}`,
      producerId: input.producerId,
      allowanceUseId: input.allowanceUseId,
      currentBookingId: input.bookingId,
      connectionId: this.googleConnectionId,
      accountVersion: this.googleAccountVersion,
      desiredRevision: input.desiredRevision,
      providerEventEtag: null,
      providerEventUpdatedAt: null,
      providerState: "uncreated",
      syncState: "pending",
      syncStateChangedAt: input.occurredAt,
      lastInboundReconciledAt: null,
      lastSyncErrorCode: null,
    };
    this.bookingCalendarLinks.push(link);
    return link;
  }

  async advanceGoogleCalendarLink(input: {
    linkId: string;
    producerId: string;
    expectedCurrentBookingId: string;
    expectedDesiredRevision: number;
    currentBookingId: string;
    desiredRevision: number;
    syncState: BookingCalendarLinkRecord["syncState"];
    lastSyncErrorCode: BookingCalendarLinkRecord["lastSyncErrorCode"];
    providerEventEtag?: string;
    providerEventUpdatedAt?: Date;
    lastInboundReconciledAt?: Date;
    occurredAt: Date;
  }): Promise<BookingCalendarLinkRecord> {
    await Promise.resolve();
    const index = this.bookingCalendarLinks.findIndex(
      (link) => link.id === input.linkId && link.producerId === input.producerId,
    );
    const existing = this.bookingCalendarLinks[index];
    if (
      !existing ||
      existing.currentBookingId !== input.expectedCurrentBookingId ||
      existing.desiredRevision !== input.expectedDesiredRevision
    ) {
      throw new Error("calendar link compare-and-swap failed");
    }
    const updated: BookingCalendarLinkRecord = {
      ...existing,
      currentBookingId: input.currentBookingId,
      desiredRevision: input.desiredRevision,
      syncState: input.syncState,
      syncStateChangedAt:
        existing.syncState === input.syncState &&
        existing.lastSyncErrorCode === input.lastSyncErrorCode
          ? existing.syncStateChangedAt
          : input.occurredAt,
      lastSyncErrorCode: input.lastSyncErrorCode,
      ...(input.providerEventEtag === undefined
        ? {}
        : { providerEventEtag: input.providerEventEtag }),
      ...(input.providerEventUpdatedAt === undefined
        ? {}
        : { providerEventUpdatedAt: input.providerEventUpdatedAt }),
      ...(input.lastInboundReconciledAt === undefined
        ? {}
        : { lastInboundReconciledAt: input.lastInboundReconciledAt }),
    };
    this.bookingCalendarLinks[index] = updated;
    return updated;
  }

  async completeGoogleCalendarReconciliationJob(input: {
    jobId: string;
    producerId: string;
    bookingCalendarLinkId: string;
    capturedRevision: number;
    leaseToken: string;
    completedAt: Date;
  }): Promise<boolean> {
    await Promise.resolve();
    const active = this.activeReconciliation;
    if (
      !active ||
      active.jobId !== input.jobId ||
      active.linkId !== input.bookingCalendarLinkId ||
      active.leaseToken !== input.leaseToken ||
      active.capturedRevision !== input.capturedRevision
    ) {
      return false;
    }
    this.activeReconciliation = null;
    return true;
  }

  async insertCalendarSyncJob(input: NewCalendarSyncJobRecord): Promise<CalendarSyncJobRecord> {
    await Promise.resolve();
    if (this.failNextCalendarSyncInsert) {
      this.failNextCalendarSyncInsert = false;
      throw new Error("calendar outbox unavailable");
    }
    const { occurredAt, ...values } = input;
    const job: CalendarSyncJobRecord = {
      ...values,
      id: `calendar-job-${String(++this.#calendarJobSequence)}`,
      manualRetryCount: input.manualRetryCount ?? 0,
      lastManualRetryAt: input.lastManualRetryAt ?? null,
      lastManualRetryActor: input.lastManualRetryActor ?? null,
      lastManualRetryOperationKey: input.lastManualRetryOperationKey ?? null,
      lastManualRetryOperationDigest: input.lastManualRetryOperationDigest ?? null,
    };
    this.calendarJobs.push(job);
    this.calendarJobOccurredAt.set(job.id, occurredAt);
    return job;
  }
}

function createInput(
  overrides: Partial<CreateSessionBookingInput> = {},
): CreateSessionBookingInput {
  return {
    producerId: "producer-sk68",
    projectId: "project-sk68",
    purchaseId: "purchase-sk68",
    sessionAllowanceId: "allowance-sk68",
    actorClerkUserId: "artist-clerk-sk68",
    startsAt: new Date("2026-07-20T10:00:00.000Z"),
    operationKey: "create-sk68",
    now: baseNow,
    ...overrides,
  };
}

function artistCommand(bookingId: string, operationKey: string, now = baseNow) {
  return {
    bookingId,
    actorClerkUserId: "artist-clerk-sk68",
    operationKey,
    now,
  };
}

function producerCommand(bookingId: string, operationKey: string, now = baseNow) {
  return {
    bookingId,
    producerId: "producer-sk68",
    actorClerkUserId: "producer-clerk-sk68",
    operationKey,
    now,
  };
}

function consumedUses(repository: MemorySessionBookingRepository): number {
  return new Set(
    repository.bookings
      .filter((booking) => sessionUseConsumesAllowance(booking.outcome, booking.billingTreatment))
      .map((booking) => booking.allowanceUseId),
  ).size;
}

function googlePayload(job: CalendarSyncJobRecord | undefined) {
  if (!job || job.deliveryChannel !== "google" || job.payloadSnapshot.schemaVersion !== 2) {
    throw new Error("Expected a Google calendar job");
  }
  return job.payloadSnapshot;
}

async function linkedConfirmedReconciliationFixture() {
  const repository = new MemorySessionBookingRepository(
    createContext({ autoConfirmBookings: true, sessionLimit: 3 }),
  );
  repository.googleConnected = true;
  const created = await createSessionBooking(repository, createInput());
  const existingLink = repository.bookingCalendarLinks[0];
  if (!existingLink) throw new Error("Expected a Google Calendar link");
  const link: BookingCalendarLinkRecord = {
    ...existingLink,
    providerState: "active",
    providerEventEtag: '"etag-1"',
    providerEventUpdatedAt: new Date("2026-08-09T11:00:00.000Z"),
    syncState: "synced",
    syncStateChangedAt: new Date("2026-08-09T11:00:00.000Z"),
  };
  repository.bookingCalendarLinks[0] = link;
  repository.activeReconciliation = {
    jobId: "00000000-0000-4000-8000-000000000101",
    linkId: link.id,
    leaseToken: "lease-domain-reconcile",
    capturedRevision: created.booking.calendarRevision,
  };
  const prepared: GoogleCalendarPreparedReconciliation = {
    job: {
      id: repository.activeReconciliation.jobId,
      bookingId: created.booking.id,
      producerId: created.booking.producerId,
      bookingCalendarLinkId: link.id,
      desiredRevision: created.booking.calendarRevision,
      payloadSnapshot: {
        schemaVersion: 3,
        action: "reconcile",
        source: "recovery",
        watchId: null,
        messageNumber: null,
      },
      attemptCount: 1,
    },
    currentBookingId: created.booking.id,
    artistEmail: created.booking.artistEmail,
    link: {
      id: link.id,
      producerId: link.producerId,
      connectionId: link.connectionId,
      accountVersion: link.accountVersion,
      destinationSelectionId: "00000000-0000-4000-8000-000000000102",
      destinationCalendarIdCiphertext: "ciphertext",
      destinationCalendarIdIv: "abcdefghijklmnop",
      destinationCalendarIdAuthTag: "abcdefghijklmnopqrstuv",
      destinationCalendarIdKeyVersion: 1,
      providerEventId: "sk00000000000040008000000000000102",
      providerEventEtag: link.providerEventEtag,
      providerState: "active",
      desiredRevision: link.desiredRevision,
      lastGoogleRevision: 1,
      invitationRevision: 1,
      invitationChannel: "google",
      invitationReservedAt: baseNow,
      invitationAttemptedAt: baseNow,
      invitationDeliveredAt: baseNow,
    },
  };
  return { repository, created, prepared };
}

describe("session booking lifecycle commands", () => {
  it("creates a producer manual session as confirmed without weakening the artist identity gate", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: false }),
    );
    repository.artistClerkLinked = false;

    await expect(createSessionBooking(repository, createInput())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const result = await createProducerManualSessionBooking(repository, {
      producerId: "producer-sk68",
      clientContactId: "client-sk68",
      projectId: "project-sk68",
      purchaseId: "purchase-sk68",
      sessionAllowanceId: "allowance-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      startsAt: new Date("2026-07-20T10:00:00.000Z"),
      title: "  Vocal session  ",
      billingTreatment: "complimentary",
      acknowledgedWarnings: [],
      operationKey: "producer-manual-create",
      now: baseNow,
    });

    expect(result).toMatchObject({
      created: true,
      booking: {
        status: "confirmed",
        origin: "producer_manual",
        billingTreatment: "complimentary",
        title: "Vocal session",
        durationMin: 60,
      },
    });
    expect(repository.events[0]).toMatchObject({
      kind: "created",
      actorKind: "producer",
      actorId: "producer-clerk-sk68",
    });
  });

  it("replays a committed manual create before mutable entitlement and title validation", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: false, sessionLimit: 1 }),
    );
    const input = {
      producerId: "producer-sk68",
      clientContactId: "client-sk68",
      projectId: "project-sk68",
      purchaseId: "purchase-sk68",
      sessionAllowanceId: "allowance-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      startsAt: new Date("2026-07-20T10:00:00.000Z"),
      billingTreatment: "included" as const,
      acknowledgedWarnings: [] as string[],
      operationKey: "manual-replay-before-preview",
      now: baseNow,
    };
    const created = await createProducerManualSessionBooking(repository, input);
    const exhaustedReplay = await createProducerManualSessionBooking(repository, input);
    expect(exhaustedReplay).toMatchObject({
      created: false,
      booking: { id: created.booking.id, title: "Studio session" },
      calendarSyncJobId: created.calendarSyncJobId,
    });

    repository.context = {
      ...repository.context,
      project: { ...repository.context.project, lifecycleStatus: "paused" },
      purchase: {
        ...repository.context.purchase,
        lifecycleStatus: "canceled",
        defaultSessionTitle: "Renamed after booking",
      },
      allowance: { ...repository.context.allowance, closedAt: new Date(baseNow) },
    };
    const inactiveReplay = await createProducerManualSessionBooking(repository, input);
    const routerReplay = await findProducerManualSessionBookingReplay(repository, input);
    expect(inactiveReplay).toMatchObject({
      created: false,
      booking: { id: created.booking.id, title: "Studio session" },
      calendarSyncJobId: created.calendarSyncJobId,
    });
    expect(routerReplay).toMatchObject({
      created: false,
      booking: { id: created.booking.id },
      calendarSyncJobId: created.calendarSyncJobId,
    });
    expect(repository.bookings).toHaveLength(1);
    expect(repository.calendarJobs).toHaveLength(1);

    await expect(
      findProducerManualSessionBookingReplay(repository, {
        ...input,
        billingTreatment: "complimentary",
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    await expect(
      findProducerManualSessionBookingReplay(repository, {
        ...input,
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    await expect(
      createProducerManualSessionBooking(repository, {
        ...input,
        producerId: "another-producer",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      findProducerManualSessionBookingReplay(repository, {
        ...input,
        producerId: "another-producer",
      }),
    ).resolves.toBeNull();
  });

  it("replays a lost reduced-protection manual-create response without weakening its digest", async () => {
    const repository = new MemorySessionBookingRepository();
    const input = {
      producerId: "producer-sk68",
      clientContactId: "client-sk68",
      projectId: "project-sk68",
      purchaseId: "purchase-sk68",
      sessionAllowanceId: "allowance-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      startsAt: new Date("2026-07-20T10:00:00.000Z"),
      billingTreatment: "included" as const,
      acknowledgedWarnings: [] as string[],
      acknowledgedReducedGoogleProtection: true,
      operationKey: "manual-reduced-protection-lost-response",
      now: baseNow,
    };

    const created = await createProducerManualSessionBooking(repository, input);
    const replay = await findProducerManualSessionBookingReplay(repository, input);

    expect(created.created).toBe(true);
    expect(replay).toMatchObject({
      created: false,
      booking: { id: created.booking.id },
      calendarSyncJobId: created.calendarSyncJobId,
    });
    expect(repository.bookings).toHaveLength(1);

    await expect(
      findProducerManualSessionBookingReplay(repository, {
        ...input,
        acknowledgedReducedGoogleProtection: false,
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("requires the producer to acknowledge fresh warnings and never permits a hard overlap", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: false }),
    );
    const outsideHours = {
      producerId: "producer-sk68",
      clientContactId: "client-sk68",
      projectId: "project-sk68",
      purchaseId: "purchase-sk68",
      sessionAllowanceId: "allowance-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      startsAt: new Date("2026-07-20T20:00:00.000Z"),
      billingTreatment: "included" as const,
      operationKey: "manual-warning",
      now: baseNow,
    };

    await expect(
      createProducerManualSessionBooking(repository, {
        ...outsideHours,
        acknowledgedWarnings: [],
      }),
    ).rejects.toMatchObject({ code: "WARNING_ACKNOWLEDGEMENT_REQUIRED" });

    const warned = await createProducerManualSessionBooking(repository, {
      ...outsideHours,
      acknowledgedWarnings: ["OUTSIDE_AVAILABILITY"],
    });
    expect(warned.booking.status).toBe("confirmed");

    await expect(
      createProducerManualSessionBooking(repository, {
        ...outsideHours,
        operationKey: "manual-hard-overlap",
        billingTreatment: "complimentary",
        acknowledgedWarnings: ["OUTSIDE_AVAILABILITY", "BOOKING_CONFLICT"],
      }),
    ).rejects.toMatchObject({ code: "BOOKING_CONFLICT" });
  });

  it("makes fresh Google busy a hard conflict for a producer manual create", async () => {
    const repository = new MemorySessionBookingRepository();
    const input = {
      producerId: "producer-sk68",
      clientContactId: "client-sk68",
      projectId: "project-sk68",
      purchaseId: "purchase-sk68",
      sessionAllowanceId: "allowance-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      startsAt: new Date("2026-07-20T10:00:00.000Z"),
      billingTreatment: "included" as const,
      googleBusyIntervals: [
        {
          startsAt: new Date("2026-07-20T10:15:00.000Z"),
          endsAt: new Date("2026-07-20T10:45:00.000Z"),
        },
      ],
      operationKey: "manual-google-busy",
      now: baseNow,
    };

    await expect(
      createProducerManualSessionBooking(repository, {
        ...input,
        acknowledgedWarnings: [],
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_BUSY" });
    await expect(
      createProducerManualSessionBooking(repository, {
        ...input,
        acknowledgedWarnings: ["GOOGLE_BUSY"],
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_BUSY" });
  });

  it("replays the same create intent and conflicts on the same key with a different digest", async () => {
    const repository = new MemorySessionBookingRepository();
    const first = await createSessionBooking(repository, createInput());
    const replay = await createSessionBooking(
      repository,
      createInput({ now: new Date(baseNow.getTime() + 5_000) }),
    );

    expect(first.created).toBe(true);
    expect(first.booking).toMatchObject({
      title: "Studio session",
      origin: "artist_request",
      billingTreatment: "included",
      durationMin: 60,
      calendarRevision: 1,
      artistRsvpStatus: null,
    });
    expect(replay).toMatchObject({ created: false, booking: { id: first.booking.id } });
    expect(repository.bookings).toHaveLength(1);
    expect(repository.events).toHaveLength(1);

    await expect(
      createSessionBooking(
        repository,
        createInput({ startsAt: new Date("2026-07-20T12:00:00.000Z") }),
      ),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("hard-blocks a new artist command on Google busy but preserves an earlier replay", async () => {
    const repository = new MemorySessionBookingRepository();
    const original = await createSessionBooking(repository, createInput());
    const busy = [
      {
        startsAt: new Date("2026-07-20T10:15:00.000Z"),
        endsAt: new Date("2026-07-20T10:45:00.000Z"),
      },
    ];

    await expect(
      createSessionBooking(repository, createInput({ googleBusyIntervals: busy })),
    ).resolves.toMatchObject({ created: false, booking: { id: original.booking.id } });
    await expect(
      createSessionBooking(
        repository,
        createInput({ operationKey: "skitza-overlap-wins", googleBusyIntervals: busy }),
      ),
    ).rejects.toMatchObject({ code: "BOOKING_CONFLICT" });
    await expect(
      createSessionBooking(
        repository,
        createInput({
          operationKey: "artist-google-busy",
          startsAt: new Date("2026-07-20T12:00:00.000Z"),
          googleBusyIntervals: [
            {
              startsAt: new Date("2026-07-20T12:15:00.000Z"),
              endsAt: new Date("2026-07-20T12:45:00.000Z"),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_BUSY" });
  });

  it("binds normalized title, origin, and billing treatment to create idempotency", async () => {
    const repository = new MemorySessionBookingRepository();
    const input = createInput({
      operationKey: "metadata-bound-create",
      title: "  Vocal production  ",
      origin: "producer_manual",
      billingTreatment: "complimentary",
    });
    const first = await createSessionBooking(repository, input);
    const replay = await createSessionBooking(repository, input);

    expect(first.booking).toMatchObject({
      title: "Vocal production",
      origin: "producer_manual",
      billingTreatment: "complimentary",
    });
    expect(replay).toMatchObject({ created: false, booking: { id: first.booking.id } });

    for (const changed of [
      { title: "Mix review" },
      { origin: "artist_request" as const },
      { billingTreatment: "included" as const },
    ]) {
      await expect(
        createSessionBooking(repository, { ...input, ...changed }),
      ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    }
  });

  it("falls back to the normalized purchase title for a null new-booking title", async () => {
    const repository = new MemorySessionBookingRepository();
    const created = await createSessionBooking(
      repository,
      createInput({ operationKey: "null-title-create", title: null }),
    );

    expect(created.booking.title).toBe("Studio session");
  });

  it("keeps the stored and ICS titles purchase-derived while Google uses the project name", async () => {
    const icsRepository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const icsCreated = await createSessionBooking(
      icsRepository,
      createInput({ operationKey: "purchase-title-ics", title: null }),
    );

    expect(icsCreated.booking.title).toBe("Studio session");
    expect(icsRepository.calendarJobs[0]?.payloadSnapshot).toMatchObject({
      schemaVersion: 1,
      summary: "Studio session",
    });

    const googleRepository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    googleRepository.googleConnected = true;
    const googleCreated = await createSessionBooking(
      googleRepository,
      createInput({ operationKey: "project-name-google", title: null }),
    );

    expect(googleCreated.booking.title).toBe("Studio session");
    expect(googlePayload(googleRepository.calendarJobs[0])).toMatchObject({
      summary: "SK-68 Project · SK-68 Producer & SK-68 Artist",
    });
  });

  it("replays a default-title create after the project fallback title changes", async () => {
    const repository = new MemorySessionBookingRepository();
    const input = createInput({ operationKey: "stable-default-title" });
    const created = await createSessionBooking(repository, input);
    repository.context = {
      ...repository.context,
      purchase: {
        ...repository.context.purchase,
        defaultSessionTitle: "Renamed project",
      },
    };

    const replay = await createSessionBooking(repository, input);

    expect(replay).toMatchObject({
      created: false,
      booking: { id: created.booking.id, title: "Studio session" },
    });
  });

  it("replays the original create result after the booking later changes", async () => {
    const repository = new MemorySessionBookingRepository();
    const input = createInput({ operationKey: "stable-create-replay" });
    const created = await createSessionBooking(repository, input);

    await rejectSessionBooking(
      repository,
      producerCommand(created.booking.id, "reject-after-create"),
    );
    const replay = await createSessionBooking(repository, {
      ...input,
      now: new Date(baseNow.getTime() + 5_000),
    });

    expect(replay).toMatchObject({
      created: false,
      booking: { id: created.booking.id, status: "pending_approval", outcome: "reserved" },
    });
    expect(repository.bookings[0]).toMatchObject({
      status: "rejected",
      outcome: "cancelled_by_producer",
    });
  });

  it("replays a local-slot create without re-resolving a changed producer timezone", async () => {
    const repository = new MemorySessionBookingRepository({
      ...createContext(),
      producer: { ...createContext().producer, timeZone: "UTC" },
      availabilityBlocks: [{ weekday: 0, startMin: 0, endMin: 6 * 60 }],
    });
    const { startsAt: _startsAt, ...baseInput } = createInput({
      operationKey: "timezone-stable-create",
      now: new Date("2026-03-28T00:00:00.000Z"),
    });
    void _startsAt;
    const input = {
      ...baseInput,
      localSlot: { date: "2026-03-29", startMin: 2 * 60 + 30 },
    };
    const created = await createSessionBooking(repository, input);
    expect(created.booking.startsAt.toISOString()).toBe("2026-03-29T02:30:00.000Z");

    repository.context = {
      ...repository.context,
      producer: { ...repository.context.producer, timeZone: "Europe/Berlin" },
    };
    const replay = await createSessionBooking(repository, input);

    expect(replay).toMatchObject({ created: false, booking: { id: created.booking.id } });
    expect(replay.booking.startsAt.toISOString()).toBe("2026-03-29T02:30:00.000Z");
  });

  it("confirms automatically only when enabled in producer truth", async () => {
    const manual = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: false }),
    );
    const automatic = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );

    expect((await createSessionBooking(manual, createInput())).booking.status).toBe(
      "pending_approval",
    );
    expect((await createSessionBooking(automatic, createInput())).booking.status).toBe("confirmed");
  });

  it("creates a private Google hold and promotes the same event when confirmed", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: false, durationMin: 90 }),
    );
    repository.googleConnected = true;

    const created = await createSessionBooking(
      repository,
      createInput({ title: "Private vocal session" }),
    );
    const holdJob = repository.calendarJobs[0];
    const link = repository.bookingCalendarLinks[0];
    expect(created.calendarSyncJobId).toBe(holdJob?.id);
    expect(link).toMatchObject({
      currentBookingId: created.booking.id,
      desiredRevision: 1,
    });
    expect(googlePayload(holdJob)).toEqual({
      schemaVersion: 2,
      action: "upsert",
      eventKind: "opaque_hold",
      notificationMode: "none",
      sequence: 1,
      startsAtUtc: "2026-07-20T10:00:00.000Z",
      endsAtUtc: "2026-07-20T11:30:00.000Z",
      summary: "Reserved",
      artistSafeUrl: null,
      attendee: null,
      privateProperties: {
        skitzaLink: link?.id,
        skitzaRevision: "1",
        skitzaSchema: "1",
      },
    });
    expect(JSON.stringify(googlePayload(holdJob))).not.toContain("Private vocal session");
    expect(JSON.stringify(googlePayload(holdJob))).not.toContain("sk68-artist@example.invalid");

    const command = producerCommand(created.booking.id, "confirm-google-hold");
    const confirmed = await confirmSessionBooking(repository, command);
    const replay = await confirmSessionBooking(repository, command);
    const confirmedJob = repository.calendarJobs[1];
    expect(confirmed.calendarSyncJobId).toBe(confirmedJob?.id);
    expect(replay).toMatchObject({
      changed: false,
      calendarSyncJobId: confirmedJob?.id,
    });
    expect(repository.calendarJobs).toHaveLength(2);
    expect(repository.bookingCalendarLinks).toHaveLength(1);
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      id: link?.id,
      currentBookingId: created.booking.id,
      desiredRevision: 2,
    });
    expect(googlePayload(confirmedJob)).toEqual({
      schemaVersion: 2,
      action: "upsert",
      eventKind: "confirmed",
      notificationMode: "all",
      sequence: 2,
      startsAtUtc: "2026-07-20T10:00:00.000Z",
      endsAtUtc: "2026-07-20T11:30:00.000Z",
      summary: "SK-68 Project · SK-68 Producer & SK-68 Artist",
      artistSafeUrl: `https://skitza.app/artist/sessions/${created.booking.id}`,
      attendee: {
        name: "SK-68 Artist",
        email: "sk68-artist@example.invalid",
      },
      privateProperties: {
        skitzaLink: link?.id,
        skitzaRevision: "2",
        skitzaSchema: "1",
      },
    });
  });

  it("deletes rejected, withdrawn, and expired Google holds without notifying the artist", async () => {
    const cases = [
      {
        label: "rejected",
        run: (repository: MemorySessionBookingRepository, booking: SessionBookingRecord) =>
          rejectSessionBooking(repository, producerCommand(booking.id, "delete-rejected-hold")),
      },
      {
        label: "withdrawn",
        run: (repository: MemorySessionBookingRepository, booking: SessionBookingRecord) =>
          cancelArtistSessionBooking(
            repository,
            artistCommand(booking.id, "delete-withdrawn-hold"),
          ),
      },
      {
        label: "expired",
        run: (repository: MemorySessionBookingRepository, booking: SessionBookingRecord) =>
          expireHeldSessionBooking(repository, {
            bookingId: booking.id,
            operationKey: "delete-expired-hold",
            now: booking.heldExpiresAt ?? baseNow,
          }),
      },
    ];

    for (const testCase of cases) {
      const repository = new MemorySessionBookingRepository(
        createContext({ autoConfirmBookings: false }),
      );
      repository.googleConnected = true;
      const created = await createSessionBooking(
        repository,
        createInput({ operationKey: `create-${testCase.label}-hold` }),
      );
      const result = await testCase.run(repository, created.booking);
      const deleteJob = repository.calendarJobs[1];
      expect(result.calendarSyncJobId, testCase.label).toBe(deleteJob?.id);
      expect(deleteJob, testCase.label).toMatchObject({
        bookingCalendarLinkId: repository.bookingCalendarLinks[0]?.id,
        operation: "delete_google_event",
        desiredRevision: 2,
      });
      expect(googlePayload(deleteJob), testCase.label).toMatchObject({
        action: "delete",
        notificationMode: "none",
        sequence: 2,
      });
    }
  });

  it("resolves create and reschedule wall-clock slots from the locked producer timezone", async () => {
    const repository = new MemorySessionBookingRepository({
      ...createContext({ sessionLimit: 1, autoConfirmBookings: true }),
      producer: {
        ...createContext().producer,
        timeZone: "Asia/Jerusalem",
        autoConfirmBookings: true,
      },
    });
    const { startsAt: _createStartsAt, ...createWallClockInput } = createInput();
    void _createStartsAt;
    const created = await createSessionBooking(repository, {
      ...createWallClockInput,
      localSlot: { date: "2026-07-20", startMin: 10 * 60 },
    });

    expect(created.booking.startsAt.toISOString()).toBe("2026-07-20T07:00:00.000Z");

    const rescheduled = await rescheduleArtistSessionBooking(repository, {
      ...artistCommand(created.booking.id, "timezone-reschedule"),
      localSlot: { date: "2026-07-20", startMin: 12 * 60 },
    });
    expect(rescheduled.booking.startsAt.toISOString()).toBe("2026-07-20T09:00:00.000Z");
  });

  it("samples the default command clock only after entering the atomic scope", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-19T06:00:00.000Z"));
      const repository = new MemorySessionBookingRepository();
      const { now: _injectedNow, ...inputWithoutClock } = createInput({
        operationKey: "clock-after-lock",
      });
      void _injectedNow;
      const pending = createSessionBooking(repository, inputWithoutClock);

      vi.setSystemTime(new Date("2026-07-19T07:00:00.000Z"));
      const created = await pending;

      expect(created.booking.createdAt.toISOString()).toBe("2026-07-19T07:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes identical concurrent creates into one booking and one event", async () => {
    const repository = new MemorySessionBookingRepository();
    const results = await Promise.all([
      createSessionBooking(repository, createInput()),
      createSessionBooking(repository, createInput()),
    ]);

    expect(new Set(results.map((result) => result.booking.id))).toHaveLength(1);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(repository.bookings).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
  });

  it("allows only one winner when different operations race for one fixed use", async () => {
    const repository = new MemorySessionBookingRepository(createContext({ sessionLimit: 1 }));
    const results = await Promise.allSettled([
      createSessionBooking(repository, createInput({ operationKey: "fixed-a" })),
      createSessionBooking(
        repository,
        createInput({
          operationKey: "fixed-b",
          startsAt: new Date("2026-07-20T12:00:00.000Z"),
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "ALLOWANCE_EXHAUSTED" });
    expect(repository.bookings).toHaveLength(1);
    expect(consumedUses(repository)).toBe(1);
  });

  it("does not impose a fixed-use ceiling on an unlimited allowance", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ allowanceKind: "unlimited", sessionLimit: null }),
    );

    for (const [index, hour] of [10, 12, 14].entries()) {
      await createSessionBooking(
        repository,
        createInput({
          operationKey: `unlimited-${String(index)}`,
          startsAt: new Date(`2026-07-20T${String(hour).padStart(2, "0")}:00:00.000Z`),
        }),
      );
    }

    expect(repository.bookings).toHaveLength(3);
    expect(consumedUses(repository)).toBe(3);
  });

  it.each([
    [
      "waiting purchase",
      { purchaseLifecycleStatus: "waiting_for_payment" as const },
      "PURCHASE_INACTIVE",
    ],
    ["paused project", { projectLifecycleStatus: "paused" as const }, "PROJECT_INACTIVE"],
    ["closed allowance", { closedAt: baseNow }, "ALLOWANCE_CLOSED"],
  ])("blocks create for %s", async (_label, contextOverrides, code) => {
    const repository = new MemorySessionBookingRepository(createContext(contextOverrides));
    await expect(createSessionBooking(repository, createInput())).rejects.toMatchObject({ code });
    expect(repository.bookings).toHaveLength(0);
  });

  it("enforces weekly availability and blackouts in the command, not only the slot UI", async () => {
    const outside = new MemorySessionBookingRepository();
    await expect(
      createSessionBooking(
        outside,
        createInput({ startsAt: new Date("2026-07-20T19:00:00.000Z") }),
      ),
    ).rejects.toMatchObject({ code: "OUTSIDE_AVAILABILITY" });

    const blackout = new MemorySessionBookingRepository({
      ...createContext(),
      blackouts: [{ startDate: "2026-07-20", endDate: "2026-07-20" }],
    });
    await expect(createSessionBooking(blackout, createInput())).rejects.toMatchObject({
      code: "BLACKOUT",
    });
  });

  it("enforces the producer-local daily cap in the locked create command", async () => {
    const repository = new MemorySessionBookingRepository(createContext({ maxSessionsPerDay: 1 }));
    await createSessionBooking(repository, createInput());

    await expect(
      createSessionBooking(
        repository,
        createInput({
          operationKey: "daily-cap-second",
          startsAt: new Date("2026-07-20T12:00:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "DAILY_LIMIT" });
  });

  it("returns an on-time artist cancellation and replays it exactly once", async () => {
    const repository = new MemorySessionBookingRepository(createContext({ sessionLimit: 1 }));
    const created = await createSessionBooking(repository, createInput());
    const first = await cancelArtistSessionBooking(
      repository,
      artistCommand(created.booking.id, "artist-cancel"),
    );
    const replay = await cancelArtistSessionBooking(
      repository,
      artistCommand(created.booking.id, "artist-cancel", new Date(baseNow.getTime() + 1_000)),
    );

    expect(first).toMatchObject({
      changed: true,
      booking: { status: "cancelled", outcome: "cancelled_on_time" },
    });
    expect(replay).toMatchObject({ changed: false, booking: { id: created.booking.id } });
    expect(repository.events).toHaveLength(2);
    expect(consumedUses(repository)).toBe(0);

    const replacementUse = await createSessionBooking(
      repository,
      createInput({
        operationKey: "create-after-cancel",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    );
    expect(replacementUse.created).toBe(true);
  });

  it("deletes a confirmed Google event with notifications and reuses its link after reconnect", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, sessionLimit: 1 }),
    );
    repository.googleConnected = true;
    const created = await createSessionBooking(repository, createInput());
    const linkId = repository.bookingCalendarLinks[0]?.id;

    repository.googleConnected = false;
    repository.googleConnected = true;
    const command = producerCommand(created.booking.id, "cancel-google-confirmed");
    const cancelled = await cancelProducerSessionBooking(repository, command);
    const replay = await cancelProducerSessionBooking(repository, command);
    const deleteJob = repository.calendarJobs[1];

    expect(cancelled.calendarSyncJobId).toBe(deleteJob?.id);
    expect(replay.calendarSyncJobId).toBe(deleteJob?.id);
    expect(repository.bookingCalendarLinks).toHaveLength(1);
    expect(deleteJob).toMatchObject({
      bookingCalendarLinkId: linkId,
      operation: "delete_google_event",
      desiredRevision: 2,
    });
    expect(googlePayload(deleteJob)).toMatchObject({
      action: "delete",
      notificationMode: "all",
      sequence: 2,
    });
  });

  it("rejects producer cancellation and reschedule after a confirmed session has ended", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    const endedAt = new Date("2026-07-20T11:00:00.000Z");
    const nextStart = new Date("2026-07-20T12:00:00.000Z");

    await expect(
      cancelProducerSessionBooking(
        repository,
        producerCommand(created.booking.id, "cancel-ended-session", endedAt),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    await expect(
      loadProducerSessionRescheduleAvailabilitySnapshot(repository, {
        bookingId: created.booking.id,
        producerId: "producer-sk68",
        now: endedAt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    await expect(
      previewProducerSessionReschedule(repository, {
        bookingId: created.booking.id,
        producerId: "producer-sk68",
        startsAt: nextStart,
        now: endedAt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    await expect(
      rescheduleProducerSessionBooking(repository, {
        ...producerCommand(created.booking.id, "reschedule-ended-session", endedAt),
        startsAt: nextStart,
        warningAcknowledgements: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });

    expect(repository.bookings).toEqual([created.booking]);
    expect(repository.events).toHaveLength(1);
  });

  it("withdraws Held before the start even after the confirmed-session cutoff", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: false }),
    );
    const created = await createSessionBooking(repository, createInput());
    const afterCutoff = new Date("2026-07-19T12:00:00.000Z");

    await expect(
      rescheduleArtistSessionBooking(repository, {
        ...artistCommand(created.booking.id, "held-cannot-reschedule", afterCutoff),
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });

    await expect(
      cancelArtistSessionBooking(
        repository,
        artistCommand(created.booking.id, "withdraw-held", afterCutoff),
      ),
    ).resolves.toMatchObject({
      changed: true,
      booking: { status: "cancelled", outcome: "cancelled_on_time" },
    });
  });

  it("expires Held idempotently at min(created + 24h, startsAt) and blocks confirmation", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: false }),
    );
    const created = await createSessionBooking(repository, createInput());
    const expiresAt = new Date("2026-07-20T06:00:00.000Z");
    expect(created.booking.heldExpiresAt).toEqual(expiresAt);

    await expect(
      confirmSessionBooking(
        repository,
        producerCommand(created.booking.id, "confirm-after-expiry", expiresAt),
      ),
    ).rejects.toMatchObject({ code: "HELD_EXPIRED" });

    const first = await expireHeldSessionBooking(repository, {
      bookingId: created.booking.id,
      operationKey: "expire-held",
      now: expiresAt,
    });
    const replay = await expireHeldSessionBooking(repository, {
      bookingId: created.booking.id,
      operationKey: "expire-held",
      now: new Date(expiresAt.getTime() + 1_000),
    });
    expect(first).toMatchObject({
      changed: true,
      booking: {
        status: "cancelled",
        outcome: "cancelled_by_producer",
        heldExpiryReason: "approval_timeout",
      },
    });
    expect(replay).toMatchObject({ changed: false, booking: { id: created.booking.id } });
    expect(consumedUses(repository)).toBe(0);
  });

  it.each([
    ["paused", { projectLifecycleStatus: "paused" as const }],
    ["closed", { closedAt: baseNow }],
  ])("still permits cancellation when the purchased project is %s", async (_label, patch) => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    repository.context = createContext(patch);

    const capabilities = sessionBookingCapabilities({
      booking: created.booking,
      purchaseLifecycleStatus: repository.context.purchase.lifecycleStatus,
      projectLifecycleStatus: repository.context.project.lifecycleStatus,
      allowanceClosedAt: repository.context.allowance.closedAt,
      now: baseNow,
    });
    expect(capabilities).toMatchObject({ canCancel: true, canReschedule: false });

    await expect(
      rescheduleArtistSessionBooking(repository, {
        ...artistCommand(created.booking.id, `reschedule-${_label}`),
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: _label === "paused" ? "PROJECT_INACTIVE" : "ALLOWANCE_CLOSED",
    });
    await expect(
      cancelArtistSessionBooking(repository, artistCommand(created.booking.id, `cancel-${_label}`)),
    ).resolves.toMatchObject({ changed: true, booking: { outcome: "cancelled_on_time" } });
  });

  it("rejects late artist self-service while a producer-recorded late cancellation consumes the use", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    const lateNow = new Date("2026-07-20T09:00:00.000Z");

    await expect(
      recordLateArtistCancellation(
        repository,
        producerCommand(created.booking.id, "producer-record-late", baseNow),
      ),
    ).rejects.toMatchObject({ code: "CANCELLATION_WINDOW" });
    await expect(
      cancelArtistSessionBooking(
        repository,
        artistCommand(created.booking.id, "artist-too-late", lateNow),
      ),
    ).rejects.toMatchObject({ code: "CANCELLATION_WINDOW" });
    expect(repository.bookings[0]).toMatchObject({ status: "confirmed", outcome: "reserved" });

    const recorded = await recordLateArtistCancellation(
      repository,
      producerCommand(created.booking.id, "producer-record-late", lateNow),
    );
    expect(recorded.booking).toMatchObject({
      status: "cancelled",
      outcome: "cancelled_late",
    });
    expect(consumedUses(repository)).toBe(1);
    await expect(
      createSessionBooking(
        repository,
        createInput({
          operationKey: "after-late-cancel",
          startsAt: new Date("2026-07-20T12:00:00.000Z"),
          now: lateNow,
        }),
      ),
    ).rejects.toMatchObject({ code: "ALLOWANCE_EXHAUSTED" });
  });

  it("returns the use after producer cancellation and rejection", async () => {
    const producerCancelRepository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const confirmed = await createSessionBooking(producerCancelRepository, createInput());
    await cancelProducerSessionBooking(
      producerCancelRepository,
      producerCommand(confirmed.booking.id, "producer-cancel"),
    );
    expect(consumedUses(producerCancelRepository)).toBe(0);
    await expect(
      createSessionBooking(
        producerCancelRepository,
        createInput({
          operationKey: "after-producer-cancel",
          startsAt: new Date("2026-07-20T12:00:00.000Z"),
        }),
      ),
    ).resolves.toMatchObject({ created: true });

    const rejectionRepository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1 }),
    );
    const pending = await createSessionBooking(rejectionRepository, createInput());
    await rejectSessionBooking(
      rejectionRepository,
      producerCommand(pending.booking.id, "producer-reject"),
    );
    expect(consumedUses(rejectionRepository)).toBe(0);
  });

  it.each([
    ["archived", { artistArchived: true, artistClerkLinked: true }],
    ["unlinked", { artistArchived: false, artistClerkLinked: false }],
  ])(
    "keeps producer transitions available after the artist contact is %s while blocking artist commands",
    async (_label, identityState) => {
      const repository = new MemorySessionBookingRepository();
      const created = await createSessionBooking(repository, createInput());
      repository.artistArchived = identityState.artistArchived;
      repository.artistClerkLinked = identityState.artistClerkLinked;

      await expect(
        cancelArtistSessionBooking(
          repository,
          artistCommand(created.booking.id, `artist-cancel-${_label}`),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        cancelProducerSessionBooking(
          repository,
          producerCommand(created.booking.id, `producer-cancel-${_label}`),
        ),
      ).resolves.toMatchObject({
        changed: true,
        booking: { status: "cancelled", outcome: "cancelled_by_producer" },
      });
    },
  );

  it("confirms once and detects a different transition reusing the key", async () => {
    const repository = new MemorySessionBookingRepository();
    const created = await createSessionBooking(repository, createInput());
    const first = await confirmSessionBooking(
      repository,
      producerCommand(created.booking.id, "producer-transition"),
    );
    const replay = await confirmSessionBooking(
      repository,
      producerCommand(
        created.booking.id,
        "producer-transition",
        new Date(baseNow.getTime() + 10_000),
      ),
    );

    expect(first).toMatchObject({ changed: true, booking: { status: "confirmed" } });
    expect(replay).toMatchObject({ changed: false, booking: { status: "confirmed" } });
    await expect(
      rejectSessionBooking(repository, producerCommand(created.booking.id, "producer-transition")),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    expect(repository.events).toHaveLength(2);
  });

  it.each(["no_show", "completed"] as const)(
    "%s advances the booking audit revision without adding a calendar content job",
    async (terminalOutcome) => {
      const repository = new MemorySessionBookingRepository(
        createContext({ sessionLimit: 1, autoConfirmBookings: true }),
      );
      repository.googleConnected = true;
      const created = await createSessionBooking(repository, createInput());
      const originalLink = repository.bookingCalendarLinks[0];
      const terminal =
        terminalOutcome === "no_show"
          ? await markSessionNoShow(
              repository,
              producerCommand(
                created.booking.id,
                "producer-no-show",
                new Date("2026-07-20T10:00:00.000Z"),
              ),
            )
          : await completeSessionBooking(
              repository,
              producerCommand(
                created.booking.id,
                "producer-complete",
                new Date("2026-07-20T11:00:00.000Z"),
              ),
            );
      expect(repository.bookings[0]?.outcome).toBe(terminalOutcome);
      expect(terminal.booking.calendarRevision).toBe(created.booking.calendarRevision + 1);
      expect(repository.bookingCalendarLinks[0]).toMatchObject({
        id: originalLink?.id,
        currentBookingId: created.booking.id,
        desiredRevision: created.booking.calendarRevision,
      });
      expect(repository.calendarJobs).toHaveLength(1);
      expect(consumedUses(repository)).toBe(1);
      await expect(
        createSessionBooking(
          repository,
          createInput({
            operationKey: `after-${terminalOutcome}`,
            startsAt: new Date("2026-07-20T12:00:00.000Z"),
            now: new Date("2026-07-20T11:00:00.000Z"),
          }),
        ),
      ).rejects.toMatchObject({ code: "ALLOWANCE_EXHAUSTED" });
    },
  );

  it("reschedules as an immutable replacement, net one use, and replays both events", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const original = await createSessionBooking(repository, createInput());
    const command = {
      ...artistCommand(original.booking.id, "artist-reschedule"),
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
    };
    const first = await rescheduleArtistSessionBooking(repository, command);
    const replay = await rescheduleArtistSessionBooking(repository, {
      ...command,
      now: new Date(baseNow.getTime() + 1_000),
    });

    expect(first).toMatchObject({
      created: true,
      booking: {
        rescheduledFromBookingId: original.booking.id,
        outcome: "reserved",
        title: original.booking.title,
        origin: original.booking.origin,
        billingTreatment: original.booking.billingTreatment,
        calendarRevision: original.booking.calendarRevision + 1,
      },
      replacedBooking: {
        id: original.booking.id,
        status: "cancelled",
        outcome: "cancelled_on_time",
      },
    });
    expect(replay).toMatchObject({
      created: false,
      booking: { id: first.booking.id },
      replacedBooking: { id: original.booking.id },
    });
    expect(repository.bookings).toHaveLength(2);
    expect(repository.bookings.find((booking) => booking.id === original.booking.id)).toMatchObject(
      {
        calendarRevision: original.booking.calendarRevision + 1,
      },
    );
    expect(consumedUses(repository)).toBe(1);
    const rescheduleEvents = repository.events.filter(
      (event) => event.operationKey === command.operationKey,
    );
    expect(rescheduleEvents).toHaveLength(2);
    expect(new Set(rescheduleEvents.map((event) => event.bookingId))).toEqual(
      new Set([original.booking.id, first.booking.id]),
    );

    await expect(
      rescheduleArtistSessionBooking(repository, {
        ...command,
        startsAt: new Date("2026-07-20T14:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("patches the same Google event for an immutable confirmed reschedule", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    repository.googleConnected = true;
    const original = await createSessionBooking(
      repository,
      createInput({ title: "Tracking", operationKey: "google-reschedule-source" }),
    );
    const linkId = repository.bookingCalendarLinks[0]?.id;
    const command = {
      ...producerCommand(original.booking.id, "google-producer-reschedule"),
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      warningAcknowledgements: [] as string[],
    };

    const moved = await rescheduleProducerSessionBooking(repository, command);
    const replay = await rescheduleProducerSessionBooking(repository, command);
    const updateJob = repository.calendarJobs[1];

    expect(moved).toMatchObject({
      created: true,
      booking: { status: "confirmed", calendarRevision: 2 },
      replacedBooking: { id: original.booking.id, status: "cancelled" },
      calendarSyncJobId: updateJob?.id,
    });
    expect(replay).toMatchObject({ created: false, calendarSyncJobId: updateJob?.id });
    expect(repository.bookingCalendarLinks).toHaveLength(1);
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      id: linkId,
      currentBookingId: moved.booking.id,
      desiredRevision: 2,
    });
    expect(repository.calendarJobs).toHaveLength(2);
    expect(repository.calendarJobs.map((job) => job.bookingCalendarLinkId)).toEqual([
      linkId,
      linkId,
    ]);
    expect(repository.calendarJobs.map((job) => job.operation)).toEqual([
      "upsert_google_event",
      "upsert_google_event",
    ]);
    expect(googlePayload(updateJob)).toMatchObject({
      action: "upsert",
      eventKind: "confirmed",
      notificationMode: "all",
      sequence: 2,
      startsAtUtc: "2026-07-20T12:00:00.000Z",
      summary: "SK-68 Project · SK-68 Producer & SK-68 Artist",
    });
  });

  it("transfers billable-extra treatment even after an included credit is restored", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const included = await createSessionBooking(
      repository,
      createInput({ operationKey: "included-before-extra" }),
    );
    const billable = await createSessionBooking(
      repository,
      createInput({
        operationKey: "billable-source",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        billingTreatment: "billable_extra",
      }),
    );
    await cancelArtistSessionBooking(
      repository,
      artistCommand(included.booking.id, "restore-included-credit"),
    );

    expect(consumedUses(repository)).toBe(0);
    const replacement = await rescheduleArtistSessionBooking(repository, {
      ...artistCommand(billable.booking.id, "reschedule-billable-extra"),
      startsAt: new Date("2026-07-20T14:00:00.000Z"),
    });

    expect(replacement.booking).toMatchObject({
      billingTreatment: "billable_extra",
      allowanceUseId: billable.booking.allowanceUseId,
    });
    expect(consumedUses(repository)).toBe(0);
  });

  it("preserves a legacy null title only when creating its reschedule replacement", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const original = await createSessionBooking(repository, createInput());
    repository.bookings[0] = { ...original.booking, title: null, origin: "legacy" };

    const replacement = await rescheduleArtistSessionBooking(repository, {
      ...artistCommand(original.booking.id, "reschedule-legacy-null-title"),
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
    });

    expect(replacement.booking).toMatchObject({ title: null, origin: "legacy" });
  });

  it("keeps the confirmed original active while a manual-approval replacement is Held", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const original = await createSessionBooking(repository, createInput());
    repository.context = createContext({ sessionLimit: 1, autoConfirmBookings: false });

    const replacement = await rescheduleArtistSessionBooking(repository, {
      ...artistCommand(original.booking.id, "manual-reschedule-shared-credit"),
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
    });

    expect(replacement.booking.status).toBe("pending_approval");
    expect(replacement.replacedBooking.status).toBe("confirmed");
    expect(consumedUses(repository)).toBe(1);

    await confirmSessionBooking(
      repository,
      producerCommand(replacement.booking.id, "approve-reschedule"),
    );
    expect(
      repository.bookings.find((booking) => booking.id === replacement.booking.id),
    ).toMatchObject({ status: "confirmed", outcome: "reserved" });
    expect(repository.bookings.find((booking) => booking.id === original.booking.id)).toMatchObject(
      { status: "cancelled", outcome: "cancelled_on_time" },
    );
    expect(consumedUses(repository)).toBe(1);
  });

  it("does not overwrite the live Google event with a legacy pending replacement", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    repository.googleConnected = true;
    const original = await createSessionBooking(repository, createInput());
    const originalLink = repository.bookingCalendarLinks[0];
    repository.context = createContext({ sessionLimit: 1, autoConfirmBookings: false });

    const rescheduleCommand = {
      ...artistCommand(original.booking.id, "legacy-pending-google-reschedule"),
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
    };
    const pending = await rescheduleArtistSessionBooking(repository, rescheduleCommand);
    const rescheduleReplay = await rescheduleArtistSessionBooking(repository, rescheduleCommand);
    expect(pending).toMatchObject({
      booking: { status: "pending_approval", calendarRevision: 2 },
      replacedBooking: { id: original.booking.id, status: "confirmed" },
      calendarSyncJobId: null,
    });
    expect(rescheduleReplay.calendarSyncJobId).toBeNull();
    expect(repository.calendarJobs).toHaveLength(1);
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      id: originalLink?.id,
      currentBookingId: original.booking.id,
      desiredRevision: 1,
    });

    const confirmationCommand = producerCommand(
      pending.booking.id,
      "confirm-legacy-google-reschedule",
    );
    const confirmed = await confirmSessionBooking(repository, confirmationCommand);
    const confirmationReplay = await confirmSessionBooking(repository, confirmationCommand);
    const updateJob = repository.calendarJobs[1];
    expect(confirmed).toMatchObject({
      booking: { id: pending.booking.id, status: "confirmed", calendarRevision: 3 },
      calendarSyncJobId: updateJob?.id,
    });
    expect(confirmationReplay.calendarSyncJobId).toBe(updateJob?.id);
    expect(repository.bookingCalendarLinks).toHaveLength(1);
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      id: originalLink?.id,
      currentBookingId: pending.booking.id,
      desiredRevision: 3,
    });
    expect(googlePayload(updateJob)).toMatchObject({
      action: "upsert",
      eventKind: "confirmed",
      sequence: 3,
      startsAtUtc: "2026-07-20T12:00:00.000Z",
      privateProperties: {
        skitzaLink: originalLink?.id,
        skitzaRevision: "3",
      },
    });
  });

  it("uses the booking-time cancellation-policy snapshot after settings change", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, cancellationPolicyHours: 24 }),
    );
    const created = await createSessionBooking(repository, createInput());
    repository.context = createContext({
      autoConfirmBookings: true,
      cancellationPolicyHours: 1,
    });

    await expect(
      cancelArtistSessionBooking(
        repository,
        artistCommand(
          created.booking.id,
          "snapshot-policy-cancel",
          new Date("2026-07-20T07:00:00.000Z"),
        ),
      ),
    ).rejects.toMatchObject({ code: "CANCELLATION_WINDOW" });
  });

  it("replays the original reschedule result after the replacement later changes", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const original = await createSessionBooking(repository, createInput());
    repository.context = createContext({ sessionLimit: 1, autoConfirmBookings: false });
    const command = {
      ...artistCommand(original.booking.id, "stable-reschedule-replay"),
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
    };
    const replacement = await rescheduleArtistSessionBooking(repository, command);

    await rejectSessionBooking(
      repository,
      producerCommand(replacement.booking.id, "reject-after-reschedule"),
    );
    const replay = await rescheduleArtistSessionBooking(repository, {
      ...command,
      now: new Date(baseNow.getTime() + 5_000),
    });

    expect(replay).toMatchObject({
      created: false,
      booking: {
        id: replacement.booking.id,
        status: "pending_approval",
        outcome: "reserved",
      },
      replacedBooking: {
        id: original.booking.id,
        status: "confirmed",
        outcome: "reserved",
      },
    });
    expect(
      repository.bookings.find((booking) => booking.id === replacement.booking.id),
    ).toMatchObject({ status: "rejected", outcome: "cancelled_by_producer" });
  });

  it("replays a local-slot reschedule without re-resolving a changed producer timezone", async () => {
    const repository = new MemorySessionBookingRepository({
      ...createContext({ sessionLimit: 1, autoConfirmBookings: true }),
      producer: { ...createContext().producer, timeZone: "UTC", autoConfirmBookings: true },
      availabilityBlocks: [{ weekday: 0, startMin: 0, endMin: 6 * 60 }],
    });
    const commandNow = new Date("2026-03-28T00:00:00.000Z");
    const original = await createSessionBooking(
      repository,
      createInput({
        startsAt: new Date("2026-03-29T01:00:00.000Z"),
        now: commandNow,
        operationKey: "timezone-reschedule-source",
      }),
    );
    const command = {
      ...artistCommand(original.booking.id, "timezone-stable-reschedule", commandNow),
      localSlot: { date: "2026-03-29", startMin: 2 * 60 + 30 },
    };
    const replacement = await rescheduleArtistSessionBooking(repository, command);
    expect(replacement.booking.startsAt.toISOString()).toBe("2026-03-29T02:30:00.000Z");

    repository.context = {
      ...repository.context,
      producer: { ...repository.context.producer, timeZone: "Europe/Berlin" },
    };
    const replay = await rescheduleArtistSessionBooking(repository, command);

    expect(replay).toMatchObject({
      created: false,
      booking: { id: replacement.booking.id },
      replacedBooking: { id: original.booking.id },
    });
    expect(replay.booking.startsAt.toISOString()).toBe("2026-03-29T02:30:00.000Z");
  });

  it("allows one immutable replacement when two reschedules race", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const original = await createSessionBooking(repository, createInput());
    const results = await Promise.allSettled([
      rescheduleArtistSessionBooking(repository, {
        ...artistCommand(original.booking.id, "reschedule-race-a"),
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
      rescheduleArtistSessionBooking(repository, {
        ...artistCommand(original.booking.id, "reschedule-race-b"),
        startsAt: new Date("2026-07-20T14:00:00.000Z"),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    expect(repository.bookings).toHaveLength(2);
    expect(repository.bookings.filter((booking) => booking.rescheduledFromBookingId)).toHaveLength(
      1,
    );
    expect(consumedUses(repository)).toBe(1);
  });

  it("rejects a late reschedule without creating a replacement", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const original = await createSessionBooking(repository, createInput());

    await expect(
      rescheduleArtistSessionBooking(repository, {
        ...artistCommand(
          original.booking.id,
          "late-reschedule",
          new Date("2026-07-20T09:00:00.000Z"),
        ),
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "CANCELLATION_WINDOW" });
    expect(repository.bookings).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
  });

  it("stores one durable artist request, replays it, and rejects changed or duplicate intent", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    const command = {
      bookingId: created.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "cancel" as const,
      operationKey: "artist-cancel-request",
      now: baseNow,
    };

    const submitted = await submitArtistSessionChangeRequest(repository, command);
    const replay = await submitArtistSessionChangeRequest(repository, command);

    expect(submitted).toMatchObject({ replayed: false, request: { status: "pending" } });
    expect(replay).toMatchObject({ replayed: true, request: { id: submitted.request.id } });
    expect(repository.bookings[0]).toMatchObject({ status: "confirmed", calendarRevision: 1 });
    expect(repository.changeRequests).toHaveLength(1);

    await expect(
      submitArtistSessionChangeRequest(repository, {
        ...command,
        kind: "reschedule",
        proposedStartsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    await expect(
      submitArtistSessionChangeRequest(repository, {
        ...command,
        operationKey: "second-pending-request",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    await expect(
      submitArtistSessionChangeRequest(repository, {
        ...command,
        actorClerkUserId: "another-artist",
        operationKey: "cross-tenant-artist",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      cancelProducerSessionBooking(
        repository,
        producerCommand(created.booking.id, "cancel-around-pending-request"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
  });

  it("rejects a forged artist reschedule request unless the exact slot is currently allowed", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, sessionLimit: 2 }),
    );
    const source = await createSessionBooking(repository, createInput());
    await createSessionBooking(
      repository,
      createInput({
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        operationKey: "occupied-reschedule-slot",
      }),
    );
    const base = {
      bookingId: source.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "reschedule" as const,
      now: baseNow,
    };

    await expect(
      submitArtistSessionChangeRequest(repository, {
        ...base,
        proposedStartsAt: new Date("2026-07-20T12:00:00.000Z"),
        operationKey: "forged-overlap-request",
      }),
    ).rejects.toMatchObject({ code: "BOOKING_CONFLICT" });
    await expect(
      submitArtistSessionChangeRequest(repository, {
        ...base,
        proposedStartsAt: new Date("2026-07-20T20:00:00.000Z"),
        operationKey: "forged-outside-hours-request",
      }),
    ).rejects.toMatchObject({ code: "OUTSIDE_AVAILABILITY" });
    await expect(
      submitArtistSessionChangeRequest(repository, {
        ...base,
        proposedStartsAt: new Date("2026-07-20T14:00:00.000Z"),
        googleBusyIntervals: [
          {
            startsAt: new Date("2026-07-20T14:15:00.000Z"),
            endsAt: new Date("2026-07-20T14:45:00.000Z"),
          },
        ],
        operationKey: "google-busy-reschedule-request",
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_BUSY" });
    expect(repository.changeRequests).toEqual([]);
  });

  it("approves an on-time cancellation after the cutoff using request time and enqueues once", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, sessionLimit: 1 }),
    );
    const created = await createSessionBooking(repository, createInput());
    const submitted = await submitArtistSessionChangeRequest(repository, {
      bookingId: created.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "cancel",
      operationKey: "delayed-cancel-request",
      now: baseNow,
    });
    const decision = {
      requestId: submitted.request.id,
      producerId: "producer-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      decision: "approved" as const,
      operationKey: "approve-delayed-cancel",
      now: new Date("2026-07-19T12:00:00.000Z"),
    };

    await expect(
      decideProducerSessionChangeRequest(repository, {
        ...decision,
        producerId: "another-producer",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const approved = await decideProducerSessionChangeRequest(repository, decision);
    const replay = await decideProducerSessionChangeRequest(repository, decision);

    expect(approved).toMatchObject({
      changed: true,
      request: { status: "approved" },
      booking: { status: "cancelled", outcome: "cancelled_on_time", calendarRevision: 2 },
    });
    expect(approved.calendarSyncJobId).toBe(repository.calendarJobs[1]?.id);
    expect(replay).toMatchObject({
      changed: false,
      calendarSyncJobId: approved.calendarSyncJobId,
    });
    expect(consumedUses(repository)).toBe(0);
    expect(repository.calendarJobs).toHaveLength(2);
    expect(repository.calendarJobs[1]?.payloadSnapshot).toMatchObject({
      method: "CANCEL",
      sequence: 2,
      dtstampUtc: decision.now.toISOString(),
    });
    const requestReplay = await submitArtistSessionChangeRequest(repository, {
      bookingId: created.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "cancel",
      operationKey: "delayed-cancel-request",
      now: baseNow,
    });
    expect(requestReplay).toMatchObject({
      replayed: true,
      request: { id: submitted.request.id, status: "approved" },
    });
  });

  it("rejects a request without changing its booking, credit, event, or calendar delivery", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, sessionLimit: 1 }),
    );
    const created = await createSessionBooking(repository, createInput());
    const submitted = await submitArtistSessionChangeRequest(repository, {
      bookingId: created.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "cancel",
      operationKey: "reject-no-op-request",
      now: baseNow,
    });
    const before = {
      booking: repository.bookings[0],
      events: repository.events.length,
      jobs: repository.calendarJobs.length,
      uses: consumedUses(repository),
    };
    const command = {
      requestId: submitted.request.id,
      producerId: "producer-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      decision: "rejected" as const,
      operationKey: "reject-change-request",
      reason: "Artist and producer agreed to keep the session",
      now: new Date("2026-07-19T07:00:00.000Z"),
    };

    const rejected = await decideProducerSessionChangeRequest(repository, command);
    const replay = await decideProducerSessionChangeRequest(repository, command);

    expect(rejected).toMatchObject({ changed: true, request: { status: "rejected" } });
    expect(replay).toMatchObject({ changed: false, request: { id: rejected.request.id } });
    expect(repository.bookings[0]).toEqual(before.booking);
    expect(repository.events).toHaveLength(before.events);
    expect(repository.calendarJobs).toHaveLength(before.jobs);
    expect(consumedUses(repository)).toBe(before.uses);
    await expect(
      decideProducerSessionChangeRequest(repository, {
        ...command,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("approves a reschedule as an immutable confirmed replacement with one stable use and UID", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, sessionLimit: 1 }),
    );
    const created = await createSessionBooking(
      repository,
      createInput({ billingTreatment: "included", title: "Tracking" }),
    );
    const requested = await submitArtistSessionChangeRequest(repository, {
      bookingId: created.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "reschedule",
      proposedStartsAt: new Date("2026-07-20T12:00:00.000Z"),
      operationKey: "artist-reschedule-request",
      now: baseNow,
    });
    const result = await decideProducerSessionChangeRequest(repository, {
      requestId: requested.request.id,
      producerId: "producer-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      decision: "approved",
      operationKey: "approve-artist-reschedule",
      now: new Date("2026-07-19T07:00:00.000Z"),
    });

    expect(result).toMatchObject({
      changed: true,
      request: { status: "approved" },
      booking: { status: "cancelled", outcome: "cancelled_on_time", calendarRevision: 2 },
      replacementBooking: {
        status: "confirmed",
        calendarRevision: 2,
        billingTreatment: "included",
        title: "Tracking",
      },
    });
    expect(result.replacementBooking?.allowanceUseId).toBe(created.booking.allowanceUseId);
    expect(result.request.replacementBookingId).toBe(result.replacementBooking?.id);
    expect(consumedUses(repository)).toBe(1);
    expect(repository.calendarJobs).toHaveLength(2);
    expect(
      repository.calendarJobs.map((job) =>
        job.payloadSnapshot.schemaVersion === 1 ? job.payloadSnapshot.uid : null,
      ),
    ).toEqual([
      `booking-${created.booking.allowanceUseId}@skitza.app`,
      `booking-${created.booking.allowanceUseId}@skitza.app`,
    ]);
    expect(repository.calendarJobs[1]?.payloadSnapshot).toMatchObject({
      method: "REQUEST",
      sequence: 2,
    });
  });

  it("rechecks Google busy before approving an artist reschedule request", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, sessionLimit: 1 }),
    );
    const created = await createSessionBooking(repository, createInput());
    const proposedStartsAt = new Date("2026-07-20T12:00:00.000Z");
    const requested = await submitArtistSessionChangeRequest(repository, {
      bookingId: created.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "reschedule",
      proposedStartsAt,
      operationKey: "artist-google-recheck-request",
      now: baseNow,
    });

    await expect(
      decideProducerSessionChangeRequest(repository, {
        requestId: requested.request.id,
        producerId: "producer-sk68",
        actorClerkUserId: "producer-clerk-sk68",
        decision: "approved",
        operationKey: "approve-google-busy-request",
        googleBusyIntervals: [
          {
            startsAt: proposedStartsAt,
            endsAt: new Date(proposedStartsAt.getTime() + 30 * 60 * 1000),
          },
        ],
        now: new Date("2026-07-19T07:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_BUSY" });
    expect(repository.changeRequests[0]).toMatchObject({ status: "pending" });
    expect(repository.bookings).toHaveLength(1);
  });

  it("previews producer warnings and recomputes the exact acknowledgements under lock", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    const startsAt = new Date("2026-07-20T20:00:00.000Z");
    const preview = await previewProducerSessionReschedule(repository, {
      bookingId: created.booking.id,
      producerId: "producer-sk68",
      startsAt,
      now: baseNow,
    });

    expect(preview.hardConflicts).toEqual([]);
    expect(preview.warnings.map((warning) => warning.code)).toEqual(["OUTSIDE_AVAILABILITY"]);
    const command = {
      bookingId: created.booking.id,
      producerId: "producer-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      startsAt,
      warningAcknowledgements: [] as string[],
      operationKey: "producer-reschedule-warning",
      now: baseNow,
    };
    await expect(rescheduleProducerSessionBooking(repository, command)).rejects.toMatchObject({
      code: "WARNING_ACKNOWLEDGEMENT_REQUIRED",
    });
    await expect(
      rescheduleProducerSessionBooking(repository, {
        ...command,
        warningAcknowledgements: ["OUTSIDE_AVAILABILITY", "BLACKOUT"],
      }),
    ).rejects.toMatchObject({ code: "WARNING_ACKNOWLEDGEMENT_REQUIRED" });

    const rescheduled = await rescheduleProducerSessionBooking(repository, {
      ...command,
      warningAcknowledgements: ["OUTSIDE_AVAILABILITY"],
    });
    expect(rescheduled).toMatchObject({
      created: true,
      booking: { status: "confirmed", startsAt },
      replacedBooking: { status: "cancelled" },
    });
    expect(rescheduled.calendarSyncJobId).toBe(repository.calendarJobs[1]?.id);
    const replay = await rescheduleProducerSessionBooking(repository, {
      ...command,
      warningAcknowledgements: ["OUTSIDE_AVAILABILITY"],
    });
    expect(replay).toMatchObject({
      created: false,
      calendarSyncJobId: rescheduled.calendarSyncJobId,
    });
    expect(repository.calendarJobs).toHaveLength(2);
  });

  it("replays a lost reduced-protection producer-reschedule response conservatively", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const original = await createSessionBooking(repository, createInput());
    const command = {
      ...producerCommand(original.booking.id, "producer-reduced-reschedule-lost-response"),
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      warningAcknowledgements: [] as string[],
      acknowledgedReducedGoogleProtection: true,
    };

    const rescheduled = await rescheduleProducerSessionBooking(repository, command);
    const replay = await rescheduleProducerSessionBooking(repository, command);

    expect(rescheduled.created).toBe(true);
    expect(replay).toMatchObject({
      created: false,
      booking: { id: rescheduled.booking.id },
      calendarSyncJobId: rescheduled.calendarSyncJobId,
    });
    expect(repository.bookings).toHaveLength(2);

    await expect(
      rescheduleProducerSessionBooking(repository, {
        ...command,
        acknowledgedReducedGoogleProtection: false,
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("builds exact reschedule slots from the locked booking context and ignores only the source", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    const snapshot = await loadProducerSessionRescheduleAvailabilitySnapshot(repository, {
      bookingId: created.booking.id,
      producerId: "producer-sk68",
      now: baseNow,
    });
    const skitzaOnly = generateProducerSessionRescheduleAvailability(snapshot);
    const googleFiltered = generateProducerSessionRescheduleAvailability(snapshot, [
      {
        startsAt: created.booking.startsAt,
        endsAt: new Date(created.booking.startsAt.getTime() + 60 * 60 * 1000),
      },
    ]);

    expect(snapshot.durationMin).toBe(60);
    expect(
      skitzaOnly.days
        .flatMap((day) => day.slots)
        .some((slot) => slot.startsAt.getTime() === created.booking.startsAt.getTime()),
    ).toBe(true);
    expect(
      googleFiltered.days
        .flatMap((day) => day.slots)
        .some((slot) => slot.startsAt.getTime() === created.booking.startsAt.getTime()),
    ).toBe(false);
  });

  it("makes fresh Google busy a hard conflict during a direct producer reschedule", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    const startsAt = new Date("2026-07-20T12:00:00.000Z");
    const googleBusyIntervals = [
      {
        startsAt: startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
      },
    ];
    const preview = await previewProducerSessionReschedule(repository, {
      bookingId: created.booking.id,
      producerId: "producer-sk68",
      startsAt,
      googleBusyIntervals,
      now: baseNow,
    });
    expect(preview.warnings).toEqual([]);
    expect(preview.hardConflicts.map((conflict) => conflict.code)).toEqual(["GOOGLE_BUSY"]);

    const command = {
      bookingId: created.booking.id,
      producerId: "producer-sk68",
      actorClerkUserId: "producer-clerk-sk68",
      startsAt,
      googleBusyIntervals,
      warningAcknowledgements: [] as string[],
      operationKey: "producer-google-busy-reschedule",
      now: baseNow,
    };
    await expect(rescheduleProducerSessionBooking(repository, command)).rejects.toMatchObject({
      code: "GOOGLE_BUSY",
    });
    await expect(
      rescheduleProducerSessionBooking(repository, {
        ...command,
        warningAcknowledgements: ["GOOGLE_BUSY"],
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_BUSY" });
  });

  it("rolls back an approved cancellation when its calendar outbox insert fails", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true, sessionLimit: 1 }),
    );
    const created = await createSessionBooking(repository, createInput());
    const submitted = await submitArtistSessionChangeRequest(repository, {
      bookingId: created.booking.id,
      actorClerkUserId: "artist-clerk-sk68",
      kind: "cancel",
      operationKey: "atomic-cancel-request",
      now: baseNow,
    });
    repository.failNextCalendarSyncInsert = true;

    await expect(
      decideProducerSessionChangeRequest(repository, {
        requestId: submitted.request.id,
        producerId: "producer-sk68",
        actorClerkUserId: "producer-clerk-sk68",
        decision: "approved",
        operationKey: "atomic-cancel-decision",
        now: new Date("2026-07-19T07:00:00.000Z"),
      }),
    ).rejects.toThrow("calendar outbox unavailable");
    expect(repository.bookings).toHaveLength(1);
    expect(repository.bookings[0]).toMatchObject({ status: "confirmed", calendarRevision: 1 });
    expect(repository.changeRequests[0]).toMatchObject({ status: "pending" });
    expect(repository.events).toHaveLength(1);
    expect(repository.calendarJobs).toHaveLength(1);
    expect(consumedUses(repository)).toBe(1);
  });

  it("rolls back a confirmed create when its calendar outbox insert fails", async () => {
    const repository = new MemorySessionBookingRepository(
      createContext({ autoConfirmBookings: true }),
    );
    repository.googleConnected = true;
    repository.failNextCalendarSyncInsert = true;

    await expect(createSessionBooking(repository, createInput())).rejects.toThrow(
      "calendar outbox unavailable",
    );
    expect(repository.bookings).toEqual([]);
    expect(repository.events).toEqual([]);
    expect(repository.calendarJobs).toEqual([]);
    expect(repository.bookingCalendarLinks).toEqual([]);
  });

  it("restores the canonical Google title and fixed duration without renaming the app session", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();
    const result = await applyGoogleCalendarSessionReconciliation(
      repository,
      prepared,
      {
        outcome: "found",
        event: {
          eventId: prepared.link.providerEventId,
          etag: '"etag-2"',
          status: "confirmed",
          linkage: { opaqueLink: prepared.link.id, revision: 1, schemaVersion: 1 },
          updatedAt: new Date("2026-08-09T12:00:00.000Z"),
          summary: "  Updated mix review  ",
          timing: {
            kind: "timed",
            startsAt: created.booking.startsAt,
            endsAt: new Date(created.booking.startsAt.getTime() + 90 * 60 * 1_000),
          },
          artistRsvp: "accepted",
        },
      },
      {
        leaseToken: "lease-domain-reconcile",
        reconciledAt: new Date("2026-08-09T12:00:01.000Z"),
      },
    );

    expect(result).toEqual({ outcome: "corrected" });
    expect(repository.bookings[0]).toMatchObject({
      id: created.booking.id,
      title: "Studio session",
      durationMin: 60,
      calendarRevision: 2,
      artistRsvpStatus: "accepted",
    });
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      currentBookingId: created.booking.id,
      desiredRevision: 2,
      syncState: "pending",
      providerEventEtag: '"etag-2"',
    });
    const correction = googlePayload(repository.calendarJobs[1]);
    expect(correction).toMatchObject({
      action: "upsert",
      notificationMode: "none",
      sequence: 2,
      summary: "SK-68 Project · SK-68 Producer & SK-68 Artist",
      startsAtUtc: created.booking.startsAt.toISOString(),
      endsAtUtc: new Date(created.booking.startsAt.getTime() + 60 * 60 * 1_000).toISOString(),
    });
  });

  it("accepts a conflict-free Google move as an immutable replacement outside studio rules", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();
    const movedStartsAt = new Date("2026-07-21T04:00:00.000Z");

    await expect(
      applyGoogleCalendarSessionReconciliation(
        repository,
        prepared,
        {
          outcome: "found",
          event: {
            eventId: prepared.link.providerEventId,
            etag: '"etag-moved"',
            status: "confirmed",
            linkage: { opaqueLink: prepared.link.id, revision: 1, schemaVersion: 1 },
            updatedAt: new Date("2026-08-09T12:05:00.000Z"),
            summary: "SK-68 Project · SK-68 Producer & SK-68 Artist",
            timing: {
              kind: "timed",
              startsAt: movedStartsAt,
              endsAt: new Date(movedStartsAt.getTime() + 60 * 60 * 1_000),
            },
            artistRsvp: null,
          },
        },
        {
          leaseToken: "lease-domain-reconcile",
          reconciledAt: new Date("2026-08-09T12:05:01.000Z"),
        },
      ),
    ).resolves.toEqual({ outcome: "corrected" });

    expect(repository.bookings).toHaveLength(2);
    expect(repository.bookings[0]).toMatchObject({
      id: created.booking.id,
      status: "cancelled",
      calendarRevision: 2,
    });
    expect(repository.bookings[1]).toMatchObject({
      startsAt: movedStartsAt,
      durationMin: 60,
      status: "confirmed",
      rescheduledFromBookingId: created.booking.id,
      allowanceUseId: created.booking.allowanceUseId,
      calendarRevision: 2,
    });
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      currentBookingId: repository.bookings[1]?.id,
      desiredRevision: 2,
    });
    const rescheduleEvents = repository.events.filter((event) => event.kind === "rescheduled");
    expect(rescheduleEvents).toEqual([
      expect.objectContaining({
        bookingId: repository.bookings[1]?.id,
        fromStatus: null,
        oldStartsAt: null,
        newStartsAt: movedStartsAt,
      }),
      expect.objectContaining({
        bookingId: created.booking.id,
        fromStatus: "confirmed",
        oldStartsAt: created.booking.startsAt,
        newStartsAt: movedStartsAt,
      }),
    ]);
  });

  it("rejects a Google move that overlaps an active Skitza session and restores canonical data", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();
    const conflictStartsAt = new Date("2026-07-22T10:00:00.000Z");
    repository.bookings.push({
      ...created.booking,
      id: "booking-conflict",
      operationKey: "booking-conflict",
      operationDigest: "sha256:conflict",
      allowanceUseId: "allowance-use-conflict",
      startsAt: conflictStartsAt,
    });

    const result = await applyGoogleCalendarSessionReconciliation(
      repository,
      prepared,
      {
        outcome: "found",
        event: {
          eventId: prepared.link.providerEventId,
          etag: '"etag-conflict"',
          status: "confirmed",
          linkage: { opaqueLink: prepared.link.id, revision: 1, schemaVersion: 1 },
          updatedAt: new Date("2026-08-09T12:10:00.000Z"),
          summary: "Studio session",
          timing: {
            kind: "timed",
            startsAt: conflictStartsAt,
            endsAt: new Date(conflictStartsAt.getTime() + 60 * 60 * 1_000),
          },
          artistRsvp: null,
        },
      },
      {
        leaseToken: "lease-domain-reconcile",
        reconciledAt: new Date("2026-08-09T12:10:01.000Z"),
      },
    );

    expect(result).toEqual({ outcome: "conflict" });
    expect(repository.bookings.filter((booking) => booking.rescheduledFromBookingId)).toEqual([]);
    expect(repository.bookings[0]).toMatchObject({
      id: created.booking.id,
      status: "confirmed",
      startsAt: created.booking.startsAt,
      calendarRevision: 2,
    });
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      syncState: "conflict",
      lastSyncErrorCode: "skitza_overlap",
    });
    expect(googlePayload(repository.calendarJobs[1])).toMatchObject({
      startsAtUtc: created.booking.startsAt.toISOString(),
      notificationMode: "none",
    });
  });

  it("advances sync health time when a conflict changes to a different safe error", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();
    const conflictStartsAt = new Date("2026-07-22T10:00:00.000Z");
    const previousSyncStateChangedAt = new Date("2026-08-09T11:30:00.000Z");
    const [link] = repository.bookingCalendarLinks;
    if (!link) throw new Error("Expected a linked booking");
    repository.bookingCalendarLinks[0] = {
      ...link,
      syncState: "conflict",
      syncStateChangedAt: previousSyncStateChangedAt,
      lastSyncErrorCode: "stale_skitza_revision",
    };
    repository.bookings.push({
      ...created.booking,
      id: "booking-conflict-error-change",
      operationKey: "booking-conflict-error-change",
      operationDigest: "sha256:conflict-error-change",
      allowanceUseId: "allowance-use-conflict-error-change",
      startsAt: conflictStartsAt,
    });
    const reconciledAt = new Date("2026-08-09T12:12:01.000Z");

    await expect(
      applyGoogleCalendarSessionReconciliation(
        repository,
        prepared,
        {
          outcome: "found",
          event: {
            eventId: prepared.link.providerEventId,
            etag: '"etag-conflict-error-change"',
            status: "confirmed",
            linkage: { opaqueLink: prepared.link.id, revision: 1, schemaVersion: 1 },
            updatedAt: new Date("2026-08-09T12:12:00.000Z"),
            summary: "Studio session",
            timing: {
              kind: "timed",
              startsAt: conflictStartsAt,
              endsAt: new Date(conflictStartsAt.getTime() + 60 * 60 * 1_000),
            },
            artistRsvp: null,
          },
        },
        { leaseToken: "lease-domain-reconcile", reconciledAt },
      ),
    ).resolves.toEqual({ outcome: "conflict" });

    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      syncState: "conflict",
      lastSyncErrorCode: "skitza_overlap",
      syncStateChangedAt: reconciledAt,
    });
  });

  it("does not persist provider facts older than the linked event watermark", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();
    const [originalLink] = repository.bookingCalendarLinks;
    if (!originalLink?.providerEventUpdatedAt) throw new Error("Expected linked provider facts");

    await expect(
      applyGoogleCalendarSessionReconciliation(
        repository,
        prepared,
        {
          outcome: "found",
          event: {
            eventId: prepared.link.providerEventId,
            etag: '"etag-older"',
            status: "confirmed",
            linkage: { opaqueLink: prepared.link.id, revision: 1, schemaVersion: 1 },
            updatedAt: new Date("2026-08-09T10:59:59.000Z"),
            summary: "Studio session",
            timing: {
              kind: "timed",
              startsAt: created.booking.startsAt,
              endsAt: new Date(created.booking.startsAt.getTime() + 60 * 60 * 1_000),
            },
            artistRsvp: null,
          },
        },
        {
          leaseToken: "lease-domain-reconcile",
          reconciledAt: new Date("2026-08-09T12:14:00.000Z"),
        },
      ),
    ).resolves.toEqual({ outcome: "conflict" });

    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      providerEventEtag: originalLink.providerEventEtag,
      providerEventUpdatedAt: originalLink.providerEventUpdatedAt,
      syncState: "conflict",
      lastSyncErrorCode: "stale_skitza_revision",
    });
  });

  it("marks a missing Google event without cancelling the Skitza booking", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();

    await expect(
      applyGoogleCalendarSessionReconciliation(
        repository,
        prepared,
        { outcome: "missing" },
        {
          leaseToken: "lease-domain-reconcile",
          reconciledAt: new Date("2026-08-09T12:15:00.000Z"),
        },
      ),
    ).resolves.toEqual({ outcome: "missing" });

    expect(repository.bookings[0]).toMatchObject({
      id: created.booking.id,
      status: "confirmed",
      calendarRevision: 1,
    });
    expect(repository.bookingCalendarLinks[0]).toMatchObject({ syncState: "missing" });
    expect(repository.calendarJobs).toHaveLength(1);
  });

  it("does not let a stale missing-event check override a newer Skitza revision", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();
    const [booking] = repository.bookings;
    const [link] = repository.bookingCalendarLinks;
    if (!booking || !link) throw new Error("Expected a linked booking");
    repository.bookings[0] = { ...booking, calendarRevision: 2 };
    repository.bookingCalendarLinks[0] = {
      ...link,
      desiredRevision: 2,
      syncState: "pending",
    };

    await expect(
      applyGoogleCalendarSessionReconciliation(
        repository,
        prepared,
        { outcome: "missing" },
        {
          leaseToken: "lease-domain-reconcile",
          reconciledAt: new Date("2026-08-09T12:16:00.000Z"),
        },
      ),
    ).resolves.toEqual({ outcome: "conflict" });

    expect(repository.bookings[0]).toMatchObject({
      id: created.booking.id,
      status: "confirmed",
      calendarRevision: 2,
    });
    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      syncState: "conflict",
      lastSyncErrorCode: "stale_skitza_revision",
    });
    expect(repository.calendarJobs).toHaveLength(1);
  });

  it("stores only the primary artist RSVP without changing the calendar revision", async () => {
    const { repository, created, prepared } = await linkedConfirmedReconciliationFixture();

    await expect(
      applyGoogleCalendarSessionReconciliation(
        repository,
        prepared,
        {
          outcome: "found",
          event: {
            eventId: prepared.link.providerEventId,
            etag: '"etag-rsvp"',
            status: "confirmed",
            linkage: { opaqueLink: prepared.link.id, revision: 1, schemaVersion: 1 },
            updatedAt: new Date("2026-08-09T12:20:00.000Z"),
            summary: "SK-68 Project · SK-68 Producer & SK-68 Artist",
            timing: {
              kind: "timed",
              startsAt: created.booking.startsAt,
              endsAt: new Date(created.booking.startsAt.getTime() + 60 * 60 * 1_000),
            },
            artistRsvp: "declined",
          },
        },
        {
          leaseToken: "lease-domain-reconcile",
          reconciledAt: new Date("2026-08-09T12:20:01.000Z"),
        },
      ),
    ).resolves.toEqual({ outcome: "reconciled" });

    expect(repository.bookings[0]).toMatchObject({
      status: "confirmed",
      calendarRevision: 1,
      artistRsvpStatus: "declined",
      artistRsvpRespondedAt: new Date("2026-08-09T12:20:00.000Z"),
    });
    expect(repository.calendarJobs).toHaveLength(1);
  });

  it("restores a missing event once and safely replays the producer operation key", async () => {
    const { repository, created } = await linkedConfirmedReconciliationFixture();
    repository.activeReconciliation = null;
    const [link] = repository.bookingCalendarLinks;
    if (!link) throw new Error("Expected a linked booking");
    repository.bookingCalendarLinks[0] = {
      ...link,
      syncState: "missing",
      lastSyncErrorCode: null,
    };
    const command = {
      bookingId: created.booking.id,
      producerId: created.booking.producerId,
      actorClerkUserId: "producer-clerk-sk195",
      operationKey: "restore-google-event-sk195",
      now: new Date("2026-08-09T12:25:00.000Z"),
    };

    const first = await restoreMissingSessionBookingGoogleCalendarEvent(repository, command);
    const replay = await restoreMissingSessionBookingGoogleCalendarEvent(repository, command);

    expect(first).toEqual({ status: "missing", replayed: false });
    expect(replay).toEqual({ status: "missing", replayed: true });
    expect(repository.bookings[0]?.calendarRevision).toBe(2);
    expect(repository.calendarJobs).toHaveLength(2);
    expect(repository.calendarJobs[1]).toMatchObject({
      manualRetryCount: 1,
      lastManualRetryOperationKey: command.operationKey,
    });
    expect(googlePayload(repository.calendarJobs[1])).toMatchObject({
      notificationMode: "none",
      sequence: 2,
    });
  });

  it("retries a failed linked event without exposing or changing its provider identity", async () => {
    const { repository, created } = await linkedConfirmedReconciliationFixture();
    repository.activeReconciliation = null;
    const [link] = repository.bookingCalendarLinks;
    if (!link) throw new Error("Expected a linked booking");
    const linkId = link.id;
    repository.bookingCalendarLinks[0] = {
      ...link,
      syncState: "not_synced",
      lastSyncErrorCode: "provider_unavailable",
    };

    await expect(
      retrySessionBookingGoogleCalendarSync(repository, {
        bookingId: created.booking.id,
        producerId: created.booking.producerId,
        actorClerkUserId: "producer-clerk-sk195",
        operationKey: "retry-google-event-sk195",
        now: new Date("2026-08-09T12:30:00.000Z"),
      }),
    ).resolves.toEqual({ status: "pending", replayed: false });

    expect(repository.bookingCalendarLinks[0]).toMatchObject({
      id: linkId,
      syncState: "pending",
      lastSyncErrorCode: null,
      desiredRevision: 2,
    });
  });

  it("batches safe sync statuses and omits unlinked or other-producer sessions", async () => {
    const { repository, created } = await linkedConfirmedReconciliationFixture();
    const [link] = repository.bookingCalendarLinks;
    if (!link) throw new Error("Expected a linked booking");
    repository.bookingCalendarLinks[0] = { ...link, syncState: "missing" };
    repository.bookingCalendarLinks.push({
      ...link,
      id: "calendar-link-other-producer",
      producerId: "producer-other",
      currentBookingId: "booking-other-producer",
    });
    const findStatuses = vi.spyOn(repository, "findBookingGoogleCalendarSyncStatuses");

    await expect(
      getSessionBookingGoogleCalendarSyncStatuses(repository, {
        producerId: created.booking.producerId,
        bookingIds: [
          created.booking.id,
          "booking-without-link",
          "booking-other-producer",
          created.booking.id,
        ],
      }),
    ).resolves.toEqual([{ bookingId: created.booking.id, status: "missing" }]);
    expect(findStatuses).toHaveBeenCalledTimes(1);
    expect(findStatuses).toHaveBeenCalledWith({
      producerId: created.booking.producerId,
      bookingIds: [created.booking.id, "booking-without-link", "booking-other-producer"],
    });

    repository.googleConnected = false;
    await expect(
      getSessionBookingGoogleCalendarSyncStatuses(repository, {
        producerId: created.booking.producerId,
        bookingIds: [created.booking.id],
      }),
    ).resolves.toEqual([{ bookingId: created.booking.id, status: "disconnected" }]);
  });
});
