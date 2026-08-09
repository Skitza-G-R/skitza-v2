import { createHash } from "node:crypto";

import {
  and,
  calendarSyncJobManualRetries,
  calendarSyncJobs,
  eq,
  type CalendarSyncJob,
  type Db,
} from "@skitza/db";

export type CalendarManualRetryErrorCode =
  | "NOT_FOUND"
  | "NOT_TERMINAL"
  | "OPERATION_KEY_CONFLICT"
  | "CONCURRENT_UPDATE";

export class CalendarManualRetryError extends Error {
  constructor(
    readonly code: CalendarManualRetryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CalendarManualRetryError";
  }
}

export type ManualRetryCalendarSyncJobInput = Readonly<{
  jobId: string;
  producerId: string;
  operationKey: string;
  actorIdentity: string;
  now?: Date;
}>;

export type ManualRetryCalendarSyncJobResult = Readonly<{
  jobId: string;
  producerId: string;
  retryNumber: number;
  replayed: boolean;
  status: CalendarSyncJob["status"];
  idempotencyKey: string;
}>;

type CalendarManualRetryCommand = Readonly<{
  jobId: string;
  producerId: string;
  operationKey: string;
  operationDigest: string;
  actorIdentity: string;
  requestedAt: Date;
}>;

export interface CalendarManualRetryRepository {
  reissueTerminalJob(
    command: CalendarManualRetryCommand,
  ): Promise<ManualRetryCalendarSyncJobResult>;
}

function assertOperationText(value: string, label: string): void {
  const containsControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 200 ||
    containsControlCharacter
  ) {
    throw new CalendarManualRetryError("OPERATION_KEY_CONFLICT", `Invalid ${label}`);
  }
}

function retryOperationDigest(input: ManualRetryCalendarSyncJobInput): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        kind: "manual-calendar-retry",
        jobId: input.jobId,
        producerId: input.producerId,
        actorIdentity: input.actorIdentity,
      }),
      "utf8",
    )
    .digest("hex")}`;
}

export function calendarManualRetryIdempotencyKey(
  jobId: string,
  retryNumber: number,
  operationDigest: string,
  deliveryChannel: CalendarSyncJob["deliveryChannel"] = "ics",
): string {
  const prefix = deliveryChannel === "google" ? "google:manual" : "calendar:send_ics:manual";
  return `${prefix}:${jobId}:${String(retryNumber)}:${operationDigest.slice(7, 23)}`;
}

function monotonicRetryAt(requested: Date, updatedAt: Date, terminalAt: Date): Date {
  return new Date(Math.max(requested.getTime(), updatedAt.getTime() + 1, terminalAt.getTime()));
}

export async function manualRetryCalendarSyncJob(
  repository: CalendarManualRetryRepository,
  input: ManualRetryCalendarSyncJobInput,
): Promise<ManualRetryCalendarSyncJobResult> {
  assertOperationText(input.operationKey, "calendar retry operation key");
  assertOperationText(input.actorIdentity, "calendar retry actor identity");
  const requestedAt = input.now ?? new Date();
  if (Number.isNaN(requestedAt.getTime())) {
    throw new CalendarManualRetryError("OPERATION_KEY_CONFLICT", "Invalid calendar retry time");
  }
  const operationDigest = retryOperationDigest(input);

  return repository.reissueTerminalJob({
    jobId: input.jobId,
    producerId: input.producerId,
    operationKey: input.operationKey,
    operationDigest,
    actorIdentity: input.actorIdentity,
    requestedAt,
  });
}

export function calendarManualRetryRepository(db: Db): CalendarManualRetryRepository {
  return {
    reissueTerminalJob: (input) =>
      db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
            ),
          )
          .limit(1)
          .for("update");
        if (!job) {
          throw new CalendarManualRetryError("NOT_FOUND", "Calendar delivery job not found");
        }

        const [existingOperation] = await tx
          .select()
          .from(calendarSyncJobManualRetries)
          .where(eq(calendarSyncJobManualRetries.operationKey, input.operationKey))
          .limit(1);
        if (existingOperation) {
          if (
            existingOperation.jobId !== job.id ||
            existingOperation.producerId !== job.producerId ||
            existingOperation.operationDigest !== input.operationDigest
          ) {
            throw new CalendarManualRetryError(
              "OPERATION_KEY_CONFLICT",
              "This retry operation key belongs to another command",
            );
          }
          return {
            jobId: job.id,
            producerId: job.producerId,
            retryNumber: existingOperation.retryNumber,
            replayed: true,
            status: job.status,
            idempotencyKey: existingOperation.newIdempotencyKey,
          };
        }

        const providerDedupeShapeMatches =
          (job.deliveryChannel === "ics" && job.providerDedupeExpiresAt !== null) ||
          (job.deliveryChannel === "google" && job.providerDedupeExpiresAt === null);
        if (
          job.status !== "terminal" ||
          job.firstAttemptAt === null ||
          job.lastAttemptAt === null ||
          !providerDedupeShapeMatches ||
          job.terminalAt === null ||
          job.terminalError === null
        ) {
          throw new CalendarManualRetryError(
            "NOT_TERMINAL",
            "Only a terminal calendar delivery can be manually retried",
          );
        }

        const retryNumber = job.manualRetryCount + 1;
        const retryAt = monotonicRetryAt(input.requestedAt, job.updatedAt, job.terminalAt);
        const idempotencyKey = calendarManualRetryIdempotencyKey(
          job.id,
          retryNumber,
          input.operationDigest,
          job.deliveryChannel,
        );

        await tx.insert(calendarSyncJobManualRetries).values({
          jobId: job.id,
          producerId: job.producerId,
          retryNumber,
          operationKey: input.operationKey,
          operationDigest: input.operationDigest,
          actorIdentity: input.actorIdentity,
          requestedAt: retryAt,
          priorIdempotencyKey: job.idempotencyKey,
          newIdempotencyKey: idempotencyKey,
          priorAttemptCount: job.attemptCount,
          priorFirstAttemptAt: job.firstAttemptAt,
          priorLastAttemptAt: job.lastAttemptAt,
          priorProviderDedupeExpiresAt: job.providerDedupeExpiresAt,
          priorLastError: job.lastError,
          priorTerminalAt: job.terminalAt,
          priorTerminalError: job.terminalError,
          createdAt: retryAt,
        });

        const [reissued] = await tx
          .update(calendarSyncJobs)
          .set({
            status: "pending",
            idempotencyKey,
            attemptCount: 0,
            firstAttemptAt: null,
            lastAttemptAt: null,
            providerDedupeExpiresAt: null,
            nextAttemptAt: retryAt,
            leaseToken: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            lastError: null,
            providerMessageId: null,
            completedAt: null,
            terminalAt: null,
            terminalError: null,
            manualRetryCount: retryNumber,
            lastManualRetryAt: retryAt,
            lastManualRetryActor: input.actorIdentity,
            lastManualRetryOperationKey: input.operationKey,
            lastManualRetryOperationDigest: input.operationDigest,
            updatedAt: retryAt,
          })
          .where(
            and(
              eq(calendarSyncJobs.id, job.id),
              eq(calendarSyncJobs.producerId, job.producerId),
              eq(calendarSyncJobs.status, "terminal"),
              eq(calendarSyncJobs.manualRetryCount, job.manualRetryCount),
            ),
          )
          .returning();
        if (!reissued) {
          throw new CalendarManualRetryError(
            "CONCURRENT_UPDATE",
            "Calendar delivery changed during manual retry",
          );
        }

        return {
          jobId: reissued.id,
          producerId: reissued.producerId,
          retryNumber,
          replayed: false,
          status: reissued.status,
          idempotencyKey: reissued.idempotencyKey,
        };
      }),
  };
}
