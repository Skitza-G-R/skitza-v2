import { randomUUID } from "node:crypto";

import type { GoogleCalendarReconcileJobPayloadSnapshot } from "@skitza/db";

import {
  GoogleCalendarProviderError,
  type GoogleCalendarLinkedEventLookup,
  type GoogleCalendarLinkedEventReader,
} from "~/server/google-calendar";

import type { GoogleCalendarPreparedLink } from "./google-delivery";

export const GOOGLE_CALENDAR_RECONCILIATION_LEASE_MS = 5 * 60 * 1_000;
const GOOGLE_CALENDAR_RECONCILIATION_RETRY_BASE_MS = 30 * 1_000;
const GOOGLE_CALENDAR_RECONCILIATION_RETRY_MAX_MS = 30 * 60 * 1_000;
const GOOGLE_CALENDAR_RECONCILIATION_TERMINAL_ATTEMPT = 12;

export type GoogleCalendarReconciliationErrorCode =
  | "provider_unavailable"
  | "rate_limited"
  | "permission_denied"
  | "reconnect_required"
  | "invalid_provider_event"
  | "reconciliation_failed"
  | "unknown";

export type GoogleCalendarReconciliationJob = Readonly<{
  id: string;
  bookingId: string;
  producerId: string;
  bookingCalendarLinkId: string;
  desiredRevision: number;
  payloadSnapshot: GoogleCalendarReconcileJobPayloadSnapshot;
  attemptCount: number;
}>;

export type GoogleCalendarPreparedReconciliation = Readonly<{
  job: GoogleCalendarReconciliationJob;
  link: GoogleCalendarPreparedLink;
  currentBookingId: string;
  artistEmail: string;
}>;

type LeasedReconciliationIdentity = Readonly<{
  jobId: string;
  producerId: string;
  leaseToken: string;
}>;

export type GoogleCalendarReconciliationApplyResult = Readonly<{
  outcome: "reconciled" | "unchanged" | "missing" | "conflict" | "corrected" | "lease_lost";
}>;

export type GoogleCalendarReconciliationApply = (
  prepared: GoogleCalendarPreparedReconciliation,
  lookup: GoogleCalendarLinkedEventLookup,
  input: Readonly<{ leaseToken: string; reconciledAt: Date }>,
) => Promise<GoogleCalendarReconciliationApplyResult>;

export interface GoogleCalendarReconciliationRepository {
  claimDueGoogleReconciliationJobs(input: {
    now: Date;
    limit: number;
    leaseToken: string;
    leaseDurationMs: number;
  }): Promise<readonly GoogleCalendarReconciliationJob[]>;
  prepareGoogleReconciliationJob(
    input: LeasedReconciliationIdentity & { preparedAt: Date },
  ): Promise<
    | Readonly<{ outcome: "ready"; value: GoogleCalendarPreparedReconciliation }>
    | Readonly<{ outcome: "superseded" }>
    | Readonly<{ outcome: "invalid" }>
    | Readonly<{ outcome: "lease_lost" }>
  >;
  completeSupersededGoogleReconciliationJob(
    input: LeasedReconciliationIdentity & { completedAt: Date },
  ): Promise<boolean>;
  completeDisconnectedGoogleReconciliationJob(
    input: LeasedReconciliationIdentity & {
      linkId: string;
      completedAt: Date;
      reconnectRequired: boolean;
    },
  ): Promise<boolean>;
  retryGoogleReconciliationJob(
    input: LeasedReconciliationIdentity & {
      linkId: string;
      failedAt: Date;
      nextAttemptAt: Date;
      errorCode: GoogleCalendarReconciliationErrorCode;
    },
  ): Promise<boolean>;
  terminalGoogleReconciliationJob(
    input: LeasedReconciliationIdentity & {
      linkId: string;
      terminalAt: Date;
      errorCode: GoogleCalendarReconciliationErrorCode;
    },
  ): Promise<boolean>;
  enqueueGoogleReconciliationRecovery(input: {
    now: Date;
    limit: number;
  }): Promise<Readonly<{ scanned: number; jobsEnqueued: number }>>;
}

export type ProcessGoogleCalendarReconciliationsResult = Readonly<{
  claimed: number;
  reconciled: number;
  unchanged: number;
  missing: number;
  conflicts: number;
  corrected: number;
  disconnected: number;
  retried: number;
  terminal: number;
  leaseLost: number;
}>;

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    GOOGLE_CALENDAR_RECONCILIATION_RETRY_MAX_MS,
    GOOGLE_CALENDAR_RECONCILIATION_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
  );
}

function identity(
  job: GoogleCalendarReconciliationJob,
  leaseToken: string,
): LeasedReconciliationIdentity {
  return { jobId: job.id, producerId: job.producerId, leaseToken };
}

function safeErrorCode(error: unknown): GoogleCalendarReconciliationErrorCode {
  if (!(error instanceof GoogleCalendarProviderError)) return "unknown";
  if (error.code === "provider_rate_limited") return "rate_limited";
  if (error.code === "access_unauthorized" || error.code === "refresh_invalid_grant") {
    return "reconnect_required";
  }
  if (error.code === "provider_invalid_response") return "invalid_provider_event";
  if (error.code === "provider_unavailable") return "provider_unavailable";
  return "reconciliation_failed";
}

export async function processGoogleCalendarReconciliations(
  dependencies: Readonly<{
    repository: GoogleCalendarReconciliationRepository;
    reader: GoogleCalendarLinkedEventReader;
    apply: GoogleCalendarReconciliationApply;
  }>,
  options: Readonly<{
    now?: Date;
    clock?: () => Date;
    limit?: number;
    leaseToken?: string;
  }> = {},
): Promise<ProcessGoogleCalendarReconciliationsResult> {
  const claimAt = options.now ?? new Date();
  const currentTime = options.clock ?? (() => options.now ?? new Date());
  const limit = options.limit ?? 25;
  if (Number.isNaN(claimAt.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid Google Calendar reconciliation batch options");
  }

  const leaseToken = options.leaseToken ?? randomUUID();
  const jobs = await dependencies.repository.claimDueGoogleReconciliationJobs({
    now: claimAt,
    limit,
    leaseToken,
    leaseDurationMs: GOOGLE_CALENDAR_RECONCILIATION_LEASE_MS,
  });
  const result = {
    claimed: jobs.length,
    reconciled: 0,
    unchanged: 0,
    missing: 0,
    conflicts: 0,
    corrected: 0,
    disconnected: 0,
    retried: 0,
    terminal: 0,
    leaseLost: 0,
  };

  for (const job of jobs) {
    const leased = identity(job, leaseToken);
    const prepared = await dependencies.repository.prepareGoogleReconciliationJob({
      ...leased,
      preparedAt: currentTime(),
    });
    if (prepared.outcome === "lease_lost") {
      result.leaseLost += 1;
      continue;
    }
    if (prepared.outcome === "superseded") {
      const completed = await dependencies.repository.completeSupersededGoogleReconciliationJob({
        ...leased,
        completedAt: currentTime(),
      });
      if (completed) result.unchanged += 1;
      else result.leaseLost += 1;
      continue;
    }
    if (prepared.outcome === "invalid") {
      const terminal = await dependencies.repository.terminalGoogleReconciliationJob({
        ...leased,
        linkId: job.bookingCalendarLinkId,
        terminalAt: currentTime(),
        errorCode: "invalid_provider_event",
      });
      if (terminal) result.terminal += 1;
      else result.leaseLost += 1;
      continue;
    }
    try {
      const read = await dependencies.reader(prepared.value.link, {
        artistEmail: prepared.value.artistEmail,
        ...(prepared.value.link.providerEventEtag
          ? { ifNoneMatch: prepared.value.link.providerEventEtag }
          : {}),
      });
      if (!("lookup" in read)) {
        if (read.status === "disconnected" || read.status === "reconnect_required") {
          const completed =
            await dependencies.repository.completeDisconnectedGoogleReconciliationJob({
              ...leased,
              linkId: prepared.value.link.id,
              completedAt: currentTime(),
              reconnectRequired: read.status === "reconnect_required",
            });
          if (completed) result.disconnected += 1;
          else result.leaseLost += 1;
          continue;
        }
        throw new GoogleCalendarProviderError("provider_unavailable");
      }

      const applied = await dependencies.apply(prepared.value, read.lookup, {
        leaseToken,
        reconciledAt: currentTime(),
      });
      if (applied.outcome === "lease_lost") result.leaseLost += 1;
      else if (applied.outcome === "unchanged") result.unchanged += 1;
      else if (applied.outcome === "missing") result.missing += 1;
      else if (applied.outcome === "conflict") result.conflicts += 1;
      else if (applied.outcome === "corrected") result.corrected += 1;
      else result.reconciled += 1;
      continue;
    } catch (error) {
      const failedAt = currentTime();
      const errorCode = safeErrorCode(error);
      const mustStop = job.attemptCount >= GOOGLE_CALENDAR_RECONCILIATION_TERMINAL_ATTEMPT;
      const changed = mustStop
        ? await dependencies.repository.terminalGoogleReconciliationJob({
            ...leased,
            linkId: prepared.value.link.id,
            terminalAt: failedAt,
            errorCode,
          })
        : await dependencies.repository.retryGoogleReconciliationJob({
            ...leased,
            linkId: prepared.value.link.id,
            failedAt,
            nextAttemptAt: new Date(failedAt.getTime() + retryDelayMs(job.attemptCount)),
            errorCode,
          });
      if (!changed) result.leaseLost += 1;
      else if (mustStop) result.terminal += 1;
      else result.retried += 1;
    }
  }

  return result;
}
