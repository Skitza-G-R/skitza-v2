import { and, eq, sql, type SQLWrapper } from "drizzle-orm";

import type { Db } from "./client";
import {
  canonicalFoundationDigest,
  commitIdempotentFoundationWrite,
  EventFoundationError,
  safeFoundationMetadata,
  type FoundationEnvironment,
  type SafeFoundationMetadata,
} from "./event-foundation";
import { domainEvents, operationalRuns, systemProblems } from "./schema";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

type DomainEventInput = Readonly<{
  actorClerkUserId: string | null;
  eventName: string;
  eventVersion: number;
  occurredAt: Date;
  operationKey: string;
  producerId: string | null;
  safeMetadata: unknown;
  targetId: string;
  targetType: string;
}>;

export type OperationalRunKind = "email" | "job" | "provider_investigation" | "webhook";
export type OperationalTerminalStatus = "failed" | "partial" | "succeeded";

type OperationalRunInput = Readonly<{
  attemptNumber: number;
  kind: OperationalRunKind;
  operationKey: string;
  operationName: string;
  provider: string | null;
  safeMetadata: unknown;
  startedAt: Date;
  targetId: string | null;
  targetType: string | null;
}>;

type SystemProblemInput = Readonly<{
  category: string;
  fingerprintKey: string;
  observedAt: Date;
  provider: string | null;
  providerReference: string | null;
  title: string;
}>;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPERATIONAL_KINDS = new Set<OperationalRunKind>([
  "email",
  "job",
  "provider_investigation",
  "webhook",
]);
const TERMINAL_STATUSES = new Set<OperationalTerminalStatus>(["failed", "partial", "succeeded"]);

function invalid(): never {
  throw new EventFoundationError("UNSAFE_METADATA");
}

function exactEnvironment(value: FoundationEnvironment): FoundationEnvironment {
  if (value !== "live" && value !== "test") return invalid();
  return value;
}

function identifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) return invalid();
  return value;
}

function safeErrorCode(value: string | null): string | null {
  if (value !== null && !SAFE_ERROR_CODE_PATTERN.test(value)) return invalid();
  return value;
}

function optionalIdentifier(value: string | null): string | null {
  return value === null ? null : identifier(value);
}

function boundedText(value: string, maxLength: number): string {
  if (value.trim().length === 0 || value.length > maxLength || value.includes("\u0000")) {
    return invalid();
  }
  return value;
}

function timestampMilliseconds(value: Date): number {
  if (!(value instanceof Date)) return invalid();
  const milliseconds = value.getTime();
  return Number.isFinite(milliseconds) ? milliseconds : invalid();
}

function systemProblemObservedAt(observedAt: Date, now: Date): Date {
  const observedAtMilliseconds = timestampMilliseconds(observedAt);
  const nowMilliseconds = timestampMilliseconds(now);
  if (observedAtMilliseconds > nowMilliseconds) {
    return invalid();
  }
  return observedAt;
}

function descriptiveValueForAtLeastAsRecentObservation<T>(
  observedAt: Date,
  incomingValue: T,
  currentValue: SQLWrapper,
) {
  return sql<T>`case when ${observedAt} >= ${systemProblems.lastObservedAt} then ${incomingValue} else ${currentValue} end`;
}

function targetPair(
  targetType: string | null,
  targetId: string | null,
): Readonly<{ targetId: string | null; targetType: string | null }> {
  if (targetType === null && targetId === null) {
    return { targetId: null, targetType: null };
  }
  if (targetType === null || targetId === null) return invalid();
  return {
    targetId: identifier(targetId),
    targetType: identifier(targetType),
  };
}

export function domainEventWrite(environment: FoundationEnvironment, input: DomainEventInput) {
  const safeMetadata = safeFoundationMetadata("domain_event", input.safeMetadata);
  const write = {
    actorClerkUserId: optionalIdentifier(input.actorClerkUserId),
    environment: exactEnvironment(environment),
    eventName: identifier(input.eventName),
    eventVersion:
      Number.isSafeInteger(input.eventVersion) && input.eventVersion > 0
        ? input.eventVersion
        : invalid(),
    occurredAt: input.occurredAt,
    operationKey: identifier(input.operationKey),
    producerId:
      input.producerId === null
        ? null
        : UUID_PATTERN.test(input.producerId)
          ? input.producerId
          : invalid(),
    safeMetadata,
    targetId: identifier(input.targetId),
    targetType: identifier(input.targetType),
  };
  return {
    ...write,
    operationDigest: canonicalFoundationDigest({
      ...write,
      occurredAt: write.occurredAt.toISOString(),
    }),
  };
}

export function operationalRunWrite(
  environment: FoundationEnvironment,
  input: OperationalRunInput,
) {
  if (
    !OPERATIONAL_KINDS.has(input.kind) ||
    !Number.isSafeInteger(input.attemptNumber) ||
    input.attemptNumber <= 0
  ) {
    return invalid();
  }
  const target = targetPair(input.targetType, input.targetId);
  const write = {
    attemptNumber: input.attemptNumber,
    environment: exactEnvironment(environment),
    kind: input.kind,
    operationKey: identifier(input.operationKey),
    operationName: identifier(input.operationName),
    provider: optionalIdentifier(input.provider),
    safeMetadata: safeFoundationMetadata("operational_run", input.safeMetadata),
    startedAt: input.startedAt,
    status: "running" as const,
    ...target,
  };
  return {
    ...write,
    operationDigest: canonicalFoundationDigest({
      ...write,
      startedAt: write.startedAt.toISOString(),
    }),
  };
}

export function systemProblemObservation(
  environment: FoundationEnvironment,
  input: SystemProblemInput,
  now: Date = new Date(),
) {
  const category = identifier(input.category);
  const provider = optionalIdentifier(input.provider);
  const providerReference =
    input.providerReference === null ? null : boundedText(input.providerReference, 500);
  if (provider === null && providerReference !== null) return invalid();
  const observedAt = systemProblemObservedAt(input.observedAt, now);
  return {
    category,
    environment: exactEnvironment(environment),
    fingerprint: canonicalFoundationDigest({
      category,
      environment,
      fingerprintKey: boundedText(input.fingerprintKey, 500),
      provider,
    }),
    observedAt,
    provider,
    providerReference,
    title: boundedText(input.title, 300),
  };
}

function domainIntent(write: ReturnType<typeof domainEventWrite>) {
  return {
    environment: write.environment,
    intentType: `domain_event:${write.eventName}`,
    operationDigest: write.operationDigest,
    operationKey: write.operationKey,
  };
}

function operationalIntent(write: ReturnType<typeof operationalRunWrite>) {
  return {
    environment: write.environment,
    intentType: `operational_run:${write.kind}:${write.operationName}`,
    operationDigest: write.operationDigest,
    operationKey: `${write.operationKey}:${write.attemptNumber}`,
  };
}

export function createEventFoundationStore(db: Db, boundEnvironment: FoundationEnvironment) {
  exactEnvironment(boundEnvironment);

  return Object.freeze({
    async appendDomainEvent(input: DomainEventInput) {
      const write = domainEventWrite(boundEnvironment, input);
      const intent = domainIntent(write);
      const result = await commitIdempotentFoundationWrite({
        boundEnvironment,
        intent,
        insert: async () => {
          const [row] = await db
            .insert(domainEvents)
            .values(write)
            .onConflictDoNothing({
              target: [domainEvents.environment, domainEvents.eventName, domainEvents.operationKey],
            })
            .returning();
          return row ? { ...row, ...intent } : null;
        },
        find: async () => {
          const [row] = await db
            .select()
            .from(domainEvents)
            .where(
              and(
                eq(domainEvents.environment, boundEnvironment),
                eq(domainEvents.eventName, write.eventName),
                eq(domainEvents.operationKey, write.operationKey),
              ),
            )
            .limit(1);
          return row
            ? {
                ...row,
                ...domainIntent({
                  ...write,
                  environment: row.environment,
                  eventName: row.eventName,
                  operationDigest: row.operationDigest,
                  operationKey: row.operationKey,
                }),
              }
            : null;
        },
      });
      return { id: result.record.id, replayed: result.replayed };
    },

    async reserveOperationalRun(input: OperationalRunInput) {
      const write = operationalRunWrite(boundEnvironment, input);
      const intent = operationalIntent(write);
      const result = await commitIdempotentFoundationWrite({
        boundEnvironment,
        intent,
        insert: async () => {
          const [row] = await db
            .insert(operationalRuns)
            .values({
              ...write,
              createdAt: write.startedAt,
              errorCode: null,
              finishedAt: null,
              providerReference: null,
              updatedAt: write.startedAt,
            })
            .onConflictDoNothing({
              target: [
                operationalRuns.environment,
                operationalRuns.kind,
                operationalRuns.operationName,
                operationalRuns.operationKey,
                operationalRuns.attemptNumber,
              ],
            })
            .returning();
          return row ? { ...row, ...intent } : null;
        },
        find: async () => {
          const [row] = await db
            .select()
            .from(operationalRuns)
            .where(
              and(
                eq(operationalRuns.environment, boundEnvironment),
                eq(operationalRuns.kind, write.kind),
                eq(operationalRuns.operationName, write.operationName),
                eq(operationalRuns.operationKey, write.operationKey),
                eq(operationalRuns.attemptNumber, write.attemptNumber),
              ),
            )
            .limit(1);
          return row
            ? {
                ...row,
                ...operationalIntent({
                  ...write,
                  environment: row.environment,
                  kind: row.kind,
                  operationDigest: row.operationDigest,
                  operationKey: row.operationKey,
                  operationName: row.operationName,
                  attemptNumber: row.attemptNumber,
                }),
              }
            : null;
        },
      });
      return {
        id: result.record.id,
        operationDigest: write.operationDigest,
        replayed: result.replayed,
        status: result.record.status,
      };
    },

    async completeOperationalRun(
      input: Readonly<{
        attemptNumber: number;
        errorCode: string | null;
        finishedAt: Date;
        kind: OperationalRunKind;
        operationDigest: string;
        operationKey: string;
        operationName: string;
        providerReference: string | null;
        safeMetadata: unknown;
        status: OperationalTerminalStatus;
      }>,
    ) {
      if (
        !TERMINAL_STATUSES.has(input.status) ||
        !Number.isSafeInteger(input.attemptNumber) ||
        input.attemptNumber <= 0
      ) {
        return invalid();
      }
      const kind = OPERATIONAL_KINDS.has(input.kind) ? input.kind : invalid();
      const operationKey = identifier(input.operationKey);
      const operationName = identifier(input.operationName);
      const errorCode = safeErrorCode(input.errorCode);
      if (
        (input.status === "succeeded" && errorCode !== null) ||
        (input.status !== "succeeded" && errorCode === null)
      ) {
        return invalid();
      }
      const providerReference =
        input.providerReference === null ? null : boundedText(input.providerReference, 500);
      const safeMetadata = safeFoundationMetadata("operational_run", input.safeMetadata);
      const finishedAtMilliseconds = timestampMilliseconds(input.finishedAt);

      return db.transaction(async (tx: TransactionDb) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`operational:${boundEnvironment}:${kind}:${operationName}:${operationKey}:${input.attemptNumber}`}, 0))`,
        );
        const [row] = await tx
          .select()
          .from(operationalRuns)
          .where(
            and(
              eq(operationalRuns.environment, boundEnvironment),
              eq(operationalRuns.kind, kind),
              eq(operationalRuns.operationName, operationName),
              eq(operationalRuns.operationKey, operationKey),
              eq(operationalRuns.attemptNumber, input.attemptNumber),
            ),
          )
          .limit(1)
          .for("update");
        if (!row || row.operationDigest !== input.operationDigest) {
          throw new EventFoundationError(row ? "IDEMPOTENCY_CONFLICT" : "WRITE_NOT_DURABLE");
        }
        if (row.provider === null && providerReference !== null) {
          return invalid();
        }
        if (finishedAtMilliseconds < row.startedAt.getTime()) return invalid();

        if (row.status !== "running") {
          const sameOutcome =
            row.status === input.status &&
            row.errorCode === errorCode &&
            row.finishedAt?.getTime() === finishedAtMilliseconds &&
            row.providerReference === providerReference &&
            canonicalFoundationDigest(row.safeMetadata) === canonicalFoundationDigest(safeMetadata);
          if (!sameOutcome) {
            throw new EventFoundationError("IDEMPOTENCY_CONFLICT");
          }
          return { id: row.id, replayed: true, status: row.status };
        }

        const [updated] = await tx
          .update(operationalRuns)
          .set({
            errorCode,
            finishedAt: input.finishedAt,
            providerReference,
            safeMetadata,
            status: input.status,
            updatedAt: input.finishedAt,
          })
          .where(
            and(eq(operationalRuns.environment, boundEnvironment), eq(operationalRuns.id, row.id)),
          )
          .returning({ id: operationalRuns.id });
        if (!updated) {
          throw new EventFoundationError("WRITE_NOT_DURABLE");
        }
        return { id: updated.id, replayed: false, status: input.status };
      });
    },

    async observeSystemProblem(input: SystemProblemInput) {
      const observation = systemProblemObservation(boundEnvironment, input);
      const [row] = await db
        .insert(systemProblems)
        .values({
          category: observation.category,
          createdAt: observation.observedAt,
          environment: boundEnvironment,
          fingerprint: observation.fingerprint,
          firstObservedAt: observation.observedAt,
          lastObservedAt: observation.observedAt,
          privateNote: null,
          provider: observation.provider,
          providerReference: observation.providerReference,
          resolvedAt: null,
          resolvedByClerkUserId: null,
          seenAt: null,
          seenByClerkUserId: null,
          status: "new",
          title: observation.title,
          updatedAt: observation.observedAt,
        })
        .onConflictDoUpdate({
          target: [systemProblems.environment, systemProblems.fingerprint],
          set: {
            lastObservedAt: sql`greatest(${systemProblems.lastObservedAt}, ${observation.observedAt})`,
            provider: descriptiveValueForAtLeastAsRecentObservation(
              observation.observedAt,
              observation.provider,
              systemProblems.provider,
            ),
            providerReference: descriptiveValueForAtLeastAsRecentObservation(
              observation.observedAt,
              observation.providerReference,
              systemProblems.providerReference,
            ),
            resolvedAt: sql`case when ${systemProblems.status} = 'resolved' and ${observation.observedAt} > greatest(${systemProblems.lastObservedAt}, ${systemProblems.resolvedAt}) then null else ${systemProblems.resolvedAt} end`,
            resolvedByClerkUserId: sql`case when ${systemProblems.status} = 'resolved' and ${observation.observedAt} > greatest(${systemProblems.lastObservedAt}, ${systemProblems.resolvedAt}) then null else ${systemProblems.resolvedByClerkUserId} end`,
            seenAt: sql`case when ${systemProblems.status} = 'resolved' and ${observation.observedAt} > greatest(${systemProblems.lastObservedAt}, ${systemProblems.resolvedAt}) then null else ${systemProblems.seenAt} end`,
            seenByClerkUserId: sql`case when ${systemProblems.status} = 'resolved' and ${observation.observedAt} > greatest(${systemProblems.lastObservedAt}, ${systemProblems.resolvedAt}) then null else ${systemProblems.seenByClerkUserId} end`,
            status: sql`case when ${systemProblems.status} = 'resolved' and ${observation.observedAt} > greatest(${systemProblems.lastObservedAt}, ${systemProblems.resolvedAt}) then 'new'::"system_problem_state" else ${systemProblems.status} end`,
            title: descriptiveValueForAtLeastAsRecentObservation(
              observation.observedAt,
              observation.title,
              systemProblems.title,
            ),
            updatedAt: sql`greatest(${systemProblems.updatedAt}, ${observation.observedAt})`,
          },
        })
        .returning({
          id: systemProblems.id,
          status: systemProblems.status,
        });
      if (!row) throw new EventFoundationError("WRITE_NOT_DURABLE");
      return row;
    },
  });
}
