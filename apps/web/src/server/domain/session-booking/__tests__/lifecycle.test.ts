import { describe, expect, it, vi } from "vitest";

import {
  cancelArtistSessionBooking,
  cancelProducerSessionBooking,
  completeSessionBooking,
  confirmSessionBooking,
  createProducerManualSessionBooking,
  createSessionBooking,
  decideProducerSessionChangeRequest,
  expireHeldSessionBooking,
  findProducerManualSessionBookingReplay,
  markSessionNoShow,
  recordLateArtistCancellation,
  rejectSessionBooking,
  previewProducerSessionReschedule,
  rescheduleArtistSessionBooking,
  rescheduleProducerSessionBooking,
  sessionBookingCapabilities,
  sessionUseConsumesAllowance,
  submitArtistSessionChangeRequest,
} from "../service";
import type {
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
  failNextCalendarSyncInsert = false;
  #bookingSequence = 0;
  #eventSequence = 0;
  #changeRequestSequence = 0;
  #calendarJobSequence = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(context: SessionBookingCreateContext = createContext()) {
    this.context = context;
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
            job.payloadSnapshot.method === "REQUEST" &&
            job.payloadSnapshot.dtstampUtc === event.occurredAt.toISOString(),
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
        this.#bookingSequence = sequences.booking;
        this.#eventSequence = sequences.event;
        this.#changeRequestSequence = sequences.changeRequest;
        this.#calendarJobSequence = sequences.calendarJob;
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
          job.payloadSnapshot.uid === input.uid && job.desiredRevision === input.desiredRevision,
      ) ?? null
    );
  }

  async findCalendarSyncJobForEvent(input: {
    bookingId: string;
    method: "REQUEST" | "CANCEL";
    occurredAt: Date;
  }): Promise<CalendarSyncJobRecord | null> {
    await Promise.resolve();
    return (
      this.calendarJobs.find(
        (job) =>
          job.bookingId === input.bookingId &&
          job.payloadSnapshot.method === input.method &&
          job.payloadSnapshot.dtstampUtc === input.occurredAt.toISOString(),
      ) ?? null
    );
  }

  async insertCalendarSyncJob(input: NewCalendarSyncJobRecord): Promise<CalendarSyncJobRecord> {
    await Promise.resolve();
    if (this.failNextCalendarSyncInsert) {
      this.failNextCalendarSyncInsert = false;
      throw new Error("calendar outbox unavailable");
    }
    const { occurredAt: _occurredAt, ...values } = input;
    void _occurredAt;
    const job = { ...values, id: `calendar-job-${String(++this.#calendarJobSequence)}` };
    this.calendarJobs.push(job);
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

  it("makes fresh Google busy overrideable only for a producer manual create", async () => {
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
    ).rejects.toMatchObject({ code: "WARNING_ACKNOWLEDGEMENT_REQUIRED" });
    await expect(
      createProducerManualSessionBooking(repository, {
        ...input,
        acknowledgedWarnings: ["GOOGLE_BUSY"],
      }),
    ).resolves.toMatchObject({ created: true, booking: { status: "confirmed" } });
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

  it.each(["no_show", "completed"] as const)("%s consumes a fixed use", async (terminalOutcome) => {
    const repository = new MemorySessionBookingRepository(
      createContext({ sessionLimit: 1, autoConfirmBookings: true }),
    );
    const created = await createSessionBooking(repository, createInput());
    if (terminalOutcome === "no_show") {
      await markSessionNoShow(
        repository,
        producerCommand(
          created.booking.id,
          "producer-no-show",
          new Date("2026-07-20T10:00:00.000Z"),
        ),
      );
    } else {
      await completeSessionBooking(
        repository,
        producerCommand(
          created.booking.id,
          "producer-complete",
          new Date("2026-07-20T11:00:00.000Z"),
        ),
      );
    }
    expect(repository.bookings[0]?.outcome).toBe(terminalOutcome);
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
  });

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
    expect(repository.calendarJobs.map((job) => job.payloadSnapshot.uid)).toEqual([
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

  it("lets the producer explicitly override Google busy during a direct reschedule", async () => {
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
    expect(preview.warnings.map((warning) => warning.code)).toEqual(["GOOGLE_BUSY"]);

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
      code: "WARNING_ACKNOWLEDGEMENT_REQUIRED",
    });
    await expect(
      rescheduleProducerSessionBooking(repository, {
        ...command,
        warningAcknowledgements: ["GOOGLE_BUSY"],
      }),
    ).resolves.toMatchObject({ created: true, booking: { startsAt } });
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
    repository.failNextCalendarSyncInsert = true;

    await expect(createSessionBooking(repository, createInput())).rejects.toThrow(
      "calendar outbox unavailable",
    );
    expect(repository.bookings).toEqual([]);
    expect(repository.events).toEqual([]);
    expect(repository.calendarJobs).toEqual([]);
  });
});
