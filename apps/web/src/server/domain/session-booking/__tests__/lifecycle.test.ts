import { describe, expect, it, vi } from "vitest";

import {
  cancelArtistSessionBooking,
  cancelProducerSessionBooking,
  completeSessionBooking,
  confirmSessionBooking,
  createSessionBooking,
  expireHeldSessionBooking,
  markSessionNoShow,
  recordLateArtistCancellation,
  rejectSessionBooking,
  rescheduleArtistSessionBooking,
  sessionBookingCapabilities,
  sessionUseConsumesAllowance,
} from "../service";
import type {
  CreateSessionBookingInput,
  NewSessionBookingRecord,
  SessionBookingAtomicScope,
  SessionBookingContext,
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
  #bookingSequence = 0;
  #eventSequence = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(context: SessionBookingCreateContext = createContext()) {
    this.context = context;
  }

  atomically<T>(
    _scope: SessionBookingAtomicScope,
    work: (transaction: SessionBookingTransaction) => Promise<T>,
  ): Promise<T> {
    const result = this.#queue.then(() => work(this));
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
});
