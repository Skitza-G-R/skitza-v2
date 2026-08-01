import {
  adminActionHistory,
  adminActionReceipts,
  adminSupportNotes,
  and,
  commitIdempotentFoundationWrite,
  eq,
  EventFoundationError,
  sql,
  systemProblems,
  type Db,
  type FoundationEnvironment,
  type SafeFoundationMetadata,
} from "@skitza/db";

import {
  AdminDataFoundationError,
  isAdminHistoryExpired,
  isAdminSystemProblemTransitionAllowed,
  type AddSupportNoteCommand,
  type AdminDataFoundationRepository,
  type RecordAdminActionCommand,
  type RecordSensitiveRevealCommand,
  type SystemProblemState,
  type TransitionSystemProblemCommand,
} from "./service";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];
type FoundationDb = Db | TransactionDb;

type HistoryWrite = Readonly<{
  action: string;
  actorClerkUserId: string;
  environment: FoundationEnvironment;
  failureCode: string | null;
  occurredAt: Date;
  operationDigest: string;
  operationKey: string;
  outcome: "failed" | "no_change" | "partial" | "succeeded";
  revealContentKind: string | null;
  revealReason: "safety_issue" | "support_investigation" | null;
  safeAfterState: SafeFoundationMetadata | null;
  safeBeforeState: SafeFoundationMetadata | null;
  targetAccountClerkUserId: string | null;
  targetId: string;
  targetType: string;
}>;

function historyIntent(row: {
  action: string;
  environment: FoundationEnvironment;
  operationDigest: string;
  operationKey: string;
}) {
  return {
    environment: row.environment,
    intentType: row.action,
    operationDigest: row.operationDigest,
    operationKey: row.operationKey,
  };
}

async function appendHistory(tx: FoundationDb, write: HistoryWrite) {
  const intent = historyIntent(write);
  return commitIdempotentFoundationWrite({
    boundEnvironment: write.environment,
    intent,
    insert: async () => {
      const [row] = await tx
        .insert(adminActionHistory)
        .values(write)
        .onConflictDoNothing({
          target: [
            adminActionHistory.environment,
            adminActionHistory.action,
            adminActionHistory.operationKey,
          ],
        })
        .returning();
      return row ? { ...row, ...historyIntent(row) } : null;
    },
    find: async () => {
      const [row] = await tx
        .select()
        .from(adminActionHistory)
        .where(
          and(
            eq(adminActionHistory.environment, write.environment),
            eq(adminActionHistory.action, write.action),
            eq(adminActionHistory.operationKey, write.operationKey),
          ),
        )
        .limit(1);
      return row ? { ...row, ...historyIntent(row) } : null;
    },
  });
}

async function purgeHistory(db: FoundationDb, environment: FoundationEnvironment): Promise<number> {
  const result = await db.execute<{ deleted: number | string }>(
    sql`select "purge_expired_admin_action_history"(${environment}::"admin_data_environment") as "deleted"`,
  );
  const deleted = Number(result.rows[0]?.deleted);
  if (!Number.isSafeInteger(deleted) || deleted < 0) {
    throw new EventFoundationError("WRITE_NOT_DURABLE");
  }
  return deleted;
}

export function purgeAdminHistoryInTransaction(
  tx: TransactionDb,
  environment: FoundationEnvironment,
): Promise<number> {
  return purgeHistory(tx, environment);
}

function problemSafeState(
  state: SystemProblemState,
  privateNote: string | null,
): SafeFoundationMetadata {
  return {
    hasPrivateNote: privateNote !== null,
    state,
  };
}

export async function recordSensitiveRevealInTransaction(
  tx: TransactionDb,
  boundEnvironment: FoundationEnvironment,
  command: RecordSensitiveRevealCommand,
): Promise<Readonly<{ id: string; replayed: boolean }>> {
  if (command.environment !== boundEnvironment) {
    throw new EventFoundationError("ENVIRONMENT_MISMATCH");
  }
  return withAdminOperationReceipt(
    tx,
    command,
    (id) => ({ id }),
    async () => {
      const history = await appendHistory(tx, {
        action: command.action,
        actorClerkUserId: command.actorClerkUserId,
        environment: boundEnvironment,
        failureCode: null,
        occurredAt: command.occurredAt,
        operationDigest: command.operationDigest,
        operationKey: command.operationKey,
        outcome: "succeeded",
        revealContentKind: command.contentKind,
        revealReason: command.reason,
        safeAfterState: null,
        safeBeforeState: null,
        targetAccountClerkUserId: command.targetAccountClerkUserId,
        targetId: command.targetId,
        targetType: command.targetType,
      });
      return { id: history.record.id };
    },
  );
}

export async function recordAdminActionInTransaction(
  tx: TransactionDb,
  boundEnvironment: FoundationEnvironment,
  command: RecordAdminActionCommand,
): Promise<Readonly<{ id: string; replayed: boolean }>> {
  if (command.environment !== boundEnvironment) {
    throw new EventFoundationError("ENVIRONMENT_MISMATCH");
  }
  return withAdminOperationReceipt(
    tx,
    command,
    (id) => ({ id }),
    async () => {
      const history = await appendHistory(tx, {
        action: command.action,
        actorClerkUserId: command.actorClerkUserId,
        environment: boundEnvironment,
        failureCode: null,
        occurredAt: command.occurredAt,
        operationDigest: command.operationDigest,
        operationKey: command.operationKey,
        outcome: "succeeded",
        revealContentKind: null,
        revealReason: null,
        safeAfterState: null,
        safeBeforeState: null,
        targetAccountClerkUserId: null,
        targetId: command.targetId,
        targetType: command.targetType,
      });
      return { id: history.record.id };
    },
  );
}

type OperationCommand = Readonly<{
  action: string;
  environment: FoundationEnvironment;
  occurredAt: Date;
  operationDigest: string;
  operationKey: string;
}>;

async function withAdminOperationReceipt<T extends Readonly<{ id: string }>>(
  tx: TransactionDb,
  command: OperationCommand,
  replay: (resultId: string) => T,
  perform: () => Promise<T>,
): Promise<T & Readonly<{ replayed: boolean }>> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`admin-operation:${command.environment}:${command.action}:${command.operationKey}`}, 0))`,
  );
  const intent = historyIntent(command);
  const findReceipt = async () => {
    const [row] = await tx
      .select()
      .from(adminActionReceipts)
      .where(
        and(
          eq(adminActionReceipts.environment, command.environment),
          eq(adminActionReceipts.action, command.action),
          eq(adminActionReceipts.operationKey, command.operationKey),
        ),
      )
      .limit(1);
    return row ? { ...row, ...historyIntent(row) } : null;
  };
  const existing = await findReceipt();
  if (existing) {
    const verified = await commitIdempotentFoundationWrite({
      boundEnvironment: command.environment,
      intent,
      insert: () => Promise.resolve(null),
      find: () => Promise.resolve(existing),
    });
    if (command.action === "sensitive_content.reveal") {
      if (isAdminHistoryExpired(existing.createdAt, command.occurredAt)) {
        throw new AdminDataFoundationError("IDEMPOTENCY_EXPIRED");
      }
      const [history] = await tx
        .select({
          id: adminActionHistory.id,
          operationDigest: adminActionHistory.operationDigest,
        })
        .from(adminActionHistory)
        .where(
          and(
            eq(adminActionHistory.environment, command.environment),
            eq(adminActionHistory.action, command.action),
            eq(adminActionHistory.operationKey, command.operationKey),
          ),
        )
        .limit(1);
      if (
        !history ||
        history.id !== verified.record.resultId ||
        history.operationDigest !== command.operationDigest
      ) {
        throw new EventFoundationError("WRITE_NOT_DURABLE");
      }
    }
    return {
      ...replay(verified.record.resultId),
      replayed: true,
    };
  }

  const result = await perform();
  const receipt = await commitIdempotentFoundationWrite({
    boundEnvironment: command.environment,
    intent,
    insert: async () => {
      const [row] = await tx
        .insert(adminActionReceipts)
        .values({
          action: command.action,
          environment: command.environment,
          operationDigest: command.operationDigest,
          operationKey: command.operationKey,
          resultId: result.id,
          createdAt: command.occurredAt,
        })
        .onConflictDoNothing({
          target: [
            adminActionReceipts.environment,
            adminActionReceipts.action,
            adminActionReceipts.operationKey,
          ],
        })
        .returning();
      return row ? { ...row, ...historyIntent(row) } : null;
    },
    find: findReceipt,
  });
  if (receipt.replayed) {
    return {
      ...replay(receipt.record.resultId),
      replayed: true,
    };
  }
  return { ...result, replayed: false };
}

export function createAdminDataFoundationRepository(
  db: Db,
  boundEnvironment: FoundationEnvironment,
): AdminDataFoundationRepository {
  return Object.freeze({
    async addSupportNote(command: AddSupportNoteCommand) {
      if (command.environment !== boundEnvironment) {
        throw new EventFoundationError("ENVIRONMENT_MISMATCH");
      }
      return db.transaction((tx) =>
        withAdminOperationReceipt(
          tx,
          command,
          (id) => ({ id }),
          async () => {
            const intent = historyIntent(command);
            const note = await commitIdempotentFoundationWrite({
              boundEnvironment,
              intent,
              insert: async () => {
                const [row] = await tx
                  .insert(adminSupportNotes)
                  .values({
                    body: command.body,
                    createdAt: command.occurredAt,
                    createdByClerkUserId: command.actorClerkUserId,
                    environment: boundEnvironment,
                    operationDigest: command.operationDigest,
                    operationKey: command.operationKey,
                    targetId: command.targetId,
                    targetType: command.targetType,
                  })
                  .onConflictDoNothing({
                    target: [adminSupportNotes.environment, adminSupportNotes.operationKey],
                  })
                  .returning();
                return row ? { ...row, ...intent } : null;
              },
              find: async () => {
                const [row] = await tx
                  .select()
                  .from(adminSupportNotes)
                  .where(
                    and(
                      eq(adminSupportNotes.environment, boundEnvironment),
                      eq(adminSupportNotes.operationKey, command.operationKey),
                    ),
                  )
                  .limit(1);
                return row
                  ? {
                      ...row,
                      ...historyIntent({
                        action: command.action,
                        environment: row.environment,
                        operationDigest: row.operationDigest,
                        operationKey: row.operationKey,
                      }),
                    }
                  : null;
              },
            });
            await appendHistory(tx, {
              action: command.action,
              actorClerkUserId: command.actorClerkUserId,
              environment: boundEnvironment,
              failureCode: null,
              occurredAt: command.occurredAt,
              operationDigest: command.operationDigest,
              operationKey: command.operationKey,
              outcome: "succeeded",
              revealContentKind: null,
              revealReason: null,
              safeAfterState: command.safeAfterState,
              safeBeforeState: command.safeBeforeState,
              targetAccountClerkUserId:
                command.targetType === "registered_account" ? command.targetId : null,
              targetId: command.targetId,
              targetType: command.targetType,
            });
            return { id: note.record.id };
          },
        ),
      );
    },

    purgeExpiredAdminHistory({ environment }) {
      if (environment !== boundEnvironment) {
        throw new EventFoundationError("ENVIRONMENT_MISMATCH");
      }
      return purgeHistory(db, boundEnvironment);
    },

    async recordSensitiveReveal(command: RecordSensitiveRevealCommand) {
      if (command.environment !== boundEnvironment) {
        throw new EventFoundationError("ENVIRONMENT_MISMATCH");
      }
      return db.transaction((tx) =>
        recordSensitiveRevealInTransaction(tx, boundEnvironment, command),
      );
    },

    async transitionSystemProblem(command: TransitionSystemProblemCommand) {
      if (command.environment !== boundEnvironment) {
        throw new EventFoundationError("ENVIRONMENT_MISMATCH");
      }
      return db.transaction((tx) =>
        withAdminOperationReceipt(
          tx,
          command,
          (id) => ({ id, state: command.state }),
          async () => {
            const [problem] = await tx
              .select()
              .from(systemProblems)
              .where(
                and(
                  eq(systemProblems.environment, boundEnvironment),
                  eq(systemProblems.id, command.problemId),
                ),
              )
              .limit(1)
              .for("update");
            if (!problem) {
              throw new AdminDataFoundationError("NOT_FOUND");
            }
            if (!isAdminSystemProblemTransitionAllowed(problem.status, command.state)) {
              throw new AdminDataFoundationError("STATE_CONFLICT");
            }

            const privateNote =
              command.privateNote === undefined ? problem.privateNote : command.privateNote;
            const stateChanged = problem.status !== command.state;
            const changed = stateChanged || problem.privateNote !== privateNote;
            if (
              changed &&
              command.occurredAt.getTime() <
                Math.max(problem.lastObservedAt.getTime(), problem.updatedAt.getTime())
            ) {
              throw new AdminDataFoundationError("STATE_CONFLICT");
            }
            if (changed) {
              const seenAt =
                command.state === "new"
                  ? null
                  : command.state === "seen"
                    ? stateChanged
                      ? command.occurredAt
                      : problem.seenAt
                    : problem.seenAt;
              const seenByClerkUserId =
                command.state === "new"
                  ? null
                  : command.state === "seen"
                    ? stateChanged
                      ? command.actorClerkUserId
                      : problem.seenByClerkUserId
                    : problem.seenByClerkUserId;
              const resolvedAt =
                command.state === "resolved" ? (problem.resolvedAt ?? command.occurredAt) : null;
              const resolvedByClerkUserId =
                command.state === "resolved"
                  ? (problem.resolvedByClerkUserId ?? command.actorClerkUserId)
                  : null;

              const [updated] = await tx
                .update(systemProblems)
                .set({
                  privateNote,
                  resolvedAt,
                  resolvedByClerkUserId,
                  seenAt,
                  seenByClerkUserId,
                  status: command.state,
                  updatedAt: sql`greatest(${systemProblems.updatedAt}, ${command.occurredAt})`,
                })
                .where(
                  and(
                    eq(systemProblems.environment, boundEnvironment),
                    eq(systemProblems.id, command.problemId),
                  ),
                )
                .returning({ id: systemProblems.id });
              if (!updated) {
                throw new EventFoundationError("WRITE_NOT_DURABLE");
              }
            }

            await appendHistory(tx, {
              action: command.action,
              actorClerkUserId: command.actorClerkUserId,
              environment: boundEnvironment,
              failureCode: null,
              occurredAt: command.occurredAt,
              operationDigest: command.operationDigest,
              operationKey: command.operationKey,
              outcome: changed ? "succeeded" : "no_change",
              revealContentKind: null,
              revealReason: null,
              safeAfterState: problemSafeState(command.state, privateNote),
              safeBeforeState: problemSafeState(problem.status, problem.privateNote),
              targetAccountClerkUserId: null,
              targetId: command.problemId,
              targetType: "system_problem",
            });
            return {
              id: command.problemId,
              state: command.state,
            };
          },
        ),
      );
    },
  });
}
