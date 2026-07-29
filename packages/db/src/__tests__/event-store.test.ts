import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  createEventFoundationStore,
  domainEventWrite,
  operationalRunWrite,
  systemProblemObservation,
} from "../event-store";

const OCCURRED_AT = new Date("2026-07-29T12:00:00.000Z");
const OPERATION_DIGEST = `sha256:${"a".repeat(64)}`;
const eventStoreSource = readFileSync(join(process.cwd(), "src/event-store.ts"), "utf8");

describe("SK-132 domain-event persistence intent", () => {
  it("builds a safe append-only event with environment-bound retry identity", () => {
    const live = domainEventWrite("live", {
      actorClerkUserId: "user-1",
      eventName: "project.updated",
      eventVersion: 1,
      occurredAt: OCCURRED_AT,
      operationKey: "project-1:update:request-1",
      producerId: "5f16ee49-dcf9-4181-a7bc-0c53ef1b3f6e",
      safeMetadata: { changed: true, fieldCount: 2 },
      targetId: "project-1",
      targetType: "project",
    });
    const test = domainEventWrite("test", {
      actorClerkUserId: "user-1",
      eventName: "project.updated",
      eventVersion: 1,
      occurredAt: OCCURRED_AT,
      operationKey: "project-1:update:request-1",
      producerId: "5f16ee49-dcf9-4181-a7bc-0c53ef1b3f6e",
      safeMetadata: { changed: true, fieldCount: 2 },
      targetId: "project-1",
      targetType: "project",
    });

    expect(live.environment).toBe("live");
    expect(live.operationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(test.operationDigest).not.toBe(live.operationDigest);
    expect(live.safeMetadata).toEqual({ changed: true, fieldCount: 2 });
  });

  it("keeps distinct event actions independent when callers reuse a key", () => {
    const common = {
      actorClerkUserId: "user-1",
      eventVersion: 1,
      occurredAt: OCCURRED_AT,
      operationKey: "request-1",
      producerId: null,
      safeMetadata: {},
      targetId: "project-1",
      targetType: "project",
    };

    const created = domainEventWrite("live", {
      ...common,
      eventName: "project.created",
    });
    const updated = domainEventWrite("live", {
      ...common,
      eventName: "project.updated",
    });

    expect(created.operationDigest).not.toBe(updated.operationDigest);
    expect(eventStoreSource).toContain("eq(domainEvents.eventName, write.eventName)");
  });

  it("rejects private or provider payloads before a database call", () => {
    expect(() =>
      domainEventWrite("live", {
        actorClerkUserId: null,
        eventName: "message.sent",
        eventVersion: 1,
        occurredAt: OCCURRED_AT,
        operationKey: "message-1:sent",
        producerId: null,
        safeMetadata: { message: "private message body" },
        targetId: "message-1",
        targetType: "message",
      }),
    ).toThrow(expect.objectContaining({ code: "UNSAFE_METADATA" }));
  });
});

describe("SK-132 operational persistence intent", () => {
  it.each(["job", "email", "webhook", "provider_investigation"] as const)(
    "reserves one retry-safe %s attempt before I/O",
    (kind) => {
      const write = operationalRunWrite("test", {
        attemptNumber: 2,
        kind,
        operationKey: "operation-1",
        operationName: "provider.operation",
        provider: "provider",
        safeMetadata: { batchSize: 4 },
        startedAt: OCCURRED_AT,
        targetId: "target-1",
        targetType: "registered_account",
      });

      expect(write).toMatchObject({
        attemptNumber: 2,
        environment: "test",
        kind,
        operationKey: "operation-1",
        status: "running",
      });
      expect(write.operationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    },
  );

  it("binds completion lookup and locking to the operational action", () => {
    expect(eventStoreSource).toContain("eq(operationalRuns.kind, kind)");
    expect(eventStoreSource).toContain("eq(operationalRuns.operationName, operationName)");
    expect(eventStoreSource).toContain(
      "operational:${boundEnvironment}:${kind}:${operationName}:${operationKey}",
    );
  });

  it("rejects a terminal replay whose completion timestamp changed", async () => {
    const finishedAt = new Date("2026-07-29T12:01:00.000Z");
    const terminalRow = {
      errorCode: null,
      finishedAt,
      id: "68fc9406-13e6-47b8-b17f-b93baaf77822",
      operationDigest: OPERATION_DIGEST,
      provider: "provider",
      providerReference: "provider-record-1",
      safeMetadata: { durationMs: 60_000 },
      startedAt: OCCURRED_AT,
      status: "succeeded",
    };
    const transactionDb = {
      execute: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              for: vi.fn(() => Promise.resolve([terminalRow])),
            })),
          })),
        })),
      })),
    };
    const db = {
      transaction: vi.fn((run: (tx: typeof transactionDb) => Promise<unknown>) =>
        run(transactionDb),
      ),
    } as unknown as Parameters<typeof createEventFoundationStore>[0];
    const store = createEventFoundationStore(db, "test");
    const completion = {
      attemptNumber: 1,
      errorCode: null,
      finishedAt,
      kind: "email" as const,
      operationDigest: OPERATION_DIGEST,
      operationKey: "operation-1",
      operationName: "provider.operation",
      providerReference: "provider-record-1",
      safeMetadata: { durationMs: 60_000 },
      status: "succeeded" as const,
    };

    await expect(store.completeOperationalRun(completion)).resolves.toMatchObject({
      id: terminalRow.id,
      replayed: true,
    });
    await expect(
      store.completeOperationalRun({
        ...completion,
        finishedAt: new Date(finishedAt.getTime() + 1),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("replays only the exact safe terminal failure outcome", async () => {
    const finishedAt = new Date("2026-07-29T12:01:00.000Z");
    const terminalRow = {
      errorCode: "provider_timeout",
      finishedAt,
      id: "68fc9406-13e6-47b8-b17f-b93baaf77822",
      operationDigest: OPERATION_DIGEST,
      provider: "provider",
      providerReference: "provider-record-1",
      safeMetadata: { durationMs: 60_000 },
      startedAt: OCCURRED_AT,
      status: "failed",
    };
    const transactionDb = {
      execute: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              for: vi.fn(() => Promise.resolve([terminalRow])),
            })),
          })),
        })),
      })),
    };
    const db = {
      transaction: vi.fn((run: (tx: typeof transactionDb) => Promise<unknown>) =>
        run(transactionDb),
      ),
    } as unknown as Parameters<typeof createEventFoundationStore>[0];
    const store = createEventFoundationStore(db, "test");
    const completion = {
      attemptNumber: 1,
      errorCode: "provider_timeout",
      finishedAt,
      kind: "email" as const,
      operationDigest: OPERATION_DIGEST,
      operationKey: "operation-1",
      operationName: "provider.operation",
      providerReference: "provider-record-1",
      safeMetadata: { durationMs: 60_000 },
      status: "failed" as const,
    };

    await expect(store.completeOperationalRun(completion)).resolves.toMatchObject({
      id: terminalRow.id,
      replayed: true,
    });
    await expect(
      store.completeOperationalRun({
        ...completion,
        errorCode: "provider_rejected",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects unsafe or incoherent terminal error semantics before database access", async () => {
    const transaction = vi.fn();
    const store = createEventFoundationStore(
      { transaction } as unknown as Parameters<typeof createEventFoundationStore>[0],
      "test",
    );
    const base = {
      attemptNumber: 1,
      finishedAt: new Date("2026-07-29T12:01:00.000Z"),
      kind: "email" as const,
      operationDigest: OPERATION_DIGEST,
      operationKey: "operation-1",
      operationName: "provider.operation",
      providerReference: null,
      safeMetadata: { durationMs: 60_000 },
    };

    for (const invalid of [
      { errorCode: null, status: "failed" as const },
      { errorCode: "provider_timeout", status: "succeeded" as const },
      { errorCode: "private provider message", status: "failed" as const },
      { errorCode: `e${"x".repeat(100)}`, status: "partial" as const },
    ]) {
      await expect(
        store.completeOperationalRun({
          ...base,
          ...invalid,
        }),
      ).rejects.toMatchObject({ code: "UNSAFE_METADATA" });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("SK-132 system-problem identity", () => {
  const problemInput = {
    category: "webhook_failure",
    fingerprintKey: "clerk:user.created:signature",
    observedAt: OCCURRED_AT,
    provider: "clerk",
    providerReference: "provider-record-1",
    title: "Clerk signup webhook repeatedly failed",
  };

  it("stores a digest fingerprint instead of raw investigation context", () => {
    const observation = systemProblemObservation("live", problemInput, OCCURRED_AT);

    expect(observation.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(observation.fingerprint).not.toContain("signature");
    expect(observation).not.toHaveProperty("fingerprintKey");
    expect(observation.environment).toBe("live");
  });

  it("updates descriptions only for observations at least as recent as the persisted row", async () => {
    const delayedObservedAt = new Date("2026-07-29T10:00:00.000Z");
    let conflictSet: Readonly<Record<string, SQL>> | undefined;
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn((config: Readonly<{ set: Readonly<Record<string, SQL>> }>) => {
            conflictSet = config.set;
            return {
              returning: vi.fn().mockResolvedValue([
                {
                  id: "68fc9406-13e6-47b8-b17f-b93baaf77822",
                  status: "seen",
                },
              ]),
            };
          }),
        })),
      })),
    } as unknown as Parameters<typeof createEventFoundationStore>[0];
    const store = createEventFoundationStore(db, "live");

    await expect(
      store.observeSystemProblem({
        ...problemInput,
        observedAt: delayedObservedAt,
        provider: "older-provider",
        providerReference: "older-provider-record",
        title: "Older delayed description",
      }),
    ).resolves.toMatchObject({ status: "seen" });

    const dialect = new PgDialect();
    for (const [field, incomingValue, currentColumn] of [
      ["provider", "older-provider", "provider"],
      ["providerReference", "older-provider-record", "provider_reference"],
      ["title", "Older delayed description", "title"],
    ] as const) {
      const expression = conflictSet?.[field];
      expect(expression).toBeDefined();
      const query = dialect.sqlToQuery(expression as SQL);
      expect(query.sql).toBe(
        `case when $1 >= "system_problems"."last_observed_at" then $2 else "system_problems"."${currentColumn}" end`,
      );
      expect(query.params).toEqual([delayedObservedAt, incomingValue]);
    }

    const recurrenceGuard =
      "${observation.observedAt} > greatest(${systemProblems.lastObservedAt}, ${systemProblems.resolvedAt})";
    expect(eventStoreSource.split(recurrenceGuard)).toHaveLength(6);
  });

  it("rejects invalid or future observation times without moving retry timestamps", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(() =>
      systemProblemObservation("live", { ...problemInput, observedAt: new Date(Number.NaN) }, now),
    ).toThrow(expect.objectContaining({ code: "UNSAFE_METADATA" }));
    expect(() =>
      systemProblemObservation(
        "live",
        { ...problemInput, observedAt: new Date(now.getTime() + 1) },
        now,
      ),
    ).toThrow(expect.objectContaining({ code: "UNSAFE_METADATA" }));
    expect(
      systemProblemObservation("live", { ...problemInput, observedAt: now }, now).observedAt,
    ).toEqual(now);
  });
});
