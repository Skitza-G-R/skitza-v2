import { describe, expect, it, vi } from "vitest";

import {
  type CalendarDeliveryJob,
  type CalendarDeliveryRepository,
  processCalendarSyncJobs,
} from "./delivery";
import {
  type CalendarManualRetryRepository,
  CalendarManualRetryError,
  calendarManualRetryIdempotencyKey,
  calendarManualRetryRepository,
  manualRetryCalendarSyncJob,
} from "./manual-retry";

const terminalAt = new Date("2026-08-08T12:00:00.000Z");
const jobId = "00000000-0000-4000-8000-000000000001";
const producerId = "00000000-0000-4000-8000-000000000002";

class MemoryManualRetryRepository implements CalendarManualRetryRepository {
  readonly audit: Array<{
    operationKey: string;
    operationDigest: string;
    actorIdentity: string;
    priorIdempotencyKey: string;
    newIdempotencyKey: string;
    priorTerminalError: string;
  }> = [];

  readonly job = {
    id: jobId,
    producerId,
    status: "terminal" as "terminal" | "pending" | "processing" | "completed",
    idempotencyKey: "calendar:send_ics:booking-use:1",
    attemptCount: 8,
    firstAttemptAt: new Date("2026-08-07T12:00:00.000Z") as Date | null,
    lastAttemptAt: terminalAt as Date | null,
    providerDedupeExpiresAt: terminalAt as Date | null,
    nextAttemptAt: null as Date | null,
    lastError: "Email delivery failed" as string | null,
    terminalAt: terminalAt as Date | null,
    terminalError: "Provider idempotency window expired" as string | null,
    manualRetryCount: 0,
    lastManualRetryAt: null as Date | null,
    lastManualRetryActor: null as string | null,
    lastManualRetryOperationKey: null as string | null,
    lastManualRetryOperationDigest: null as string | null,
  };

  async reissueTerminalJob(
    command: Parameters<CalendarManualRetryRepository["reissueTerminalJob"]>[0],
  ) {
    await Promise.resolve();
    if (command.jobId !== this.job.id || command.producerId !== this.job.producerId) {
      throw new CalendarManualRetryError("NOT_FOUND", "not found");
    }
    const existing = this.audit.find((entry) => entry.operationKey === command.operationKey);
    if (existing) {
      if (existing.operationDigest !== command.operationDigest) {
        throw new CalendarManualRetryError("OPERATION_KEY_CONFLICT", "changed command");
      }
      return {
        jobId: this.job.id,
        producerId: this.job.producerId,
        retryNumber: this.audit.indexOf(existing) + 1,
        replayed: true,
        status: this.job.status,
        idempotencyKey: existing.newIdempotencyKey,
      } as const;
    }
    if (this.job.status !== "terminal" || this.job.terminalError === null) {
      throw new CalendarManualRetryError("NOT_TERMINAL", "not terminal");
    }

    const retryNumber = this.job.manualRetryCount + 1;
    const idempotencyKey = calendarManualRetryIdempotencyKey(
      this.job.id,
      retryNumber,
      command.operationDigest,
    );
    this.audit.push({
      operationKey: command.operationKey,
      operationDigest: command.operationDigest,
      actorIdentity: command.actorIdentity,
      priorIdempotencyKey: this.job.idempotencyKey,
      newIdempotencyKey: idempotencyKey,
      priorTerminalError: this.job.terminalError,
    });
    this.job.status = "pending";
    this.job.idempotencyKey = idempotencyKey;
    this.job.attemptCount = 0;
    this.job.firstAttemptAt = null;
    this.job.lastAttemptAt = null;
    this.job.providerDedupeExpiresAt = null;
    this.job.nextAttemptAt = command.requestedAt;
    this.job.lastError = null;
    this.job.terminalAt = null;
    this.job.terminalError = null;
    this.job.manualRetryCount = retryNumber;
    this.job.lastManualRetryAt = command.requestedAt;
    this.job.lastManualRetryActor = command.actorIdentity;
    this.job.lastManualRetryOperationKey = command.operationKey;
    this.job.lastManualRetryOperationDigest = command.operationDigest;
    return {
      jobId: this.job.id,
      producerId: this.job.producerId,
      retryNumber,
      replayed: false,
      status: this.job.status,
      idempotencyKey,
    } as const;
  }
}

function command(overrides: Partial<Parameters<typeof manualRetryCalendarSyncJob>[1]> = {}) {
  return {
    jobId,
    producerId,
    operationKey: "calendar-manual-retry-1",
    actorIdentity: "operator:gili",
    now: new Date("2026-08-09T12:00:00.000Z"),
    ...overrides,
  };
}

function googleTerminalDatabase() {
  const job = {
    id: jobId,
    producerId,
    deliveryChannel: "google" as const,
    status: "terminal" as "terminal" | "pending",
    idempotencyKey: `google:upsert_google_event:${jobId}:r1`,
    attemptCount: 3,
    firstAttemptAt: new Date("2026-08-08T10:00:00.000Z"),
    lastAttemptAt: new Date("2026-08-08T11:00:00.000Z"),
    providerDedupeExpiresAt: null,
    lastError: "Google Calendar delivery failed",
    terminalAt,
    terminalError: "Google Calendar delivery reached the retry limit",
    manualRetryCount: 0,
    updatedAt: terminalAt,
  };
  const audits: Array<{
    jobId: string;
    producerId: string;
    retryNumber: number;
    operationKey: string;
    operationDigest: string;
    newIdempotencyKey: string;
    priorProviderDedupeExpiresAt: Date | null;
  }> = [];
  const db = {
    transaction: async (run: (tx: never) => Promise<unknown>) => {
      let selectIndex = 0;
      const lockedJobQuery = {
        where: () => lockedJobQuery,
        limit: () => lockedJobQuery,
        for: () => Promise.resolve([job]),
      };
      const auditQuery = {
        where: () => auditQuery,
        limit: () => Promise.resolve(audits),
      };
      const tx = {
        select: () => ({
          from: () => (selectIndex++ === 0 ? lockedJobQuery : auditQuery),
        }),
        insert: () => ({
          values: (value: (typeof audits)[number]) => {
            audits.push(value);
            return Promise.resolve();
          },
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => ({
              returning: () => {
                Object.assign(job, values);
                return Promise.resolve([job]);
              },
            }),
          }),
        }),
      };
      return run(tx as never);
    },
  };
  return { db: db as never, job, audits };
}

describe("manualRetryCalendarSyncJob", () => {
  it("records the prior terminal cycle, rotates identity, and resets only delivery state", async () => {
    const repository = new MemoryManualRetryRepository();
    const originalKey = repository.job.idempotencyKey;

    const result = await manualRetryCalendarSyncJob(repository, command());

    expect(result).toMatchObject({ retryNumber: 1, replayed: false, status: "pending" });
    expect(result.idempotencyKey).not.toBe(originalKey);
    expect(repository.audit).toEqual([
      expect.objectContaining({
        operationKey: "calendar-manual-retry-1",
        actorIdentity: "operator:gili",
        priorIdempotencyKey: originalKey,
        newIdempotencyKey: result.idempotencyKey,
        priorTerminalError: "Provider idempotency window expired",
      }),
    ]);
    expect(repository.job).toMatchObject({
      status: "pending",
      attemptCount: 0,
      firstAttemptAt: null,
      lastAttemptAt: null,
      providerDedupeExpiresAt: null,
      lastError: null,
      terminalAt: null,
      terminalError: null,
      manualRetryCount: 1,
      lastManualRetryActor: "operator:gili",
      lastManualRetryOperationKey: "calendar-manual-retry-1",
    });
  });

  it("targets the exact producer-owned job and binds replay identity to the actor", async () => {
    const repository = new MemoryManualRetryRepository();
    await expect(
      manualRetryCalendarSyncJob(repository, command({ producerId: crypto.randomUUID() })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const first = await manualRetryCalendarSyncJob(repository, command());
    await expect(manualRetryCalendarSyncJob(repository, command())).resolves.toMatchObject({
      retryNumber: first.retryNumber,
      replayed: true,
      idempotencyKey: first.idempotencyKey,
    });
    await expect(
      manualRetryCalendarSyncJob(repository, command({ actorIdentity: "operator:other" })),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    expect(repository.audit).toHaveLength(1);
  });

  it("reissues and replays a terminal Google job with a null dedupe expiry", async () => {
    const state = googleTerminalDatabase();
    const repository = calendarManualRetryRepository(state.db);
    const input = command({ operationKey: "google-calendar-manual-retry-1" });

    const first = await manualRetryCalendarSyncJob(repository, input);

    expect(first).toMatchObject({ retryNumber: 1, replayed: false, status: "pending" });
    expect(first.idempotencyKey).toMatch(/^google:manual:/u);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]?.priorProviderDedupeExpiresAt).toBeNull();
    await expect(manualRetryCalendarSyncJob(repository, input)).resolves.toMatchObject({
      retryNumber: 1,
      replayed: true,
      idempotencyKey: first.idempotencyKey,
    });
    expect(state.audits).toHaveLength(1);
  });

  it("replays the original delivery identity after a later manual retry cycle", async () => {
    const repository = new MemoryManualRetryRepository();
    const first = await manualRetryCalendarSyncJob(repository, command());
    repository.job.status = "terminal";
    repository.job.attemptCount = 1;
    repository.job.firstAttemptAt = new Date("2026-08-09T12:00:01.000Z");
    repository.job.lastAttemptAt = new Date("2026-08-09T12:00:02.000Z");
    repository.job.providerDedupeExpiresAt = new Date("2026-08-10T12:00:01.000Z");
    repository.job.terminalAt = new Date("2026-08-10T12:00:02.000Z");
    repository.job.terminalError = "Provider idempotency window expired again";
    const second = await manualRetryCalendarSyncJob(
      repository,
      command({
        operationKey: "calendar-manual-retry-2",
        now: new Date("2026-08-10T12:00:03.000Z"),
      }),
    );

    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    await expect(manualRetryCalendarSyncJob(repository, command())).resolves.toMatchObject({
      retryNumber: 1,
      replayed: true,
      idempotencyKey: first.idempotencyKey,
    });
    expect(repository.audit).toHaveLength(2);
  });

  it("serializes concurrent replay of one operation into one audited retry", async () => {
    const repository = new MemoryManualRetryRepository();

    const results = await Promise.all([
      manualRetryCalendarSyncJob(repository, command()),
      manualRetryCalendarSyncJob(repository, command()),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.idempotencyKey))).toHaveLength(1);
    expect(repository.audit).toHaveLength(1);
  });

  it("feeds the rotated key into the next claimed delivery cycle", async () => {
    const manualRepository = new MemoryManualRetryRepository();
    const retried = await manualRetryCalendarSyncJob(manualRepository, command());
    const payload = {
      schemaVersion: 1,
      method: "REQUEST",
      uid: "booking-use@skitza.app",
      sequence: 1,
      dtstampUtc: "2026-08-08T12:00:00.000Z",
      startsAtUtc: "2026-08-10T12:00:00.000Z",
      endsAtUtc: "2026-08-10T13:00:00.000Z",
      summary: "Studio session",
      description: "A confirmed Skitza session.",
      organizer: { name: "Producer", email: "producer@example.com" },
      attendee: { name: "Artist", email: "artist@example.com" },
    } as const;
    const claimed: CalendarDeliveryJob = {
      id: jobId,
      bookingId: "00000000-0000-4000-8000-000000000003",
      producerId,
      deliveryChannel: "ics",
      bookingCalendarLinkId: null,
      operation: "send_ics",
      desiredRevision: 1,
      idempotencyKey: retried.idempotencyKey,
      payloadSnapshot: payload,
      attemptCount: 1,
      firstAttemptAt: command().now,
      providerDedupeExpiresAt: new Date("2026-08-10T12:00:00.000Z"),
      createdAt: terminalAt,
      updatedAt: command().now,
    };
    const deliveryRepository: CalendarDeliveryRepository = {
      claimDueJobs: vi.fn().mockResolvedValue([claimed]),
      completeJob: vi.fn().mockResolvedValue(true),
      retryJob: vi.fn().mockResolvedValue(true),
      terminalJob: vi.fn().mockResolvedValue(true),
    };
    const sender = vi.fn().mockResolvedValue("email-manual-retry");

    await expect(
      processCalendarSyncJobs(deliveryRepository, sender, {
        now: command().now,
        leaseToken: "manual-retry-lease",
      }),
    ).resolves.toMatchObject({ completed: 1 });
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: retried.idempotencyKey }),
    );
  });
});
