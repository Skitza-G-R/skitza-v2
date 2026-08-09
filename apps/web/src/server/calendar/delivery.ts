import { randomUUID } from "node:crypto";

import type { CalendarSyncJob } from "@skitza/db";

import type { SendSessionCalendarEmailInput } from "~/server/email/send";
import { buildSessionCalendarIcs } from "./ics";

export const CALENDAR_DELIVERY_LEASE_MS = 5 * 60 * 1_000;
export const CALENDAR_PROVIDER_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const CALENDAR_RETRY_BASE_MS = 30 * 1_000;
const CALENDAR_RETRY_MAX_MS = 30 * 60 * 1_000;

export type CalendarDeliveryJob = Readonly<
  Pick<
    CalendarSyncJob,
    | "id"
    | "bookingId"
    | "producerId"
    | "deliveryChannel"
    | "bookingCalendarLinkId"
    | "operation"
    | "desiredRevision"
    | "idempotencyKey"
    | "payloadSnapshot"
    | "attemptCount"
    | "firstAttemptAt"
    | "providerDedupeExpiresAt"
    | "createdAt"
    | "updatedAt"
  >
>;

type LeasedJobIdentity = Readonly<{
  jobId: string;
  producerId: string;
  leaseToken: string;
}>;

export interface CalendarDeliveryRepository {
  claimDueJobs(input: {
    now: Date;
    limit: number;
    deliveryChannel: "ics";
    jobId?: string;
    leaseToken: string;
    leaseDurationMs: number;
    providerDedupeWindowMs: number;
  }): Promise<readonly CalendarDeliveryJob[]>;
  completeJob(
    input: LeasedJobIdentity & {
      bookingCalendarLinkId: string | null;
      desiredRevision: number;
      providerMessageId: string;
      completedAt: Date;
    },
  ): Promise<boolean>;
  retryJob(
    input: LeasedJobIdentity & { nextAttemptAt: Date; failedAt: Date; error: string },
  ): Promise<boolean>;
  terminalJob(input: LeasedJobIdentity & { terminalAt: Date; error: string }): Promise<boolean>;
}

export type SessionCalendarEmailSender = (input: SendSessionCalendarEmailInput) => Promise<string>;

export type ProcessCalendarSyncJobsResult = Readonly<{
  claimed: number;
  completed: number;
  retried: number;
  terminal: number;
  leaseLost: number;
}>;

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    CALENDAR_RETRY_MAX_MS,
    CALENDAR_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
  );
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Calendar delivery failed";
  const message = error.message.replace(/[\r\n]+/gu, " ").trim();
  return (message || "Calendar delivery failed").slice(0, 4_000);
}

function leaseIdentity(job: CalendarDeliveryJob, leaseToken: string): LeasedJobIdentity {
  return { jobId: job.id, producerId: job.producerId, leaseToken };
}

export async function processCalendarSyncJobs(
  repository: CalendarDeliveryRepository,
  sendEmail: SessionCalendarEmailSender,
  options: Readonly<{
    now?: Date;
    limit?: number;
    jobId?: string;
    leaseToken?: string;
  }> = {},
): Promise<ProcessCalendarSyncJobsResult> {
  const claimAt = options.now ?? new Date();
  const currentTime = () => options.now ?? new Date();
  const limit = options.limit ?? 25;
  if (Number.isNaN(claimAt.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid calendar delivery batch options");
  }

  const leaseToken = options.leaseToken ?? randomUUID();
  const jobs = await repository.claimDueJobs({
    now: claimAt,
    limit,
    ...(options.jobId ? { jobId: options.jobId } : {}),
    leaseToken,
    deliveryChannel: "ics",
    leaseDurationMs: CALENDAR_DELIVERY_LEASE_MS,
    providerDedupeWindowMs: CALENDAR_PROVIDER_DEDUPE_WINDOW_MS,
  });
  const result = {
    claimed: jobs.length,
    completed: 0,
    retried: 0,
    terminal: 0,
    leaseLost: 0,
  };

  for (const job of jobs) {
    const identity = leaseIdentity(job, leaseToken);
    const attemptedAt = currentTime();
    if (
      job.deliveryChannel !== "ics" ||
      job.operation !== "send_ics" ||
      job.payloadSnapshot.schemaVersion !== 1 ||
      job.payloadSnapshot.sequence !== job.desiredRevision
    ) {
      const changed = await repository.terminalJob({
        ...identity,
        terminalAt: attemptedAt,
        error: "Invalid calendar delivery intent",
      });
      if (changed) result.terminal += 1;
      else result.leaseLost += 1;
      continue;
    }

    if (
      job.firstAttemptAt !== null &&
      job.providerDedupeExpiresAt !== null &&
      attemptedAt.getTime() >= job.providerDedupeExpiresAt.getTime()
    ) {
      const changed = await repository.terminalJob({
        ...identity,
        terminalAt: attemptedAt,
        error: "Provider idempotency window expired",
      });
      if (changed) result.terminal += 1;
      else result.leaseLost += 1;
      continue;
    }

    let icsContent: string;
    try {
      icsContent = buildSessionCalendarIcs(job.payloadSnapshot);
    } catch {
      const changed = await repository.terminalJob({
        ...identity,
        terminalAt: attemptedAt,
        error: "Invalid calendar delivery payload",
      });
      if (changed) result.terminal += 1;
      else result.leaseLost += 1;
      continue;
    }

    let providerMessageId: string;
    try {
      providerMessageId = await sendEmail({
        to: job.payloadSnapshot.attendee.email,
        method: job.payloadSnapshot.method,
        summary: job.payloadSnapshot.summary,
        organizerName: job.payloadSnapshot.organizer.name,
        icsContent,
        idempotencyKey: job.idempotencyKey,
      });
    } catch (error) {
      const failedAt = currentTime();
      const delayMs = retryDelayMs(job.attemptCount);
      const nextAttemptAt = new Date(failedAt.getTime() + delayMs);
      const dedupeExpiresAt = job.providerDedupeExpiresAt;
      const mustStop =
        dedupeExpiresAt === null || nextAttemptAt.getTime() >= dedupeExpiresAt.getTime();
      const changed = mustStop
        ? await repository.terminalJob({
            ...identity,
            terminalAt: failedAt,
            error: "Provider idempotency window expired",
          })
        : await repository.retryJob({
            ...identity,
            nextAttemptAt,
            failedAt,
            error: safeErrorMessage(error),
          });
      if (!changed) result.leaseLost += 1;
      else if (mustStop) result.terminal += 1;
      else result.retried += 1;
      continue;
    }

    const completed = await repository.completeJob({
      ...identity,
      bookingCalendarLinkId: job.bookingCalendarLinkId,
      desiredRevision: job.desiredRevision,
      providerMessageId,
      completedAt: currentTime(),
    });
    if (completed) result.completed += 1;
    else result.leaseLost += 1;
  }

  return result;
}
