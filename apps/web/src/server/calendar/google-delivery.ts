import { randomUUID } from "node:crypto";

import type { BookingCalendarLink, GoogleCalendarSyncJobPayloadSnapshot } from "@skitza/db";

import {
  GoogleCalendarEventValidationError,
  GoogleCalendarProviderError,
  buildGoogleCalendarEventWrite,
  type GoogleCalendarEventRecord,
  type GoogleCalendarProvider,
  type GoogleCalendarSendUpdates,
} from "~/server/google-calendar";

export const GOOGLE_CALENDAR_DELIVERY_LEASE_MS = 5 * 60 * 1_000;
const GOOGLE_CALENDAR_RETRY_BASE_MS = 30 * 1_000;
const GOOGLE_CALENDAR_RETRY_MAX_MS = 30 * 60 * 1_000;
const GOOGLE_CALENDAR_TERMINAL_ATTEMPT = 12;

export type GoogleCalendarDeliveryJob = Readonly<{
  id: string;
  bookingId: string;
  producerId: string;
  deliveryChannel: "google";
  bookingCalendarLinkId: string;
  operation: "upsert_google_event" | "delete_google_event";
  desiredRevision: number;
  payloadSnapshot: GoogleCalendarSyncJobPayloadSnapshot;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type GoogleCalendarPreparedLink = Readonly<
  Pick<
    BookingCalendarLink,
    | "id"
    | "producerId"
    | "connectionId"
    | "accountVersion"
    | "destinationSelectionId"
    | "destinationCalendarIdCiphertext"
    | "destinationCalendarIdIv"
    | "destinationCalendarIdAuthTag"
    | "destinationCalendarIdKeyVersion"
    | "providerEventId"
    | "providerEventEtag"
    | "providerState"
    | "syncState"
    | "desiredRevision"
    | "lastGoogleRevision"
    | "invitationRevision"
    | "invitationChannel"
    | "invitationReservedAt"
    | "invitationAttemptedAt"
    | "invitationDeliveredAt"
  >
>;

export type GoogleCalendarPreparedJob = Readonly<{
  job: GoogleCalendarDeliveryJob;
  link: GoogleCalendarPreparedLink;
  producerAttendee: Readonly<{ email: string; displayName: string }>;
  lastGoogleEventKind: "opaque_hold" | "confirmed" | null;
}>;

type LeasedGoogleJobIdentity = Readonly<{
  jobId: string;
  producerId: string;
  leaseToken: string;
}>;

export interface GoogleCalendarDeliveryRepository {
  claimDueGoogleJobs(input: {
    now: Date;
    limit: number;
    jobId?: string;
    producerId?: string;
    forcePending?: boolean;
    leaseToken: string;
    leaseDurationMs: number;
  }): Promise<readonly GoogleCalendarDeliveryJob[]>;
  prepareGoogleJob(
    input: LeasedGoogleJobIdentity & { preparedAt: Date },
  ): Promise<
    | Readonly<{ outcome: "ready"; value: GoogleCalendarPreparedJob }>
    | Readonly<{ outcome: "superseded" }>
    | Readonly<{ outcome: "invalid" }>
    | Readonly<{ outcome: "lease_lost" }>
  >;
  completeSupersededGoogleJob(
    input: LeasedGoogleJobIdentity & { completedAt: Date },
  ): Promise<boolean>;
  completeGoogleJob(
    input: LeasedGoogleJobIdentity & {
      linkId: string;
      desiredRevision: number;
      providerState: "active" | "deleted";
      providerEventEtag: string | null;
      notificationDelivered: boolean;
      completedAt: Date;
    },
  ): Promise<boolean>;
  markGoogleNotificationAttempt(
    input: LeasedGoogleJobIdentity & {
      linkId: string;
      desiredRevision: number;
      attemptedAt: Date;
    },
  ): Promise<boolean>;
  enqueueIcsFallback(
    input: LeasedGoogleJobIdentity & { failedAt: Date },
  ): Promise<
    | Readonly<{ outcome: "enqueued" | "already_enqueued"; jobId: string }>
    | Readonly<{ outcome: "not_safe" | "lease_lost" }>
  >;
  retryGoogleJob(
    input: LeasedGoogleJobIdentity & {
      nextAttemptAt: Date;
      failedAt: Date;
      error: string;
    },
  ): Promise<boolean>;
  terminalGoogleJob(
    input: LeasedGoogleJobIdentity & { terminalAt: Date; error: string },
  ): Promise<boolean>;
}

export type GoogleCalendarWorkerAccessResult =
  | Readonly<{
      status: "ready";
      accessToken: string;
      calendarId: string;
      markReconnectRequired: () => Promise<void>;
    }>
  | Readonly<{ status: "unavailable" | "reconnect_required" | "disconnected" }>;

export type GoogleCalendarWorkerAccess = (
  link: GoogleCalendarPreparedLink,
) => Promise<GoogleCalendarWorkerAccessResult>;

export type ProcessGoogleCalendarSyncJobsResult = Readonly<{
  claimed: number;
  completed: number;
  retried: number;
  terminal: number;
  leaseLost: number;
  fallbackEnqueued: number;
  fallbackJobIds: readonly string[];
}>;

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    GOOGLE_CALENDAR_RETRY_MAX_MS,
    GOOGLE_CALENDAR_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
  );
}

function identity(job: GoogleCalendarDeliveryJob, leaseToken: string): LeasedGoogleJobIdentity {
  return { jobId: job.id, producerId: job.producerId, leaseToken };
}

function eventMatchesLink(
  event: GoogleCalendarEventRecord,
  prepared: GoogleCalendarPreparedJob,
): boolean {
  const linkage = event.linkage;
  return linkage !== null && linkage.opaqueLink === prepared.link.id;
}

function requestedSendUpdates(prepared: GoogleCalendarPreparedJob): GoogleCalendarSendUpdates {
  if (prepared.job.payloadSnapshot.notificationMode === "none") return "none";
  return prepared.link.invitationRevision === prepared.job.desiredRevision &&
    prepared.link.invitationChannel === "google" &&
    prepared.link.invitationDeliveredAt === null
    ? "all"
    : "none";
}

type GoogleDeliveryParticipant = NonNullable<GoogleCalendarEventRecord["attendees"]>[number];

function attendeeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function participantsForConfirmedWrite(
  prepared: GoogleCalendarPreparedJob,
  remote: GoogleCalendarEventRecord | null,
): readonly [GoogleDeliveryParticipant, ...GoogleDeliveryParticipant[]] | null {
  const payload = prepared.job.payloadSnapshot;
  if (payload.action !== "upsert" || payload.eventKind !== "confirmed" || !payload.attendee) {
    return null;
  }
  const required = [
    prepared.producerAttendee,
    { email: payload.attendee.email, displayName: payload.attendee.name },
  ] as const;
  if (remote === null) return required;
  if (remote.attendees === undefined) {
    return prepared.lastGoogleEventKind === "confirmed" ? null : required;
  }
  const presentEmails = new Set(remote.attendees.map((attendee) => attendeeEmail(attendee.email)));
  const missing = required.filter(
    (participant) => !presentEmails.has(attendeeEmail(participant.email)),
  );
  if (missing.length === 0) return null;
  const [first, ...rest] = [...remote.attendees, ...missing];
  if (!first) throw new GoogleCalendarEventValidationError();
  return [first, ...rest];
}

function buildWrite(prepared: GoogleCalendarPreparedJob, remote: GoogleCalendarEventRecord | null) {
  const payload = prepared.job.payloadSnapshot;
  if (payload.action !== "upsert") throw new GoogleCalendarEventValidationError();
  if (payload.eventKind === "opaque_hold") {
    return buildGoogleCalendarEventWrite({
      eventId: prepared.link.providerEventId,
      kind: "hold",
      startsAt: new Date(payload.startsAtUtc),
      endsAt: new Date(payload.endsAtUtc),
      ...(payload.timeZone === undefined ? {} : { timeZone: payload.timeZone }),
      revision: payload.sequence,
      opaqueLink: payload.privateProperties.skitzaLink,
    });
  }
  if (!payload.attendee || !payload.artistSafeUrl) {
    throw new GoogleCalendarEventValidationError();
  }
  const base = {
    eventId: prepared.link.providerEventId,
    kind: "confirmed" as const,
    startsAt: new Date(payload.startsAtUtc),
    endsAt: new Date(payload.endsAtUtc),
    ...(payload.timeZone === undefined ? {} : { timeZone: payload.timeZone }),
    revision: payload.sequence,
    opaqueLink: payload.privateProperties.skitzaLink,
    summary: payload.summary,
    artistSafeSessionUrl: payload.artistSafeUrl,
  };
  const participants = participantsForConfirmedWrite(prepared, remote);
  return participants
    ? buildGoogleCalendarEventWrite({
        ...base,
        attendeeMode: "set_participants",
        participants,
      })
    : buildGoogleCalendarEventWrite({ ...base, attendeeMode: "preserve" });
}

function safeProviderError(error: unknown): string {
  if (error instanceof GoogleCalendarProviderError) {
    return `Google Calendar delivery failed: ${error.code}`;
  }
  return "Google Calendar delivery failed";
}

function isNotFound(error: unknown): boolean {
  return error instanceof GoogleCalendarProviderError && error.code === "event_not_found";
}

async function readRemoteEvent(
  provider: GoogleCalendarProvider,
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<GoogleCalendarEventRecord | null> {
  try {
    return await provider.getEvent(accessToken, { calendarId, eventId });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function finishProviderSuccess(
  repository: GoogleCalendarDeliveryRepository,
  prepared: GoogleCalendarPreparedJob,
  leaseToken: string,
  input: Readonly<{
    providerState: "active" | "deleted";
    providerEventEtag: string | null;
    notificationDelivered: boolean;
    completedAt: Date;
  }>,
): Promise<boolean> {
  return repository.completeGoogleJob({
    ...identity(prepared.job, leaseToken),
    linkId: prepared.link.id,
    desiredRevision: prepared.job.desiredRevision,
    ...input,
  });
}

async function markNotificationAttempt(
  repository: GoogleCalendarDeliveryRepository,
  prepared: GoogleCalendarPreparedJob,
  leaseToken: string,
  sendUpdates: GoogleCalendarSendUpdates,
  attemptedAt: Date,
): Promise<boolean> {
  if (sendUpdates === "none" || prepared.link.invitationAttemptedAt !== null) return true;
  return repository.markGoogleNotificationAttempt({
    ...identity(prepared.job, leaseToken),
    linkId: prepared.link.id,
    desiredRevision: prepared.job.desiredRevision,
    attemptedAt,
  });
}

async function attemptGoogleWrite(
  input: Readonly<{
    provider: GoogleCalendarProvider;
    repository: GoogleCalendarDeliveryRepository;
    prepared: GoogleCalendarPreparedJob;
    accessToken: string;
    calendarId: string;
    leaseToken: string;
    now: () => Date;
  }>,
): Promise<"completed" | "lease_lost" | "safe_failure" | "delete_needs_fallback"> {
  const { prepared } = input;
  const sendUpdates = requestedSendUpdates(prepared);
  const remote = await readRemoteEvent(
    input.provider,
    input.accessToken,
    input.calendarId,
    prepared.link.providerEventId,
  );

  if (remote && !eventMatchesLink(remote, prepared)) {
    throw new GoogleCalendarEventValidationError();
  }

  if (prepared.job.payloadSnapshot.action === "delete") {
    if (remote === null) {
      if (sendUpdates === "all" && prepared.link.invitationAttemptedAt === null) {
        return "delete_needs_fallback";
      }
      const completed = await finishProviderSuccess(input.repository, prepared, input.leaseToken, {
        providerState: "deleted",
        providerEventEtag: null,
        notificationDelivered: sendUpdates === "all",
        completedAt: input.now(),
      });
      return completed ? "completed" : "lease_lost";
    }
    const attemptAlreadyStarted = prepared.link.invitationAttemptedAt !== null;
    if (
      !(await markNotificationAttempt(
        input.repository,
        prepared,
        input.leaseToken,
        sendUpdates,
        input.now(),
      ))
    ) {
      return "lease_lost";
    }
    try {
      await input.provider.deleteEvent(input.accessToken, {
        calendarId: input.calendarId,
        eventId: prepared.link.providerEventId,
        sendUpdates,
        etag: remote.etag,
      });
    } catch (error) {
      if (isNotFound(error) && sendUpdates === "all" && !attemptAlreadyStarted) {
        return "delete_needs_fallback";
      }
      const after = await readRemoteEvent(
        input.provider,
        input.accessToken,
        input.calendarId,
        prepared.link.providerEventId,
      );
      if (after !== null) throw error;
    }
    const completed = await finishProviderSuccess(input.repository, prepared, input.leaseToken, {
      providerState: "deleted",
      providerEventEtag: null,
      notificationDelivered: sendUpdates === "all",
      completedAt: input.now(),
    });
    return completed ? "completed" : "lease_lost";
  }

  const needsAttendeeUpgrade = participantsForConfirmedWrite(prepared, remote) !== null;
  if (
    remote &&
    remote.linkage?.revision === prepared.job.desiredRevision &&
    !needsAttendeeUpgrade
  ) {
    if (
      !(await markNotificationAttempt(
        input.repository,
        prepared,
        input.leaseToken,
        sendUpdates,
        input.now(),
      ))
    ) {
      return "lease_lost";
    }
    const completed = await finishProviderSuccess(input.repository, prepared, input.leaseToken, {
      providerState: "active",
      providerEventEtag: remote.etag,
      notificationDelivered: sendUpdates === "all",
      completedAt: input.now(),
    });
    return completed ? "completed" : "lease_lost";
  }
  if (remote && (remote.linkage?.revision ?? 0) > prepared.job.desiredRevision) {
    throw new GoogleCalendarEventValidationError();
  }
  if (
    !(await markNotificationAttempt(
      input.repository,
      prepared,
      input.leaseToken,
      sendUpdates,
      input.now(),
    ))
  ) {
    return "lease_lost";
  }

  const write = buildWrite(prepared, remote);
  let written: GoogleCalendarEventRecord;
  try {
    written = remote
      ? await input.provider.patchEvent(input.accessToken, {
          calendarId: input.calendarId,
          event: write,
          sendUpdates,
          etag: remote.etag,
        })
      : await input.provider.insertEvent(input.accessToken, {
          calendarId: input.calendarId,
          event: write,
          sendUpdates,
        });
  } catch {
    const after = await readRemoteEvent(
      input.provider,
      input.accessToken,
      input.calendarId,
      prepared.link.providerEventId,
    );
    if (
      after &&
      eventMatchesLink(after, prepared) &&
      after.linkage?.revision === prepared.job.desiredRevision &&
      participantsForConfirmedWrite(prepared, after) === null
    ) {
      written = after;
    } else {
      if (after && !eventMatchesLink(after, prepared)) {
        throw new GoogleCalendarEventValidationError();
      }
      // A successful read proves the requested revision was not applied.
      // The caller may now safely reserve the one ICS fallback.
      return "safe_failure";
    }
  }

  if (
    !eventMatchesLink(written, prepared) ||
    written.linkage?.revision !== prepared.job.desiredRevision
  ) {
    throw new GoogleCalendarEventValidationError();
  }
  const completed = await finishProviderSuccess(input.repository, prepared, input.leaseToken, {
    providerState: "active",
    providerEventEtag: written.etag,
    notificationDelivered: sendUpdates === "all",
    completedAt: input.now(),
  });
  return completed ? "completed" : "lease_lost";
}

export async function processGoogleCalendarSyncJobs(
  dependencies: Readonly<{
    repository: GoogleCalendarDeliveryRepository;
    provider: GoogleCalendarProvider;
    access: GoogleCalendarWorkerAccess;
  }>,
  options: Readonly<{
    now?: Date;
    clock?: () => Date;
    limit?: number;
    jobId?: string;
    producerId?: string;
    forcePending?: boolean;
    leaseToken?: string;
  }> = {},
): Promise<ProcessGoogleCalendarSyncJobsResult> {
  const claimAt = options.now ?? new Date();
  const currentTime = options.clock ?? (() => options.now ?? new Date());
  const limit = options.limit ?? 25;
  if (Number.isNaN(claimAt.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid Google Calendar delivery batch options");
  }

  const leaseToken = options.leaseToken ?? randomUUID();
  const jobs = await dependencies.repository.claimDueGoogleJobs({
    now: claimAt,
    limit,
    ...(options.jobId ? { jobId: options.jobId } : {}),
    ...(options.producerId ? { producerId: options.producerId } : {}),
    ...(options.forcePending ? { forcePending: true } : {}),
    leaseToken,
    leaseDurationMs: GOOGLE_CALENDAR_DELIVERY_LEASE_MS,
  });
  const result = {
    claimed: jobs.length,
    completed: 0,
    retried: 0,
    terminal: 0,
    leaseLost: 0,
    fallbackEnqueued: 0,
    fallbackJobIds: [] as string[],
  };

  for (const job of jobs) {
    const leased = identity(job, leaseToken);
    const preparedAt = currentTime();
    const prepared = await dependencies.repository.prepareGoogleJob({
      ...leased,
      preparedAt,
    });
    if (prepared.outcome === "lease_lost") {
      result.leaseLost += 1;
      continue;
    }
    if (prepared.outcome === "superseded") {
      const completed = await dependencies.repository.completeSupersededGoogleJob({
        ...leased,
        completedAt: currentTime(),
      });
      if (completed) result.completed += 1;
      else result.leaseLost += 1;
      continue;
    }
    if (prepared.outcome === "invalid") {
      if (job.payloadSnapshot.notificationMode === "all") {
        const fallback = await dependencies.repository.enqueueIcsFallback({
          ...leased,
          failedAt: currentTime(),
        });
        if (fallback.outcome === "lease_lost") {
          result.leaseLost += 1;
          continue;
        }
        if (fallback.outcome === "enqueued") result.fallbackEnqueued += 1;
        if ("jobId" in fallback) result.fallbackJobIds.push(fallback.jobId);
      }
      const terminal = await dependencies.repository.terminalGoogleJob({
        ...leased,
        terminalAt: currentTime(),
        error: "Invalid Google Calendar delivery intent",
      });
      if (terminal) result.terminal += 1;
      else result.leaseLost += 1;
      continue;
    }

    if (
      prepared.value.job.payloadSnapshot.notificationMode === "all" &&
      prepared.value.link.invitationChannel === "ics" &&
      prepared.value.link.invitationDeliveredAt === null
    ) {
      const fallback = await dependencies.repository.enqueueIcsFallback({
        ...leased,
        failedAt: currentTime(),
      });
      if (fallback.outcome === "lease_lost") {
        result.leaseLost += 1;
        continue;
      }
      if (fallback.outcome === "not_safe") {
        const terminal = await dependencies.repository.terminalGoogleJob({
          ...leased,
          terminalAt: currentTime(),
          error: "Existing calendar invitation update unavailable",
        });
        if (terminal) result.terminal += 1;
        else result.leaseLost += 1;
        continue;
      }
      if ("jobId" in fallback) {
        if (fallback.outcome === "enqueued") result.fallbackEnqueued += 1;
        result.fallbackJobIds.push(fallback.jobId);
      }
    }

    if (
      prepared.value.job.payloadSnapshot.action === "delete" &&
      prepared.value.link.syncState === "missing"
    ) {
      const sendUpdates = requestedSendUpdates(prepared.value);
      const needsFallback =
        sendUpdates === "all" && prepared.value.link.invitationAttemptedAt === null;
      if (needsFallback) {
        const fallback = await dependencies.repository.enqueueIcsFallback({
          ...leased,
          failedAt: currentTime(),
        });
        if (fallback.outcome === "lease_lost") {
          result.leaseLost += 1;
          continue;
        }
        if (fallback.outcome === "not_safe") {
          const terminal = await dependencies.repository.terminalGoogleJob({
            ...leased,
            terminalAt: currentTime(),
            error: "Google Calendar cancellation fallback unavailable",
          });
          if (terminal) result.terminal += 1;
          else result.leaseLost += 1;
          continue;
        }
        if (fallback.outcome === "enqueued") result.fallbackEnqueued += 1;
        if ("jobId" in fallback) result.fallbackJobIds.push(fallback.jobId);
      }
      const completed = await finishProviderSuccess(
        dependencies.repository,
        prepared.value,
        leaseToken,
        {
          providerState: "deleted",
          providerEventEtag: null,
          notificationDelivered: sendUpdates === "all" && !needsFallback,
          completedAt: currentTime(),
        },
      );
      if (completed) result.completed += 1;
      else result.leaseLost += 1;
      continue;
    }

    let safeForFallback = false;
    let markReconnectRequired: (() => Promise<void>) | null = null;
    let failure: unknown = new GoogleCalendarProviderError("provider_unavailable");
    try {
      const access = await dependencies.access(prepared.value.link);
      if (access.status !== "ready") {
        safeForFallback = true;
        throw new GoogleCalendarProviderError("provider_unavailable");
      }
      markReconnectRequired = access.markReconnectRequired;
      const outcome = await attemptGoogleWrite({
        provider: dependencies.provider,
        repository: dependencies.repository,
        prepared: prepared.value,
        accessToken: access.accessToken,
        calendarId: access.calendarId,
        leaseToken,
        now: currentTime,
      });
      if (outcome === "completed") {
        result.completed += 1;
        continue;
      }
      if (outcome === "lease_lost") {
        result.leaseLost += 1;
        continue;
      }
      if (outcome === "delete_needs_fallback") {
        const fallback = await dependencies.repository.enqueueIcsFallback({
          ...leased,
          failedAt: currentTime(),
        });
        if (fallback.outcome === "lease_lost") {
          result.leaseLost += 1;
          continue;
        }
        if (fallback.outcome === "not_safe") {
          const terminal = await dependencies.repository.terminalGoogleJob({
            ...leased,
            terminalAt: currentTime(),
            error: "Google Calendar cancellation fallback unavailable",
          });
          if (terminal) result.terminal += 1;
          else result.leaseLost += 1;
          continue;
        }
        if (fallback.outcome === "enqueued") result.fallbackEnqueued += 1;
        if ("jobId" in fallback) result.fallbackJobIds.push(fallback.jobId);
        const completed = await finishProviderSuccess(
          dependencies.repository,
          prepared.value,
          leaseToken,
          {
            providerState: "deleted",
            providerEventEtag: null,
            notificationDelivered: false,
            completedAt: currentTime(),
          },
        );
        if (completed) result.completed += 1;
        else result.leaseLost += 1;
        continue;
      }
      safeForFallback = true;
    } catch (error) {
      failure = error;
      if (
        error instanceof GoogleCalendarProviderError &&
        error.code === "access_unauthorized" &&
        markReconnectRequired
      ) {
        await markReconnectRequired();
      }
      if (error instanceof GoogleCalendarEventValidationError) {
        if (prepared.value.job.payloadSnapshot.notificationMode === "all") {
          const fallback = await dependencies.repository.enqueueIcsFallback({
            ...leased,
            failedAt: currentTime(),
          });
          if (fallback.outcome === "lease_lost") {
            result.leaseLost += 1;
            continue;
          }
          if (fallback.outcome === "enqueued") result.fallbackEnqueued += 1;
          if ("jobId" in fallback) result.fallbackJobIds.push(fallback.jobId);
        }
        const terminal = await dependencies.repository.terminalGoogleJob({
          ...leased,
          terminalAt: currentTime(),
          error: "Invalid Google Calendar provider event state",
        });
        if (terminal) result.terminal += 1;
        else result.leaseLost += 1;
        continue;
      }
    }

    const payload = prepared.value.job.payloadSnapshot;
    const canFallback =
      safeForFallback &&
      payload.notificationMode === "all" &&
      prepared.value.link.invitationChannel === "google" &&
      prepared.value.link.invitationDeliveredAt === null;
    if (canFallback) {
      const fallback = await dependencies.repository.enqueueIcsFallback({
        ...leased,
        failedAt: currentTime(),
      });
      if (fallback.outcome === "lease_lost") {
        result.leaseLost += 1;
        continue;
      }
      if (fallback.outcome === "enqueued") result.fallbackEnqueued += 1;
      if ("jobId" in fallback) result.fallbackJobIds.push(fallback.jobId);
    }

    const failedAt = currentTime();
    const mustStop = job.attemptCount >= GOOGLE_CALENDAR_TERMINAL_ATTEMPT;
    const changed = mustStop
      ? await dependencies.repository.terminalGoogleJob({
          ...leased,
          terminalAt: failedAt,
          error: "Google Calendar retry limit reached",
        })
      : await dependencies.repository.retryGoogleJob({
          ...leased,
          nextAttemptAt: new Date(failedAt.getTime() + retryDelayMs(job.attemptCount)),
          failedAt,
          error: safeProviderError(failure),
        });
    if (!changed) result.leaseLost += 1;
    else if (mustStop) result.terminal += 1;
    else result.retried += 1;
  }

  return result;
}
