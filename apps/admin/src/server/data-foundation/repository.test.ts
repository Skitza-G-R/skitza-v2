import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalFoundationDigest, type Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import { createAdminDataFoundationRepository } from "./repository";
import {
  ADMIN_HISTORY_RETENTION_MS,
  type AddSupportNoteCommand,
  type RecordSensitiveRevealCommand,
  type TransitionSystemProblemCommand,
} from "./service";

const OCCURRED_AT = new Date("2026-07-29T12:00:00.000Z");
const PROBLEM_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_DIGEST = canonicalFoundationDigest({
  action: "test",
  environment: "test",
});
const repositorySource = readFileSync(
  join(process.cwd(), "src/server/data-foundation/repository.ts"),
  "utf8",
);

function databaseStub() {
  const execute = vi.fn();
  const transaction = vi.fn();
  const db = {
    execute,
    transaction,
  } as unknown as Db;
  return {
    db,
    execute,
    transaction,
  };
}

function databaseWithProblem(problem: Readonly<Record<string, unknown>>) {
  let selectCall = 0;
  let insertCall = 0;
  const insertedValues: Array<Readonly<Record<string, unknown>>> = [];
  const updatedValues: Array<Readonly<Record<string, unknown>>> = [];
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const tx = {
    execute,
    insert: vi.fn(() => {
      insertCall += 1;
      return {
        values: vi.fn((values: Readonly<Record<string, unknown>>) => {
          insertedValues.push(values);
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([
                insertCall === 1
                  ? {
                      ...values,
                      id: "22222222-2222-4222-8222-222222222222",
                    }
                  : {
                      ...values,
                      id: "33333333-3333-4333-8333-333333333333",
                    },
              ]),
            })),
          };
        }),
      };
    }),
    select: vi.fn(() => {
      selectCall += 1;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit:
              selectCall === 1
                ? vi.fn().mockResolvedValue([])
                : vi.fn(() => ({
                    for: vi.fn().mockResolvedValue([problem]),
                  })),
          })),
        })),
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn((values: Readonly<Record<string, unknown>>) => {
        updatedValues.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: PROBLEM_ID }]),
          })),
        };
      }),
    })),
  };
  const db = {
    transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
  } as unknown as Db;
  return { db, execute, insertedValues, updatedValues };
}

describe("SK-132 repository environment boundary", () => {
  it("rejects every cross-environment admin write before database access", async () => {
    const { db, execute, transaction } = databaseStub();
    const repository = createAdminDataFoundationRepository(db, "live");
    const base = {
      actorClerkUserId: "user-founder",
      environment: "test" as const,
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "request-1",
      safeAfterState: null,
      safeBeforeState: null,
    };
    const supportNote: AddSupportNoteCommand = {
      ...base,
      action: "support_note.create",
      body: "Private support note",
      targetId: "user-42",
      targetType: "registered_account",
    };
    const reveal: RecordSensitiveRevealCommand = {
      ...base,
      action: "sensitive_content.reveal",
      contentKind: "payment_proof",
      reason: "support_investigation",
      targetAccountClerkUserId: "user-42",
      targetId: "user-42",
      targetType: "registered_account",
    };
    const problem: TransitionSystemProblemCommand = {
      ...base,
      action: "system_problem.update",
      privateNote: null,
      problemId: PROBLEM_ID,
      state: "seen",
    };

    await expect(repository.addSupportNote(supportNote)).rejects.toMatchObject({
      code: "ENVIRONMENT_MISMATCH",
    });
    await expect(repository.recordSensitiveReveal(reveal)).rejects.toMatchObject({
      code: "ENVIRONMENT_MISMATCH",
    });
    await expect(repository.transitionSystemProblem(problem)).rejects.toMatchObject({
      code: "ENVIRONMENT_MISMATCH",
    });
    expect(() => repository.purgeExpiredAdminHistory({ environment: "test" })).toThrow(
      expect.objectContaining({ code: "ENVIRONMENT_MISMATCH" }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("keeps retry receipts outside retained history and stores reveal metadata only", () => {
    expect(repositorySource).toContain(".insert(adminActionReceipts)");
    expect(repositorySource).toContain("eq(adminActionReceipts.action, command.action)");
    expect(repositorySource).toContain("createdAt: command.occurredAt");
    expect(repositorySource).toContain(
      "isAdminHistoryExpired(existing.createdAt, command.occurredAt)",
    );
    expect(repositorySource).toContain("history.id !== verified.record.resultId");
    expect(repositorySource).toContain("revealContentKind: command.contentKind");
    expect(repositorySource).toContain("safeAfterState: null");
    expect(repositorySource).toContain("safeBeforeState: null");
  });

  it("persists reveal content kind and reason without content or snapshots on the first write", async () => {
    const { db, insertedValues } = databaseWithProblem({});
    const repository = createAdminDataFoundationRepository(db, "test");
    const reveal: RecordSensitiveRevealCommand = {
      action: "sensitive_content.reveal",
      actorClerkUserId: "user-founder",
      contentKind: "payment_proof",
      environment: "test",
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "reveal:first-write:request-1",
      reason: "safety_issue",
      safeAfterState: null,
      safeBeforeState: null,
      targetAccountClerkUserId: "user-42",
      targetId: "user-42",
      targetType: "registered_account",
    };

    await expect(repository.recordSensitiveReveal(reveal)).resolves.toMatchObject({
      replayed: false,
    });
    expect(insertedValues[0]).toEqual(
      expect.objectContaining({
        action: "sensitive_content.reveal",
        revealContentKind: "payment_proof",
        revealReason: "safety_issue",
        safeAfterState: null,
        safeBeforeState: null,
      }),
    );
    expect(insertedValues[0]).not.toHaveProperty("content");
    expect(insertedValues).toHaveLength(2);
  });

  it("fails a reveal replay closed once its required audit row is outside retention", async () => {
    const receipt = {
      action: "sensitive_content.reveal",
      createdAt: new Date(OCCURRED_AT.getTime() - ADMIN_HISTORY_RETENTION_MS - 1),
      environment: "test" as const,
      operationDigest: OPERATION_DIGEST,
      operationKey: "request-1",
      resultId: "history-1",
    };
    const limit = vi.fn().mockResolvedValueOnce([receipt]);
    const tx = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
    };
    const db = {
      transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as Db;
    const repository = createAdminDataFoundationRepository(db, "test");
    const reveal: RecordSensitiveRevealCommand = {
      action: "sensitive_content.reveal",
      actorClerkUserId: "user-founder",
      contentKind: "payment_proof",
      environment: "test",
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "request-1",
      reason: "support_investigation",
      safeAfterState: null,
      safeBeforeState: null,
      targetAccountClerkUserId: "user-42",
      targetId: "user-42",
      targetType: "registered_account",
    };

    await expect(repository.recordSensitiveReveal(reveal)).rejects.toMatchObject({
      code: "IDEMPOTENCY_EXPIRED",
    });
    expect(limit).toHaveBeenCalledOnce();
  });

  it("requires an unexpired reveal replay to retain its exact audit row", async () => {
    const receipt = {
      action: "sensitive_content.reveal",
      createdAt: new Date(OCCURRED_AT.getTime() - ADMIN_HISTORY_RETENTION_MS),
      environment: "test" as const,
      operationDigest: OPERATION_DIGEST,
      operationKey: "request-1",
      resultId: "history-1",
    };
    const limit = vi.fn().mockResolvedValueOnce([receipt]).mockResolvedValueOnce([]);
    const tx = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
    };
    const db = {
      transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as Db;
    const repository = createAdminDataFoundationRepository(db, "test");
    const reveal: RecordSensitiveRevealCommand = {
      action: "sensitive_content.reveal",
      actorClerkUserId: "user-founder",
      contentKind: "payment_proof",
      environment: "test",
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "request-1",
      reason: "support_investigation",
      safeAfterState: null,
      safeBeforeState: null,
      targetAccountClerkUserId: "user-42",
      targetId: "user-42",
      targetType: "registered_account",
    };

    await expect(repository.recordSensitiveReveal(reveal)).rejects.toMatchObject({
      code: "WRITE_NOT_DURABLE",
    });
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it("preserves a private note while an admin moves a New problem to Seen", async () => {
    const { db, execute, insertedValues, updatedValues } = databaseWithProblem({
      id: PROBLEM_ID,
      lastObservedAt: new Date("2026-07-29T11:30:00.000Z"),
      privateNote: "Founder-only investigation context",
      resolvedAt: null,
      resolvedByClerkUserId: null,
      seenAt: null,
      seenByClerkUserId: null,
      status: "new",
      updatedAt: new Date("2026-07-29T11:30:00.000Z"),
    });
    const repository = createAdminDataFoundationRepository(db, "test");
    const command: TransitionSystemProblemCommand = {
      action: "system_problem.update",
      actorClerkUserId: "user-founder",
      environment: "test",
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "problem:seen:request-1",
      problemId: PROBLEM_ID,
      safeAfterState: { state: "seen" },
      safeBeforeState: null,
      state: "seen",
    };

    await expect(repository.transitionSystemProblem(command)).resolves.toMatchObject({
      id: PROBLEM_ID,
      replayed: false,
      state: "seen",
    });

    expect(updatedValues).toEqual([
      expect.objectContaining({
        privateNote: "Founder-only investigation context",
        resolvedAt: null,
        resolvedByClerkUserId: null,
        seenAt: OCCURRED_AT,
        seenByClerkUserId: "user-founder",
        status: "seen",
      }),
    ]);
    expect(insertedValues[0]).toEqual(
      expect.objectContaining({
        action: "system_problem.update",
        outcome: "succeeded",
        safeAfterState: {
          hasPrivateNote: true,
          state: "seen",
        },
        safeBeforeState: {
          hasPrivateNote: true,
          state: "new",
        },
      }),
    );
    expect(repositorySource).not.toContain("skitza.admin_problem_transition");
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    ["seen", "new"],
    ["resolved", "new"],
    ["resolved", "seen"],
  ] as const)(
    "rejects the invalid admin %s-to-%s lifecycle before mutation or history",
    async (current, requested) => {
      const { db, execute, insertedValues, updatedValues } = databaseWithProblem({
        id: PROBLEM_ID,
        lastObservedAt: new Date("2026-07-29T10:30:00.000Z"),
        privateNote: "Founder-only investigation context",
        resolvedAt: current === "resolved" ? new Date("2026-07-29T11:00:00.000Z") : null,
        resolvedByClerkUserId: current === "resolved" ? "user-previous-founder" : null,
        seenAt: current === "seen" ? new Date("2026-07-29T10:45:00.000Z") : null,
        seenByClerkUserId: current === "seen" ? "user-previous-founder" : null,
        status: current,
        updatedAt: new Date("2026-07-29T11:00:00.000Z"),
      });
      const repository = createAdminDataFoundationRepository(db, "test");
      const command: TransitionSystemProblemCommand = {
        action: "system_problem.update",
        actorClerkUserId: "user-founder",
        environment: "test",
        occurredAt: OCCURRED_AT,
        operationDigest: OPERATION_DIGEST,
        operationKey: `problem:${requested}:request-2`,
        problemId: PROBLEM_ID,
        safeAfterState: { state: requested },
        safeBeforeState: null,
        state: requested,
      };

      await expect(repository.transitionSystemProblem(command)).rejects.toMatchObject({
        code: "STATE_CONFLICT",
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(updatedValues).toEqual([]);
      expect(insertedValues).toEqual([]);
    },
  );

  it("allows a fresh note-only update while a problem remains Resolved", async () => {
    const resolvedAt = new Date("2026-07-29T11:00:00.000Z");
    const { db, execute, insertedValues, updatedValues } = databaseWithProblem({
      id: PROBLEM_ID,
      lastObservedAt: new Date("2026-07-29T10:30:00.000Z"),
      privateNote: null,
      resolvedAt,
      resolvedByClerkUserId: "user-previous-founder",
      seenAt: null,
      seenByClerkUserId: null,
      status: "resolved",
      updatedAt: resolvedAt,
    });
    const repository = createAdminDataFoundationRepository(db, "test");
    const command: TransitionSystemProblemCommand = {
      action: "system_problem.update",
      actorClerkUserId: "user-founder",
      environment: "test",
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "problem:resolved-note:request-3",
      privateNote: "Founder-only follow-up",
      problemId: PROBLEM_ID,
      safeAfterState: { hasPrivateNote: true, state: "resolved" },
      safeBeforeState: null,
      state: "resolved",
    };

    await expect(repository.transitionSystemProblem(command)).resolves.toMatchObject({
      id: PROBLEM_ID,
      state: "resolved",
    });
    expect(updatedValues).toEqual([
      expect.objectContaining({
        privateNote: "Founder-only follow-up",
        resolvedAt,
        resolvedByClerkUserId: "user-previous-founder",
        status: "resolved",
      }),
    ]);
    expect(insertedValues[0]).toEqual(
      expect.objectContaining({
        outcome: "succeeded",
        safeAfterState: { hasPrivateNote: true, state: "resolved" },
        safeBeforeState: { hasPrivateNote: false, state: "resolved" },
      }),
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects a state action that began before the latest persisted observation", async () => {
    const { db, execute, insertedValues, updatedValues } = databaseWithProblem({
      id: PROBLEM_ID,
      lastObservedAt: new Date(OCCURRED_AT.getTime() + 1),
      privateNote: null,
      resolvedAt: null,
      resolvedByClerkUserId: null,
      seenAt: null,
      seenByClerkUserId: null,
      status: "new",
      updatedAt: new Date(OCCURRED_AT.getTime() + 1),
    });
    const repository = createAdminDataFoundationRepository(db, "test");
    const command: TransitionSystemProblemCommand = {
      action: "system_problem.update",
      actorClerkUserId: "user-founder",
      environment: "test",
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "problem:resolved:request-3",
      problemId: PROBLEM_ID,
      safeAfterState: { state: "resolved" },
      safeBeforeState: null,
      state: "resolved",
    };

    await expect(repository.transitionSystemProblem(command)).rejects.toMatchObject({
      code: "STATE_CONFLICT",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(updatedValues).toEqual([]);
    expect(insertedValues).toEqual([]);
  });

  it("rejects a note-only update that began before the latest admin change", async () => {
    const { db, execute, insertedValues, updatedValues } = databaseWithProblem({
      id: PROBLEM_ID,
      lastObservedAt: new Date("2026-07-29T10:30:00.000Z"),
      privateNote: "Newer founder note",
      resolvedAt: new Date("2026-07-29T11:00:00.000Z"),
      resolvedByClerkUserId: "user-previous-founder",
      seenAt: null,
      seenByClerkUserId: null,
      status: "resolved",
      updatedAt: new Date(OCCURRED_AT.getTime() + 1),
    });
    const repository = createAdminDataFoundationRepository(db, "test");
    const command: TransitionSystemProblemCommand = {
      action: "system_problem.update",
      actorClerkUserId: "user-founder",
      environment: "test",
      occurredAt: OCCURRED_AT,
      operationDigest: OPERATION_DIGEST,
      operationKey: "problem:resolved-note:request-4",
      privateNote: "Stale founder note",
      problemId: PROBLEM_ID,
      safeAfterState: { hasPrivateNote: true, state: "resolved" },
      safeBeforeState: null,
      state: "resolved",
    };

    await expect(repository.transitionSystemProblem(command)).rejects.toMatchObject({
      code: "STATE_CONFLICT",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(updatedValues).toEqual([]);
    expect(insertedValues).toEqual([]);
  });
});
