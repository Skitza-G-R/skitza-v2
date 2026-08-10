import {
  and,
  asc,
  bookingCalendarLinks,
  bookings,
  calendarSyncJobs,
  desc,
  eq,
  googleCalendarConnections,
  gt,
  inArray,
  lte,
  or,
  producers,
  sql,
  type BookingCalendarLink,
  type CalendarSyncJob,
  type CalendarSyncJobPayloadSnapshot,
  type Db,
  type GoogleCalendarReconcileJobPayloadSnapshot,
  type GoogleCalendarSyncJobPayloadSnapshot,
} from "@skitza/db";

import type { CalendarDeliveryRepository } from "./delivery";
import type {
  GoogleCalendarDeliveryJob,
  GoogleCalendarDeliveryRepository,
  GoogleCalendarPreparedLink,
} from "./google-delivery";
import type {
  GoogleCalendarReconciliationErrorCode,
  GoogleCalendarReconciliationJob,
  GoogleCalendarReconciliationRepository,
} from "./google-reconciliation";

function afterExistingTimestamp(requested: Date, existing: Date): Date {
  return new Date(Math.max(requested.getTime(), existing.getTime() + 1));
}

function resolutionTimestamp(requested: Date) {
  return sql<Date>`greatest(${requested}, ${calendarSyncJobs.updatedAt} + interval '1 millisecond')`;
}

function googleDeliveryJob(row: CalendarSyncJob): GoogleCalendarDeliveryJob | null {
  if (
    row.deliveryChannel !== "google" ||
    row.bookingCalendarLinkId === null ||
    (row.operation !== "upsert_google_event" && row.operation !== "delete_google_event") ||
    row.payloadSnapshot.schemaVersion !== 2
  ) {
    return null;
  }
  return {
    id: row.id,
    bookingId: row.bookingId,
    producerId: row.producerId,
    deliveryChannel: "google",
    bookingCalendarLinkId: row.bookingCalendarLinkId,
    operation: row.operation,
    desiredRevision: row.desiredRevision,
    payloadSnapshot: row.payloadSnapshot,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function googleReconciliationJob(row: CalendarSyncJob): GoogleCalendarReconciliationJob | null {
  if (
    row.deliveryChannel !== "google" ||
    row.bookingCalendarLinkId === null ||
    row.operation !== "reconcile_google_event" ||
    row.payloadSnapshot.schemaVersion !== 3
  ) {
    return null;
  }
  return {
    id: row.id,
    bookingId: row.bookingId,
    producerId: row.producerId,
    bookingCalendarLinkId: row.bookingCalendarLinkId,
    desiredRevision: row.desiredRevision,
    payloadSnapshot: row.payloadSnapshot,
    attemptCount: row.attemptCount,
  };
}

function preparedLink(row: BookingCalendarLink): GoogleCalendarPreparedLink {
  return {
    id: row.id,
    producerId: row.producerId,
    connectionId: row.connectionId,
    accountVersion: row.accountVersion,
    destinationSelectionId: row.destinationSelectionId,
    destinationCalendarIdCiphertext: row.destinationCalendarIdCiphertext,
    destinationCalendarIdIv: row.destinationCalendarIdIv,
    destinationCalendarIdAuthTag: row.destinationCalendarIdAuthTag,
    destinationCalendarIdKeyVersion: row.destinationCalendarIdKeyVersion,
    providerEventId: row.providerEventId,
    providerEventEtag: row.providerEventEtag,
    providerState: row.providerState,
    desiredRevision: row.desiredRevision,
    lastGoogleRevision: row.lastGoogleRevision,
    invitationRevision: row.invitationRevision,
    invitationChannel: row.invitationChannel,
    invitationReservedAt: row.invitationReservedAt,
    invitationAttemptedAt: row.invitationAttemptedAt,
    invitationDeliveredAt: row.invitationDeliveredAt,
  };
}

type FailedGoogleReconciliationInput = Readonly<{
  jobId: string;
  producerId: string;
  linkId: string;
  leaseToken: string;
  errorCode: GoogleCalendarReconciliationErrorCode;
}> &
  (
    | Readonly<{ terminal: false; failedAt: Date; nextAttemptAt: Date }>
    | Readonly<{ terminal: true; terminalAt: Date }>
  );

async function resolveFailedGoogleReconciliation(
  db: Db,
  input: FailedGoogleReconciliationInput,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(calendarSyncJobs)
      .where(
        and(
          eq(calendarSyncJobs.id, input.jobId),
          eq(calendarSyncJobs.producerId, input.producerId),
          eq(calendarSyncJobs.bookingCalendarLinkId, input.linkId),
          eq(calendarSyncJobs.operation, "reconcile_google_event"),
          eq(calendarSyncJobs.status, "processing"),
          eq(calendarSyncJobs.leaseToken, input.leaseToken),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return false;
    const [link] = await tx
      .select()
      .from(bookingCalendarLinks)
      .where(
        and(
          eq(bookingCalendarLinks.id, input.linkId),
          eq(bookingCalendarLinks.producerId, input.producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!link) return false;
    const requestedAt = input.terminal ? input.terminalAt : input.failedAt;
    const occurredAt = new Date(
      Math.max(requestedAt.getTime(), job.updatedAt.getTime() + 1, link.updatedAt.getTime() + 1),
    );
    if (link.desiredRevision !== job.desiredRevision || link.currentBookingId !== job.bookingId) {
      const [superseded] = await tx
        .update(calendarSyncJobs)
        .set({
          status: "completed",
          nextAttemptAt: null,
          leaseToken: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          providerMessageId: "superseded",
          completedAt: occurredAt,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(calendarSyncJobs.id, job.id),
            eq(calendarSyncJobs.producerId, job.producerId),
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning({ id: calendarSyncJobs.id });
      return Boolean(superseded);
    }

    const preserveInboundState = link.syncState === "missing" || link.syncState === "conflict";
    if (!preserveInboundState) {
      const syncFactsChanged =
        link.syncState !== "not_synced" || link.lastSyncErrorCode !== input.errorCode;
      await tx
        .update(bookingCalendarLinks)
        .set({
          syncState: "not_synced",
          syncStateChangedAt: syncFactsChanged ? occurredAt : link.syncStateChangedAt,
          lastSyncErrorCode: input.errorCode,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(bookingCalendarLinks.id, link.id),
            eq(bookingCalendarLinks.producerId, link.producerId),
            eq(bookingCalendarLinks.currentBookingId, job.bookingId),
            eq(bookingCalendarLinks.desiredRevision, job.desiredRevision),
          ),
        );
    }
    const [resolved] = await tx
      .update(calendarSyncJobs)
      .set(
        input.terminal
          ? {
              status: "terminal",
              nextAttemptAt: null,
              leaseToken: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
              terminalAt: occurredAt,
              terminalError: input.errorCode,
              updatedAt: occurredAt,
            }
          : {
              status: "pending",
              nextAttemptAt: input.nextAttemptAt,
              leaseToken: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
              lastError: input.errorCode,
              updatedAt: occurredAt,
            },
      )
      .where(
        and(
          eq(calendarSyncJobs.id, job.id),
          eq(calendarSyncJobs.producerId, job.producerId),
          eq(calendarSyncJobs.status, "processing"),
          eq(calendarSyncJobs.leaseToken, input.leaseToken),
        ),
      )
      .returning({ id: calendarSyncJobs.id });
    return Boolean(resolved);
  });
}

type FailedGoogleDeliveryInput = Readonly<{
  jobId: string;
  producerId: string;
  leaseToken: string;
  error: string;
}> &
  (
    | Readonly<{ terminal: false; failedAt: Date; nextAttemptAt: Date }>
    | Readonly<{ terminal: true; terminalAt: Date }>
  );

async function resolveFailedGoogleDelivery(
  db: Db,
  input: FailedGoogleDeliveryInput,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(calendarSyncJobs)
      .where(
        and(
          eq(calendarSyncJobs.id, input.jobId),
          eq(calendarSyncJobs.producerId, input.producerId),
          eq(calendarSyncJobs.deliveryChannel, "google"),
          inArray(calendarSyncJobs.operation, ["upsert_google_event", "delete_google_event"]),
          eq(calendarSyncJobs.status, "processing"),
          eq(calendarSyncJobs.leaseToken, input.leaseToken),
        ),
      )
      .limit(1)
      .for("update");
    if (!job?.bookingCalendarLinkId) return false;

    const [link] = await tx
      .select()
      .from(bookingCalendarLinks)
      .where(
        and(
          eq(bookingCalendarLinks.id, job.bookingCalendarLinkId),
          eq(bookingCalendarLinks.producerId, input.producerId),
          eq(bookingCalendarLinks.desiredRevision, job.desiredRevision),
        ),
      )
      .limit(1)
      .for("update");
    if (!link) return false;

    const requestedAt = input.terminal ? input.terminalAt : input.failedAt;
    const occurredAt = new Date(
      Math.max(requestedAt.getTime(), job.updatedAt.getTime() + 1, link.updatedAt.getTime() + 1),
    );
    const preserveInboundState = link.syncState === "missing" || link.syncState === "conflict";
    const nextSyncState = input.terminal ? "not_synced" : "pending";
    const nextSyncErrorCode = input.terminal ? "reconciliation_failed" : null;
    if (!preserveInboundState) {
      const syncFactsChanged =
        link.syncState !== nextSyncState || link.lastSyncErrorCode !== nextSyncErrorCode;
      await tx
        .update(bookingCalendarLinks)
        .set({
          syncState: nextSyncState,
          syncStateChangedAt: syncFactsChanged ? occurredAt : link.syncStateChangedAt,
          lastSyncErrorCode: nextSyncErrorCode,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(bookingCalendarLinks.id, link.id),
            eq(bookingCalendarLinks.producerId, link.producerId),
            eq(bookingCalendarLinks.desiredRevision, job.desiredRevision),
          ),
        );
    }

    const [resolved] = await tx
      .update(calendarSyncJobs)
      .set(
        input.terminal
          ? {
              status: "terminal",
              nextAttemptAt: null,
              leaseToken: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
              terminalAt: occurredAt,
              terminalError: input.error.slice(0, 4_000),
              updatedAt: occurredAt,
            }
          : {
              status: "pending",
              nextAttemptAt: input.nextAttemptAt,
              leaseToken: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
              lastError: input.error.slice(0, 4_000),
              updatedAt: occurredAt,
            },
      )
      .where(
        and(
          eq(calendarSyncJobs.id, job.id),
          eq(calendarSyncJobs.producerId, job.producerId),
          eq(calendarSyncJobs.status, "processing"),
          eq(calendarSyncJobs.leaseToken, input.leaseToken),
        ),
      )
      .returning({ id: calendarSyncJobs.id });
    return Boolean(resolved);
  });
}

export function calendarDeliveryRepository(
  db: Db,
): CalendarDeliveryRepository &
  GoogleCalendarDeliveryRepository &
  GoogleCalendarReconciliationRepository {
  return {
    claimDueJobs: (input) =>
      db.transaction(async (tx) => {
        const due = or(
          and(
            eq(calendarSyncJobs.status, "pending"),
            lte(calendarSyncJobs.nextAttemptAt, input.now),
          ),
          and(
            eq(calendarSyncJobs.status, "processing"),
            lte(calendarSyncJobs.leaseExpiresAt, input.now),
          ),
        );
        const candidates = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              due,
              eq(calendarSyncJobs.deliveryChannel, input.deliveryChannel),
              input.jobId ? eq(calendarSyncJobs.id, input.jobId) : undefined,
            ),
          )
          .orderBy(asc(calendarSyncJobs.createdAt), asc(calendarSyncJobs.id))
          .limit(input.limit)
          .for("update", { skipLocked: true });

        const claimed: CalendarSyncJob[] = [];
        for (const candidate of candidates) {
          const claimedAt = afterExistingTimestamp(input.now, candidate.updatedAt);
          const [row] = await tx
            .update(calendarSyncJobs)
            .set({
              status: "processing",
              attemptCount: sql`${calendarSyncJobs.attemptCount} + 1`,
              nextAttemptAt: null,
              leaseToken: input.leaseToken,
              leaseAcquiredAt: claimedAt,
              leaseExpiresAt: new Date(claimedAt.getTime() + input.leaseDurationMs),
              firstAttemptAt: candidate.firstAttemptAt ?? claimedAt,
              lastAttemptAt: claimedAt,
              providerDedupeExpiresAt:
                candidate.providerDedupeExpiresAt ??
                new Date(claimedAt.getTime() + input.providerDedupeWindowMs),
              updatedAt: claimedAt,
            })
            .where(
              and(
                eq(calendarSyncJobs.id, candidate.id),
                eq(calendarSyncJobs.producerId, candidate.producerId),
              ),
            )
            .returning();
          if (row) claimed.push(row);
        }
        return claimed;
      }),

    completeJob: (input) =>
      db.transaction(async (tx) => {
        const occurredAt = resolutionTimestamp(input.completedAt);
        const rows = await tx
          .update(calendarSyncJobs)
          .set({
            status: "completed",
            nextAttemptAt: null,
            leaseToken: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            providerMessageId: input.providerMessageId,
            completedAt: occurredAt,
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
              eq(calendarSyncJobs.deliveryChannel, "ics"),
              input.bookingCalendarLinkId === null
                ? sql`${calendarSyncJobs.bookingCalendarLinkId} IS NULL`
                : eq(calendarSyncJobs.bookingCalendarLinkId, input.bookingCalendarLinkId),
              eq(calendarSyncJobs.desiredRevision, input.desiredRevision),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .returning({ id: calendarSyncJobs.id });
        if (rows.length !== 1) return false;

        if (input.bookingCalendarLinkId !== null) {
          const deliveredAt = sql<Date>`greatest(
            ${input.completedAt},
            ${bookingCalendarLinks.invitationReservedAt},
            ${bookingCalendarLinks.updatedAt} + interval '1 millisecond'
          )`;
          const linked = await tx
            .update(bookingCalendarLinks)
            .set({ invitationDeliveredAt: deliveredAt, updatedAt: deliveredAt })
            .where(
              and(
                eq(bookingCalendarLinks.id, input.bookingCalendarLinkId),
                eq(bookingCalendarLinks.producerId, input.producerId),
                eq(bookingCalendarLinks.invitationRevision, input.desiredRevision),
                eq(bookingCalendarLinks.invitationChannel, "ics"),
              ),
            )
            .returning({ id: bookingCalendarLinks.id });
          if (linked.length !== 1) throw new Error("Calendar fallback link changed");
        }
        return true;
      }),

    retryJob: async (input) => {
      const occurredAt = resolutionTimestamp(input.failedAt);
      const rows = await db
        .update(calendarSyncJobs)
        .set({
          status: "pending",
          nextAttemptAt: input.nextAttemptAt,
          leaseToken: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          lastError: input.error.slice(0, 4_000),
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(calendarSyncJobs.id, input.jobId),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning({ id: calendarSyncJobs.id });
      return rows.length === 1;
    },

    terminalJob: async (input) => {
      const occurredAt = resolutionTimestamp(input.terminalAt);
      const rows = await db
        .update(calendarSyncJobs)
        .set({
          status: "terminal",
          nextAttemptAt: null,
          leaseToken: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          terminalAt: occurredAt,
          terminalError: input.error.slice(0, 4_000),
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(calendarSyncJobs.id, input.jobId),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning({ id: calendarSyncJobs.id });
      return rows.length === 1;
    },

    claimDueGoogleJobs: (input) =>
      db.transaction(async (tx) => {
        const due = or(
          and(
            eq(calendarSyncJobs.status, "pending"),
            lte(calendarSyncJobs.nextAttemptAt, input.now),
          ),
          and(
            eq(calendarSyncJobs.status, "processing"),
            lte(calendarSyncJobs.leaseExpiresAt, input.now),
          ),
        );
        const candidates = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              due,
              eq(calendarSyncJobs.deliveryChannel, "google"),
              inArray(calendarSyncJobs.operation, ["upsert_google_event", "delete_google_event"]),
              input.jobId ? eq(calendarSyncJobs.id, input.jobId) : undefined,
            ),
          )
          .orderBy(asc(calendarSyncJobs.createdAt), asc(calendarSyncJobs.id))
          .limit(input.limit)
          .for("update", { skipLocked: true });

        const claimed: GoogleCalendarDeliveryJob[] = [];
        for (const candidate of candidates) {
          const claimedAt = afterExistingTimestamp(input.now, candidate.updatedAt);
          const [row] = await tx
            .update(calendarSyncJobs)
            .set({
              status: "processing",
              attemptCount: sql`${calendarSyncJobs.attemptCount} + 1`,
              nextAttemptAt: null,
              leaseToken: input.leaseToken,
              leaseAcquiredAt: claimedAt,
              leaseExpiresAt: new Date(claimedAt.getTime() + input.leaseDurationMs),
              firstAttemptAt: candidate.firstAttemptAt ?? claimedAt,
              lastAttemptAt: claimedAt,
              // Google retries use a stable event ID and are not limited by
              // Resend's 24-hour idempotency window.
              providerDedupeExpiresAt: null,
              updatedAt: claimedAt,
            })
            .where(
              and(
                eq(calendarSyncJobs.id, candidate.id),
                eq(calendarSyncJobs.producerId, candidate.producerId),
                eq(calendarSyncJobs.deliveryChannel, "google"),
              ),
            )
            .returning();
          if (!row) continue;
          const mapped = googleDeliveryJob(row);
          if (mapped) claimed.push(mapped);
        }
        return claimed;
      }),

    prepareGoogleJob: (input) =>
      db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
              eq(calendarSyncJobs.deliveryChannel, "google"),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .limit(1)
          .for("update");
        if (!job) return { outcome: "lease_lost" as const };
        const mappedJob = googleDeliveryJob(job);
        if (!mappedJob) return { outcome: "invalid" as const };

        const [linkRow] = await tx
          .select()
          .from(bookingCalendarLinks)
          .where(
            and(
              eq(bookingCalendarLinks.id, mappedJob.bookingCalendarLinkId),
              eq(bookingCalendarLinks.producerId, mappedJob.producerId),
            ),
          )
          .limit(1)
          .for("update");
        if (!linkRow) return { outcome: "invalid" as const };
        const [producerAttendee] = await tx
          .select({
            email: googleCalendarConnections.googleAccountEmail,
            displayName: producers.displayName,
          })
          .from(googleCalendarConnections)
          .innerJoin(
            producers,
            and(
              eq(producers.id, googleCalendarConnections.producerId),
              eq(producers.id, linkRow.producerId),
            ),
          )
          .where(
            and(
              eq(googleCalendarConnections.id, linkRow.connectionId),
              eq(googleCalendarConnections.producerId, linkRow.producerId),
              eq(googleCalendarConnections.accountVersion, linkRow.accountVersion),
            ),
          )
          .limit(1);
        if (!producerAttendee) return { outcome: "invalid" as const };
        const payload = mappedJob.payloadSnapshot;
        const validIntent =
          payload.sequence === mappedJob.desiredRevision &&
          payload.privateProperties.skitzaLink === linkRow.id &&
          payload.privateProperties.skitzaRevision === String(mappedJob.desiredRevision) &&
          ((mappedJob.operation === "upsert_google_event" && payload.action === "upsert") ||
            (mappedJob.operation === "delete_google_event" && payload.action === "delete"));
        if (!validIntent || mappedJob.desiredRevision > linkRow.desiredRevision) {
          return { outcome: "invalid" as const };
        }
        if (
          mappedJob.desiredRevision < linkRow.desiredRevision ||
          mappedJob.desiredRevision < linkRow.invitationRevision
        ) {
          return { outcome: "superseded" as const };
        }

        let link = linkRow;
        if (
          payload.notificationMode === "all" &&
          linkRow.invitationRevision < mappedJob.desiredRevision
        ) {
          const channel = linkRow.invitationChannel === "ics" ? "ics" : "google";
          const reservedAt = afterExistingTimestamp(input.preparedAt, linkRow.updatedAt);
          const [reserved] = await tx
            .update(bookingCalendarLinks)
            .set({
              invitationRevision: mappedJob.desiredRevision,
              invitationChannel: channel,
              invitationReservedAt: reservedAt,
              invitationAttemptedAt: null,
              invitationDeliveredAt: null,
              updatedAt: reservedAt,
            })
            .where(
              and(
                eq(bookingCalendarLinks.id, linkRow.id),
                eq(bookingCalendarLinks.producerId, linkRow.producerId),
                eq(bookingCalendarLinks.desiredRevision, mappedJob.desiredRevision),
                eq(bookingCalendarLinks.invitationRevision, linkRow.invitationRevision),
              ),
            )
            .returning();
          if (!reserved) return { outcome: "lease_lost" as const };
          link = reserved;
        }
        if (
          payload.notificationMode === "all" &&
          (link.invitationRevision !== mappedJob.desiredRevision ||
            link.invitationChannel === null ||
            link.invitationReservedAt === null)
        ) {
          return { outcome: "invalid" as const };
        }

        const [previous] =
          link.lastGoogleRevision > 0
            ? await tx
                .select({ payloadSnapshot: calendarSyncJobs.payloadSnapshot })
                .from(calendarSyncJobs)
                .where(
                  and(
                    eq(calendarSyncJobs.bookingCalendarLinkId, link.id),
                    eq(calendarSyncJobs.producerId, link.producerId),
                    eq(calendarSyncJobs.deliveryChannel, "google"),
                    eq(calendarSyncJobs.operation, "upsert_google_event"),
                    eq(calendarSyncJobs.status, "completed"),
                    eq(calendarSyncJobs.desiredRevision, link.lastGoogleRevision),
                  ),
                )
                .orderBy(desc(calendarSyncJobs.updatedAt))
                .limit(1)
            : [];
        const previousPayload = previous?.payloadSnapshot;
        const lastGoogleEventKind =
          previousPayload?.schemaVersion === 2 && previousPayload.action === "upsert"
            ? previousPayload.eventKind
            : null;
        return {
          outcome: "ready" as const,
          value: {
            job: mappedJob,
            link: preparedLink(link),
            producerAttendee: {
              email: producerAttendee.email,
              displayName: producerAttendee.displayName?.trim() || producerAttendee.email,
            },
            lastGoogleEventKind,
          },
        };
      }),

    completeSupersededGoogleJob: async (input) => {
      const occurredAt = resolutionTimestamp(input.completedAt);
      const rows = await db
        .update(calendarSyncJobs)
        .set({
          status: "completed",
          nextAttemptAt: null,
          leaseToken: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          providerMessageId: "superseded",
          completedAt: occurredAt,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(calendarSyncJobs.id, input.jobId),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.deliveryChannel, "google"),
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning({ id: calendarSyncJobs.id });
      return rows.length === 1;
    },

    markGoogleNotificationAttempt: (input) =>
      db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
              eq(calendarSyncJobs.deliveryChannel, "google"),
              eq(calendarSyncJobs.bookingCalendarLinkId, input.linkId),
              eq(calendarSyncJobs.desiredRevision, input.desiredRevision),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .limit(1)
          .for("update");
        const mapped = job ? googleDeliveryJob(job) : null;
        if (!mapped || mapped.payloadSnapshot.notificationMode !== "all") return false;

        const [link] = await tx
          .select()
          .from(bookingCalendarLinks)
          .where(
            and(
              eq(bookingCalendarLinks.id, input.linkId),
              eq(bookingCalendarLinks.producerId, input.producerId),
              eq(bookingCalendarLinks.desiredRevision, input.desiredRevision),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !link ||
          link.invitationRevision !== input.desiredRevision ||
          link.invitationChannel !== "google" ||
          link.invitationReservedAt === null ||
          link.invitationDeliveredAt !== null
        ) {
          return false;
        }
        if (link.invitationAttemptedAt !== null) return true;

        const attemptedAt = afterExistingTimestamp(input.attemptedAt, link.updatedAt);
        const [marked] = await tx
          .update(bookingCalendarLinks)
          .set({ invitationAttemptedAt: attemptedAt, updatedAt: attemptedAt })
          .where(
            and(
              eq(bookingCalendarLinks.id, link.id),
              eq(bookingCalendarLinks.producerId, link.producerId),
              eq(bookingCalendarLinks.desiredRevision, input.desiredRevision),
              eq(bookingCalendarLinks.invitationChannel, "google"),
              sql`${bookingCalendarLinks.invitationAttemptedAt} IS NULL`,
            ),
          )
          .returning({ id: bookingCalendarLinks.id });
        return Boolean(marked);
      }),

    completeGoogleJob: (input) =>
      db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
              eq(calendarSyncJobs.deliveryChannel, "google"),
              eq(calendarSyncJobs.bookingCalendarLinkId, input.linkId),
              eq(calendarSyncJobs.desiredRevision, input.desiredRevision),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .limit(1)
          .for("update");
        if (!job) return false;
        const [link] = await tx
          .select()
          .from(bookingCalendarLinks)
          .where(
            and(
              eq(bookingCalendarLinks.id, input.linkId),
              eq(bookingCalendarLinks.producerId, input.producerId),
              eq(bookingCalendarLinks.desiredRevision, input.desiredRevision),
            ),
          )
          .limit(1)
          .for("update");
        if (!link) return false;
        if (
          (input.providerState === "active" && !input.providerEventEtag) ||
          (input.providerState === "deleted" && input.providerEventEtag !== null) ||
          (input.notificationDelivered &&
            (link.invitationRevision !== input.desiredRevision ||
              link.invitationChannel !== "google" ||
              link.invitationReservedAt === null ||
              link.invitationAttemptedAt === null))
        ) {
          return false;
        }
        const occurredAt = new Date(
          Math.max(
            input.completedAt.getTime(),
            job.updatedAt.getTime() + 1,
            link.updatedAt.getTime() + 1,
          ),
        );
        const deliveredAt = input.notificationDelivered
          ? new Date(
              Math.max(
                occurredAt.getTime(),
                link.invitationReservedAt?.getTime() ?? occurredAt.getTime(),
              ),
            )
          : link.invitationDeliveredAt;
        await tx
          .update(bookingCalendarLinks)
          .set({
            providerState: input.providerState,
            providerEventEtag: input.providerEventEtag,
            syncState: "synced",
            syncStateChangedAt: link.syncState === "synced" ? link.syncStateChangedAt : occurredAt,
            lastSyncErrorCode: null,
            lastGoogleRevision: input.desiredRevision,
            lastGoogleSyncedAt: occurredAt,
            ...(input.notificationDelivered ? { invitationDeliveredAt: deliveredAt } : {}),
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(bookingCalendarLinks.id, link.id),
              eq(bookingCalendarLinks.producerId, link.producerId),
              eq(bookingCalendarLinks.desiredRevision, input.desiredRevision),
            ),
          );
        const completed = await tx
          .update(calendarSyncJobs)
          .set({
            status: "completed",
            nextAttemptAt: null,
            leaseToken: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            providerMessageId: link.providerEventId,
            completedAt: occurredAt,
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(calendarSyncJobs.id, job.id),
              eq(calendarSyncJobs.producerId, job.producerId),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .returning({ id: calendarSyncJobs.id });
        if (completed.length !== 1) throw new Error("Google Calendar lease changed");
        return true;
      }),

    enqueueIcsFallback: (input) =>
      db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
              eq(calendarSyncJobs.deliveryChannel, "google"),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .limit(1)
          .for("update");
        if (!job) return { outcome: "lease_lost" as const };
        const mapped = googleDeliveryJob(job);
        if (!mapped) return { outcome: "not_safe" as const };
        const payload = mapped.payloadSnapshot;
        if (payload.notificationMode !== "all") return { outcome: "not_safe" as const };

        const [link] = await tx
          .select()
          .from(bookingCalendarLinks)
          .where(
            and(
              eq(bookingCalendarLinks.id, mapped.bookingCalendarLinkId),
              eq(bookingCalendarLinks.producerId, mapped.producerId),
              eq(bookingCalendarLinks.desiredRevision, mapped.desiredRevision),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !link ||
          link.invitationRevision !== mapped.desiredRevision ||
          link.invitationReservedAt === null ||
          link.invitationDeliveredAt !== null ||
          (link.invitationChannel !== "google" && link.invitationChannel !== "ics")
        ) {
          return { outcome: "not_safe" as const };
        }

        let source: Extract<GoogleCalendarSyncJobPayloadSnapshot, { action: "upsert" }> | null =
          payload.action === "upsert" && payload.eventKind === "confirmed" ? payload : null;
        if (!source) {
          const candidates = await tx
            .select({ payloadSnapshot: calendarSyncJobs.payloadSnapshot })
            .from(calendarSyncJobs)
            .where(
              and(
                eq(calendarSyncJobs.bookingCalendarLinkId, link.id),
                eq(calendarSyncJobs.producerId, link.producerId),
                eq(calendarSyncJobs.deliveryChannel, "google"),
                eq(calendarSyncJobs.operation, "upsert_google_event"),
                sql`${calendarSyncJobs.desiredRevision} < ${mapped.desiredRevision}`,
              ),
            )
            .orderBy(desc(calendarSyncJobs.desiredRevision), desc(calendarSyncJobs.createdAt))
            .limit(10);
          for (const candidate of candidates) {
            const snapshot = candidate.payloadSnapshot;
            if (
              snapshot.schemaVersion === 2 &&
              snapshot.action === "upsert" &&
              snapshot.eventKind === "confirmed"
            ) {
              source = snapshot;
              break;
            }
          }
        }
        if (!source?.attendee || !source.artistSafeUrl) {
          return { outcome: "not_safe" as const };
        }
        const [producer] = await tx
          .select({ email: producers.email, displayName: producers.displayName })
          .from(producers)
          .where(eq(producers.id, mapped.producerId))
          .limit(1);
        if (!producer?.email) return { outcome: "not_safe" as const };

        const fallbackPayload: CalendarSyncJobPayloadSnapshot = {
          schemaVersion: 1,
          method: payload.action === "delete" ? "CANCEL" : "REQUEST",
          uid: `booking-${link.allowanceUseId}@skitza.app`,
          sequence: mapped.desiredRevision,
          dtstampUtc: input.failedAt.toISOString(),
          startsAtUtc: source.startsAtUtc,
          endsAtUtc: source.endsAtUtc,
          summary: source.summary,
          description: source.artistSafeUrl,
          organizer: {
            name: producer.displayName?.trim() || producer.email,
            email: producer.email,
          },
          attendee: source.attendee,
        };
        const idempotencyKey = `calendar:send_ics:fallback:${link.id}:${String(mapped.desiredRevision)}`;
        const [existing] = await tx
          .select({
            id: calendarSyncJobs.id,
            bookingCalendarLinkId: calendarSyncJobs.bookingCalendarLinkId,
            status: calendarSyncJobs.status,
          })
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.bookingId, mapped.bookingId),
              eq(calendarSyncJobs.operation, "send_ics"),
              eq(calendarSyncJobs.desiredRevision, mapped.desiredRevision),
            ),
          )
          .limit(1);
        if (
          existing &&
          (existing.bookingCalendarLinkId !== link.id ||
            (existing.status !== "pending" && existing.status !== "processing"))
        ) {
          return { outcome: "not_safe" as const };
        }

        const fallbackAt = afterExistingTimestamp(input.failedAt, link.updatedAt);
        let fallback:
          | Readonly<{ outcome: "enqueued"; jobId: string }>
          | Readonly<{ outcome: "already_enqueued"; jobId: string }>;
        if (existing) {
          fallback = { outcome: "already_enqueued", jobId: existing.id };
        } else {
          const [inserted] = await tx
            .insert(calendarSyncJobs)
            .values({
              bookingId: mapped.bookingId,
              producerId: mapped.producerId,
              deliveryChannel: "ics",
              bookingCalendarLinkId: link.id,
              operation: "send_ics",
              status: "pending",
              desiredRevision: mapped.desiredRevision,
              idempotencyKey,
              payloadSnapshot: fallbackPayload,
              nextAttemptAt: fallbackAt,
              createdAt: fallbackAt,
              updatedAt: fallbackAt,
            })
            .onConflictDoNothing()
            .returning({ id: calendarSyncJobs.id });
          if (inserted) {
            fallback = { outcome: "enqueued", jobId: inserted.id };
          } else {
            const [raced] = await tx
              .select({
                id: calendarSyncJobs.id,
                bookingCalendarLinkId: calendarSyncJobs.bookingCalendarLinkId,
                status: calendarSyncJobs.status,
              })
              .from(calendarSyncJobs)
              .where(eq(calendarSyncJobs.idempotencyKey, idempotencyKey))
              .limit(1);
            if (
              !raced ||
              raced.bookingCalendarLinkId !== link.id ||
              (raced.status !== "pending" && raced.status !== "processing")
            ) {
              return { outcome: "not_safe" as const };
            }
            fallback = { outcome: "already_enqueued", jobId: raced.id };
          }
        }

        if (link.invitationChannel !== "ics") {
          const [switched] = await tx
            .update(bookingCalendarLinks)
            .set({ invitationChannel: "ics", updatedAt: fallbackAt })
            .where(
              and(
                eq(bookingCalendarLinks.id, link.id),
                eq(bookingCalendarLinks.producerId, link.producerId),
                eq(bookingCalendarLinks.invitationRevision, mapped.desiredRevision),
                eq(bookingCalendarLinks.invitationChannel, "google"),
              ),
            )
            .returning({ id: bookingCalendarLinks.id });
          if (!switched) throw new Error("Calendar fallback link changed");
        }
        return fallback;
      }),

    retryGoogleJob: (input) =>
      resolveFailedGoogleDelivery(db, {
        ...input,
        terminal: false,
      }),

    terminalGoogleJob: (input) =>
      resolveFailedGoogleDelivery(db, {
        ...input,
        terminal: true,
      }),

    claimDueGoogleReconciliationJobs: (input) =>
      db.transaction(async (tx) => {
        const due = or(
          and(
            eq(calendarSyncJobs.status, "pending"),
            lte(calendarSyncJobs.nextAttemptAt, input.now),
          ),
          and(
            eq(calendarSyncJobs.status, "processing"),
            lte(calendarSyncJobs.leaseExpiresAt, input.now),
          ),
        );
        const candidates = await tx
          .select()
          .from(calendarSyncJobs)
          .where(and(due, eq(calendarSyncJobs.operation, "reconcile_google_event")))
          .orderBy(asc(calendarSyncJobs.createdAt), asc(calendarSyncJobs.id))
          .limit(input.limit)
          .for("update", { skipLocked: true });

        const claimed: GoogleCalendarReconciliationJob[] = [];
        for (const candidate of candidates) {
          const claimedAt = afterExistingTimestamp(input.now, candidate.updatedAt);
          const [row] = await tx
            .update(calendarSyncJobs)
            .set({
              status: "processing",
              attemptCount: sql`${calendarSyncJobs.attemptCount} + 1`,
              nextAttemptAt: null,
              leaseToken: input.leaseToken,
              leaseAcquiredAt: claimedAt,
              leaseExpiresAt: new Date(claimedAt.getTime() + input.leaseDurationMs),
              firstAttemptAt: candidate.firstAttemptAt ?? claimedAt,
              lastAttemptAt: claimedAt,
              updatedAt: claimedAt,
            })
            .where(
              and(
                eq(calendarSyncJobs.id, candidate.id),
                eq(calendarSyncJobs.producerId, candidate.producerId),
                eq(calendarSyncJobs.operation, "reconcile_google_event"),
              ),
            )
            .returning();
          if (!row) continue;
          const mapped = googleReconciliationJob(row);
          if (mapped) claimed.push(mapped);
        }
        return claimed;
      }),

    prepareGoogleReconciliationJob: (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
              eq(calendarSyncJobs.operation, "reconcile_google_event"),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .limit(1)
          .for("update");
        if (!row) return { outcome: "lease_lost" as const };
        const job = googleReconciliationJob(row);
        if (!job) return { outcome: "invalid" as const };

        const [link] = await tx
          .select()
          .from(bookingCalendarLinks)
          .where(
            and(
              eq(bookingCalendarLinks.id, job.bookingCalendarLinkId),
              eq(bookingCalendarLinks.producerId, job.producerId),
            ),
          )
          .limit(1);
        if (!link || job.desiredRevision > link.desiredRevision) {
          return { outcome: "invalid" as const };
        }
        if (job.desiredRevision < link.desiredRevision || job.bookingId !== link.currentBookingId) {
          return { outcome: "superseded" as const };
        }
        if (link.providerState !== "active") {
          return { outcome: "superseded" as const };
        }
        const [booking] = await tx
          .select({ artistEmail: bookings.artistEmail })
          .from(bookings)
          .where(
            and(
              eq(bookings.id, link.currentBookingId),
              eq(bookings.producerId, link.producerId),
              eq(bookings.allowanceUseId, link.allowanceUseId),
            ),
          )
          .limit(1);
        if (!booking) return { outcome: "invalid" as const };
        return {
          outcome: "ready" as const,
          value: {
            job,
            link: preparedLink(link),
            currentBookingId: link.currentBookingId,
            artistEmail: booking.artistEmail,
          },
        };
      }),

    completeSupersededGoogleReconciliationJob: async (input) => {
      const occurredAt = resolutionTimestamp(input.completedAt);
      const rows = await db
        .update(calendarSyncJobs)
        .set({
          status: "completed",
          nextAttemptAt: null,
          leaseToken: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          providerMessageId: "superseded",
          completedAt: occurredAt,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(calendarSyncJobs.id, input.jobId),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.operation, "reconcile_google_event"),
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning({ id: calendarSyncJobs.id });
      return rows.length === 1;
    },

    completeDisconnectedGoogleReconciliationJob: (input) =>
      db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(calendarSyncJobs)
          .where(
            and(
              eq(calendarSyncJobs.id, input.jobId),
              eq(calendarSyncJobs.producerId, input.producerId),
              eq(calendarSyncJobs.bookingCalendarLinkId, input.linkId),
              eq(calendarSyncJobs.operation, "reconcile_google_event"),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .limit(1)
          .for("update");
        if (!job) return false;
        const [link] = await tx
          .select()
          .from(bookingCalendarLinks)
          .where(
            and(
              eq(bookingCalendarLinks.id, input.linkId),
              eq(bookingCalendarLinks.producerId, input.producerId),
            ),
          )
          .limit(1)
          .for("update");
        if (!link) return false;
        const occurredAt = new Date(
          Math.max(
            input.completedAt.getTime(),
            job.updatedAt.getTime() + 1,
            link.updatedAt.getTime() + 1,
          ),
        );
        await tx
          .update(bookingCalendarLinks)
          .set({
            syncState: "disconnected",
            syncStateChangedAt:
              link.syncState === "disconnected" ? link.syncStateChangedAt : occurredAt,
            lastSyncErrorCode: null,
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(bookingCalendarLinks.id, link.id),
              eq(bookingCalendarLinks.producerId, link.producerId),
            ),
          );
        const completed = await tx
          .update(calendarSyncJobs)
          .set({
            status: "completed",
            nextAttemptAt: null,
            leaseToken: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            providerMessageId: input.reconnectRequired ? "reconnect_required" : "disconnected",
            completedAt: occurredAt,
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(calendarSyncJobs.id, job.id),
              eq(calendarSyncJobs.producerId, job.producerId),
              eq(calendarSyncJobs.status, "processing"),
              eq(calendarSyncJobs.leaseToken, input.leaseToken),
            ),
          )
          .returning({ id: calendarSyncJobs.id });
        return completed.length === 1;
      }),

    retryGoogleReconciliationJob: (input) =>
      resolveFailedGoogleReconciliation(db, {
        ...input,
        terminal: false,
      }),

    terminalGoogleReconciliationJob: (input) =>
      resolveFailedGoogleReconciliation(db, {
        ...input,
        terminal: true,
      }),

    enqueueGoogleReconciliationRecovery: (input) =>
      db.transaction(async (tx) => {
        const candidates = await tx
          .select({
            bookingId: bookingCalendarLinks.currentBookingId,
            producerId: bookingCalendarLinks.producerId,
            linkId: bookingCalendarLinks.id,
            desiredRevision: bookingCalendarLinks.desiredRevision,
          })
          .from(bookingCalendarLinks)
          .innerJoin(
            bookings,
            and(
              eq(bookings.id, bookingCalendarLinks.currentBookingId),
              eq(bookings.producerId, bookingCalendarLinks.producerId),
              eq(bookings.allowanceUseId, bookingCalendarLinks.allowanceUseId),
            ),
          )
          .innerJoin(
            googleCalendarConnections,
            and(
              eq(googleCalendarConnections.id, bookingCalendarLinks.connectionId),
              eq(googleCalendarConnections.producerId, bookingCalendarLinks.producerId),
              eq(googleCalendarConnections.accountVersion, bookingCalendarLinks.accountVersion),
            ),
          )
          .where(
            and(
              eq(bookingCalendarLinks.providerState, "active"),
              eq(bookings.status, "confirmed"),
              eq(googleCalendarConnections.status, "connected"),
              gt(
                sql`${bookings.startsAt} + (${bookings.durationMin} * interval '1 minute')`,
                input.now,
              ),
            ),
          )
          .orderBy(
            sql`${bookingCalendarLinks.lastInboundReconciledAt} asc nulls first`,
            asc(bookingCalendarLinks.id),
          )
          .limit(input.limit);
        const bucket = Math.floor(input.now.getTime() / (15 * 60 * 1_000));
        let jobsEnqueued = 0;
        for (const candidate of candidates) {
          const payloadSnapshot: GoogleCalendarReconcileJobPayloadSnapshot = {
            schemaVersion: 3,
            action: "reconcile",
            source: "recovery",
            watchId: null,
            messageNumber: null,
          };
          const [inserted] = await tx
            .insert(calendarSyncJobs)
            .values({
              bookingId: candidate.bookingId,
              producerId: candidate.producerId,
              deliveryChannel: "google",
              bookingCalendarLinkId: candidate.linkId,
              googleCalendarWatchId: null,
              webhookMessageNumber: null,
              operation: "reconcile_google_event",
              status: "pending",
              desiredRevision: candidate.desiredRevision,
              idempotencyKey: `google:reconcile:recovery:${candidate.linkId}:b${String(bucket)}`,
              payloadSnapshot,
              nextAttemptAt: input.now,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing()
            .returning({ id: calendarSyncJobs.id });
          if (inserted) jobsEnqueued += 1;
        }
        return { scanned: candidates.length, jobsEnqueued };
      }),
  };
}
