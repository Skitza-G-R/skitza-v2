import { randomUUID } from "node:crypto";

import {
  and,
  availabilityBlackouts,
  availabilityBlocks,
  bookingCalendarLinks,
  bookingChangeRequests,
  bookingTransitionEvents,
  bookings,
  calendarSyncJobs,
  clientContacts,
  desc,
  eq,
  googleCalendarConnections,
  googleCalendarSelections,
  inArray,
  isNull,
  or,
  producers,
  projects,
  purchases,
  purchaseSessionAllowances,
  sql,
  type Booking,
  type BookingCalendarLink,
  type BookingChangeRequest,
  type CalendarSyncJob,
  type Db,
} from "@skitza/db";

import { projectAdvisoryLockKey } from "../project-lifecycle/lock";
import { purchaseLedgerAdvisoryLockKey } from "../purchase-ledger/db";
import {
  SessionBookingDomainError,
  type NewSessionBookingRecord,
  type NewCalendarSyncJobRecord,
  type NewSessionBookingChangeRequestRecord,
  type BookingCalendarLinkRecord,
  type CalendarSyncJobRecord,
  type SessionBookingAtomicScope,
  type SessionBookingContext,
  type SessionBookingChangeRequestRecord,
  type SessionBookingCreateContext,
  type SessionBookingGoogleReconciliationContext,
  type SessionBookingRecord,
  type SessionBookingRepository,
  type SessionBookingTransaction,
  type SessionBookingTransitionEventDraft,
  type StoredSessionBookingTransitionEvent,
} from "./service";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

function bookingRecord(row: Booking): SessionBookingRecord {
  return {
    id: row.id,
    producerId: row.producerId,
    projectId: row.projectId,
    purchaseId: row.purchaseId,
    sessionAllowanceId: row.sessionAllowanceId,
    title: row.title,
    origin: row.origin,
    billingTreatment: row.billingTreatment,
    artistName: row.artistName,
    artistEmail: row.artistEmail,
    startsAt: row.startsAt,
    durationMin: row.durationMin,
    operationKey: row.operationKey,
    operationDigest: row.operationDigest,
    rescheduledFromBookingId: row.rescheduledFromBookingId,
    allowanceUseId: row.allowanceUseId,
    cancellationPolicyHoursSnapshot: row.cancellationPolicyHoursSnapshot,
    cancellationPolicySnapshottedAt: row.cancellationPolicySnapshottedAt,
    cancellationPolicyBackfilled: row.cancellationPolicyBackfilled,
    heldExpiresAt: row.heldExpiresAt,
    heldExpiredAt: row.heldExpiredAt,
    heldExpiryReason: row.heldExpiryReason,
    status: row.status,
    outcome: row.outcome,
    statusChangedAt: row.statusChangedAt,
    outcomeChangedAt: row.outcomeChangedAt,
    calendarRevision: row.calendarRevision,
    artistRsvpStatus: row.artistRsvpStatus,
    artistRsvpRespondedAt: row.artistRsvpRespondedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function changeRequestRecord(row: BookingChangeRequest): SessionBookingChangeRequestRecord {
  return row;
}

function calendarJobRecord(row: CalendarSyncJob): CalendarSyncJobRecord {
  return {
    id: row.id,
    bookingId: row.bookingId,
    producerId: row.producerId,
    deliveryChannel: row.deliveryChannel,
    bookingCalendarLinkId: row.bookingCalendarLinkId,
    operation: row.operation,
    desiredRevision: row.desiredRevision,
    idempotencyKey: row.idempotencyKey,
    payloadSnapshot: row.payloadSnapshot,
    manualRetryCount: row.manualRetryCount,
    lastManualRetryAt: row.lastManualRetryAt,
    lastManualRetryActor: row.lastManualRetryActor,
    lastManualRetryOperationKey: row.lastManualRetryOperationKey,
    lastManualRetryOperationDigest: row.lastManualRetryOperationDigest,
  };
}

function bookingCalendarLinkRecord(row: BookingCalendarLink): BookingCalendarLinkRecord {
  return {
    id: row.id,
    producerId: row.producerId,
    allowanceUseId: row.allowanceUseId,
    currentBookingId: row.currentBookingId,
    connectionId: row.connectionId,
    accountVersion: row.accountVersion,
    desiredRevision: row.desiredRevision,
    providerEventEtag: row.providerEventEtag,
    providerEventUpdatedAt: row.providerEventUpdatedAt,
    providerState: row.providerState,
    syncState: row.syncState,
    syncStateChangedAt: row.syncStateChangedAt,
    lastInboundReconciledAt: row.lastInboundReconciledAt,
    lastSyncErrorCode: row.lastSyncErrorCode,
  };
}

async function contextDetails(
  tx: TransactionDb,
  producerId: string,
): Promise<Pick<SessionBookingCreateContext, "availabilityBlocks" | "blackouts">> {
  const [blocks, blackouts] = await Promise.all([
    tx
      .select({
        weekday: availabilityBlocks.weekday,
        startMin: availabilityBlocks.startMin,
        endMin: availabilityBlocks.endMin,
      })
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.producerId, producerId)),
    tx
      .select({
        startDate: availabilityBlackouts.startDate,
        endDate: availabilityBlackouts.endDate,
      })
      .from(availabilityBlackouts)
      .where(eq(availabilityBlackouts.producerId, producerId)),
  ]);
  return { availabilityBlocks: blocks, blackouts };
}

function createContextFromRow(
  row: {
    producerId: string;
    producerName: string | null;
    producerEmail: string;
    producerClosedAt: Date | null;
    timeZone: string;
    autoConfirmBookings: boolean;
    cancellationPolicyHours: number;
    maxSessionsPerDay: number | null;
    projectId: string;
    projectTitle: string;
    projectLifecycleStatus: SessionBookingCreateContext["project"]["lifecycleStatus"];
    purchaseId: string;
    purchaseLifecycleStatus: SessionBookingCreateContext["purchase"]["lifecycleStatus"];
    purchaseCommercialSnapshot: { productOrOfferName: string } | null;
    allowanceId: string;
    bookingEnabledSnapshot: boolean;
    allowanceKind: "fixed" | "unlimited";
    sessionLimit: number | null;
    durationMin: number;
    locationType: string;
    bufferMinutes: number;
    minLeadHours: number;
    allowanceClosedAt: Date | null;
    artistClerkUserId: string | null;
    artistName: string;
    artistEmail: string;
  },
  details: Pick<SessionBookingCreateContext, "availabilityBlocks" | "blackouts">,
): SessionBookingCreateContext {
  return {
    producer: {
      id: row.producerId,
      name: row.producerName?.trim() || "Skitza producer",
      email: row.producerEmail,
      closedAt: row.producerClosedAt,
      timeZone: row.timeZone,
      autoConfirmBookings: row.autoConfirmBookings,
      cancellationPolicyHours: row.cancellationPolicyHours,
      maxSessionsPerDay: row.maxSessionsPerDay,
    },
    project: {
      id: row.projectId,
      title: row.projectTitle.trim() || "Session",
      lifecycleStatus: row.projectLifecycleStatus,
    },
    purchase: {
      id: row.purchaseId,
      lifecycleStatus: row.purchaseLifecycleStatus,
      defaultSessionTitle:
        row.purchaseCommercialSnapshot?.productOrOfferName.trim() ||
        row.projectTitle.trim() ||
        "Session",
    },
    allowance: {
      id: row.allowanceId,
      purchaseId: row.purchaseId,
      producerId: row.producerId,
      bookingEnabledSnapshot: row.bookingEnabledSnapshot,
      kind: row.allowanceKind,
      sessionLimit: row.sessionLimit,
      durationMin: row.durationMin,
      locationType: row.locationType,
      bufferMinutes: row.bufferMinutes,
      minLeadHours: row.minLeadHours,
      closedAt: row.allowanceClosedAt,
    },
    artist: {
      clerkUserId: row.artistClerkUserId,
      name: row.artistName,
      email: row.artistEmail,
    },
    ...details,
  };
}

function transactionAdapter(tx: TransactionDb): SessionBookingTransaction {
  return {
    loadCreateContext: async (input) => {
      const [row] = await tx
        .select({
          producerId: producers.id,
          producerName: producers.displayName,
          producerEmail: producers.email,
          producerClosedAt: producers.closedAt,
          timeZone: producers.timezone,
          autoConfirmBookings: producers.autoConfirmBookings,
          cancellationPolicyHours: producers.cancellationPolicyHours,
          maxSessionsPerDay: producers.maxSessionsPerDay,
          projectId: projects.id,
          projectTitle: projects.title,
          projectLifecycleStatus: projects.lifecycleStatus,
          purchaseId: purchases.id,
          purchaseLifecycleStatus: purchases.lifecycleStatus,
          purchaseCommercialSnapshot: purchases.commercialSnapshot,
          allowanceId: purchaseSessionAllowances.id,
          bookingEnabledSnapshot: purchaseSessionAllowances.bookingEnabledSnapshot,
          allowanceKind: purchaseSessionAllowances.kind,
          sessionLimit: purchaseSessionAllowances.sessionLimit,
          durationMin: purchaseSessionAllowances.durationMin,
          locationType: purchaseSessionAllowances.locationType,
          bufferMinutes: purchaseSessionAllowances.bufferMinutes,
          minLeadHours: purchaseSessionAllowances.minLeadHours,
          allowanceClosedAt: purchaseSessionAllowances.closedAt,
          artistClerkUserId: clientContacts.clerkUserId,
          artistName: clientContacts.name,
          artistEmail: clientContacts.email,
        })
        .from(purchases)
        .innerJoin(
          projects,
          and(
            eq(projects.id, purchases.projectId),
            eq(projects.producerId, purchases.producerId),
            eq(projects.clientContactId, purchases.clientContactId),
          ),
        )
        .innerJoin(
          purchaseSessionAllowances,
          and(
            eq(purchaseSessionAllowances.id, input.sessionAllowanceId),
            eq(purchaseSessionAllowances.purchaseId, purchases.id),
            eq(purchaseSessionAllowances.producerId, purchases.producerId),
            eq(purchaseSessionAllowances.bookingEnabledSnapshot, true),
          ),
        )
        .innerJoin(
          clientContacts,
          and(
            eq(clientContacts.id, purchases.clientContactId),
            eq(clientContacts.producerId, purchases.producerId),
            eq(clientContacts.clerkUserId, input.actorClerkUserId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .innerJoin(producers, eq(producers.id, purchases.producerId))
        .where(
          and(
            eq(purchases.id, input.purchaseId),
            eq(purchases.projectId, input.projectId),
            eq(purchases.producerId, input.producerId),
          ),
        )
        .limit(1)
        .for("update");
      if (!row) return null;
      return createContextFromRow(row, await contextDetails(tx, row.producerId));
    },

    loadProducerManualCreateContext: async (input) => {
      // This is deliberately separate from the artist loader above. Producer
      // authorization is established by producerProcedure and the tenant id;
      // the selected contact remains an existing producer-owned client even
      // when they have not created a Clerk artist account yet.
      const rows = await tx
        .select({
          producerId: producers.id,
          producerName: producers.displayName,
          producerEmail: producers.email,
          producerClosedAt: producers.closedAt,
          timeZone: producers.timezone,
          autoConfirmBookings: producers.autoConfirmBookings,
          cancellationPolicyHours: producers.cancellationPolicyHours,
          maxSessionsPerDay: producers.maxSessionsPerDay,
          projectId: projects.id,
          projectTitle: projects.title,
          projectLifecycleStatus: projects.lifecycleStatus,
          purchaseId: purchases.id,
          purchaseLifecycleStatus: purchases.lifecycleStatus,
          purchaseCommercialSnapshot: purchases.commercialSnapshot,
          allowanceId: purchaseSessionAllowances.id,
          bookingEnabledSnapshot: purchaseSessionAllowances.bookingEnabledSnapshot,
          allowanceKind: purchaseSessionAllowances.kind,
          sessionLimit: purchaseSessionAllowances.sessionLimit,
          durationMin: purchaseSessionAllowances.durationMin,
          locationType: purchaseSessionAllowances.locationType,
          bufferMinutes: purchaseSessionAllowances.bufferMinutes,
          minLeadHours: purchaseSessionAllowances.minLeadHours,
          allowanceClosedAt: purchaseSessionAllowances.closedAt,
          artistClerkUserId: clientContacts.clerkUserId,
          artistName: clientContacts.name,
          artistEmail: clientContacts.email,
        })
        .from(purchases)
        .innerJoin(
          projects,
          and(
            eq(projects.id, purchases.projectId),
            eq(projects.producerId, purchases.producerId),
            eq(projects.clientContactId, purchases.clientContactId),
          ),
        )
        .innerJoin(
          purchaseSessionAllowances,
          and(
            eq(purchaseSessionAllowances.purchaseId, purchases.id),
            eq(purchaseSessionAllowances.producerId, purchases.producerId),
            eq(purchaseSessionAllowances.bookingEnabledSnapshot, true),
            isNull(purchaseSessionAllowances.closedAt),
          ),
        )
        .innerJoin(
          clientContacts,
          and(
            eq(clientContacts.id, purchases.clientContactId),
            eq(clientContacts.producerId, purchases.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .innerJoin(producers, eq(producers.id, purchases.producerId))
        .where(
          and(
            eq(purchases.producerId, input.producerId),
            eq(purchases.projectId, input.projectId),
            eq(purchases.clientContactId, input.clientContactId),
            eq(purchases.lifecycleStatus, "active"),
            eq(projects.lifecycleStatus, "active"),
          ),
        )
        .for("update");
      if (rows.length > 1) {
        throw new SessionBookingDomainError(
          "INVALID_ALLOWANCE",
          "This project has more than one active session package",
        );
      }
      const row = rows[0];
      if (
        !row ||
        row.purchaseId !== input.purchaseId ||
        row.allowanceId !== input.sessionAllowanceId
      ) {
        return null;
      }
      return createContextFromRow(row, await contextDetails(tx, row.producerId));
    },

    loadBookingContext: async (input) => {
      const [row] = await tx
        .select({
          booking: bookings,
          producerId: producers.id,
          producerName: producers.displayName,
          producerEmail: producers.email,
          producerClosedAt: producers.closedAt,
          timeZone: producers.timezone,
          autoConfirmBookings: producers.autoConfirmBookings,
          cancellationPolicyHours: producers.cancellationPolicyHours,
          maxSessionsPerDay: producers.maxSessionsPerDay,
          projectId: projects.id,
          projectTitle: projects.title,
          projectLifecycleStatus: projects.lifecycleStatus,
          purchaseId: purchases.id,
          purchaseLifecycleStatus: purchases.lifecycleStatus,
          purchaseCommercialSnapshot: purchases.commercialSnapshot,
          allowanceId: purchaseSessionAllowances.id,
          bookingEnabledSnapshot: purchaseSessionAllowances.bookingEnabledSnapshot,
          allowanceKind: purchaseSessionAllowances.kind,
          sessionLimit: purchaseSessionAllowances.sessionLimit,
          durationMin: purchaseSessionAllowances.durationMin,
          locationType: purchaseSessionAllowances.locationType,
          bufferMinutes: purchaseSessionAllowances.bufferMinutes,
          minLeadHours: purchaseSessionAllowances.minLeadHours,
          allowanceClosedAt: purchaseSessionAllowances.closedAt,
          artistClerkUserId: clientContacts.clerkUserId,
          artistName: clientContacts.name,
          artistEmail: clientContacts.email,
        })
        .from(bookings)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
        .innerJoin(
          projects,
          and(
            eq(projects.id, purchases.projectId),
            eq(projects.producerId, purchases.producerId),
            eq(projects.clientContactId, purchases.clientContactId),
          ),
        )
        .innerJoin(
          purchaseSessionAllowances,
          and(
            eq(purchaseSessionAllowances.id, bookings.sessionAllowanceId),
            eq(purchaseSessionAllowances.purchaseId, bookings.purchaseId),
            eq(purchaseSessionAllowances.producerId, bookings.producerId),
          ),
        )
        .innerJoin(
          clientContacts,
          and(
            eq(clientContacts.id, purchases.clientContactId),
            eq(clientContacts.producerId, purchases.producerId),
            input.actorClerkUserId
              ? eq(clientContacts.clerkUserId, input.actorClerkUserId)
              : undefined,
            input.actorClerkUserId ? isNull(clientContacts.archivedAt) : undefined,
          ),
        )
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .where(
          and(
            eq(bookings.id, input.bookingId),
            input.producerId ? eq(bookings.producerId, input.producerId) : undefined,
          ),
        )
        .limit(1)
        .for("update");
      if (!row) return null;
      const base = createContextFromRow(row, await contextDetails(tx, row.producerId));
      return { ...base, booking: bookingRecord(row.booking) } satisfies SessionBookingContext;
    },

    findBookingByOperationKey: async (producerId, operationKey) => {
      const [row] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.producerId, producerId), eq(bookings.operationKey, operationKey)))
        .limit(1);
      return row ? bookingRecord(row) : null;
    },

    findReplacementBooking: async (bookingId) => {
      const [row] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.rescheduledFromBookingId, bookingId))
        .limit(1);
      return row ? bookingRecord(row) : null;
    },

    findTransitionEvent: async (bookingId, operationKey) => {
      const [row] = await tx
        .select()
        .from(bookingTransitionEvents)
        .where(
          and(
            eq(bookingTransitionEvents.bookingId, bookingId),
            eq(bookingTransitionEvents.operationKey, operationKey),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    loadChangeRequest: async (input) => {
      const [row] = await tx
        .select()
        .from(bookingChangeRequests)
        .where(
          and(
            eq(bookingChangeRequests.id, input.requestId),
            input.producerId ? eq(bookingChangeRequests.producerId, input.producerId) : undefined,
          ),
        )
        .limit(1)
        .for("update");
      return row ? changeRequestRecord(row) : null;
    },

    findChangeRequestByOperationKey: async (bookingId, operationKey) => {
      const [row] = await tx
        .select()
        .from(bookingChangeRequests)
        .where(
          and(
            eq(bookingChangeRequests.bookingId, bookingId),
            eq(bookingChangeRequests.requestOperationKey, operationKey),
          ),
        )
        .limit(1);
      return row ? changeRequestRecord(row) : null;
    },

    findPendingChangeRequest: async (bookingId) => {
      const [row] = await tx
        .select()
        .from(bookingChangeRequests)
        .where(
          and(
            eq(bookingChangeRequests.bookingId, bookingId),
            eq(bookingChangeRequests.status, "pending"),
          ),
        )
        .limit(1);
      return row ? changeRequestRecord(row) : null;
    },

    listAllowanceUses: async (producerId, sessionAllowanceId) =>
      tx
        .select({
          bookingId: bookings.id,
          allowanceUseId: bookings.allowanceUseId,
          outcome: bookings.outcome,
          billingTreatment: bookings.billingTreatment,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, producerId),
            eq(bookings.sessionAllowanceId, sessionAllowanceId),
          ),
        ),

    listScheduleEntries: async (producerId) =>
      tx
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          bufferMinutes: purchaseSessionAllowances.bufferMinutes,
        })
        .from(bookings)
        .innerJoin(
          purchaseSessionAllowances,
          and(
            eq(purchaseSessionAllowances.id, bookings.sessionAllowanceId),
            eq(purchaseSessionAllowances.purchaseId, bookings.purchaseId),
            eq(purchaseSessionAllowances.producerId, bookings.producerId),
          ),
        )
        .where(
          and(
            eq(bookings.producerId, producerId),
            inArray(bookings.status, ["pending_approval", "confirmed"]),
          ),
        ),

    loadGoogleCalendarReconciliationContext: async (input) => {
      const [job] = await tx
        .select()
        .from(calendarSyncJobs)
        .where(
          and(
            eq(calendarSyncJobs.id, input.jobId),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.bookingCalendarLinkId, input.bookingCalendarLinkId),
            eq(calendarSyncJobs.operation, "reconcile_google_event"),
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .limit(1)
        .for("update");
      if (!job) return null;
      const [link] = await tx
        .select()
        .from(bookingCalendarLinks)
        .where(
          and(
            eq(bookingCalendarLinks.id, input.bookingCalendarLinkId),
            eq(bookingCalendarLinks.producerId, input.producerId),
          ),
        )
        .limit(1)
        .for("update");
      if (!link || job.desiredRevision > link.desiredRevision) return null;
      return {
        link: bookingCalendarLinkRecord(link),
        currentBookingId: link.currentBookingId,
        capturedRevision: job.desiredRevision,
      } satisfies SessionBookingGoogleReconciliationContext;
    },

    loadBookingCalendarRecoveryLink: async (input) => {
      const [link] = await tx
        .select()
        .from(bookingCalendarLinks)
        .where(
          and(
            eq(bookingCalendarLinks.currentBookingId, input.bookingId),
            eq(bookingCalendarLinks.producerId, input.producerId),
            eq(bookingCalendarLinks.providerState, "active"),
          ),
        )
        .orderBy(sql`${bookingCalendarLinks.accountVersion} desc`)
        .limit(1)
        .for("update");
      return link ? bookingCalendarLinkRecord(link) : null;
    },

    findGoogleCalendarRecoveryJob: async (input) => {
      const [row] = await tx
        .select()
        .from(calendarSyncJobs)
        .where(
          and(
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.bookingCalendarLinkId, input.bookingCalendarLinkId),
            inArray(calendarSyncJobs.operation, ["upsert_google_event", "delete_google_event"]),
            eq(calendarSyncJobs.lastManualRetryOperationKey, input.operationKey),
          ),
        )
        .orderBy(sql`${calendarSyncJobs.createdAt} desc`)
        .limit(1);
      return row ? calendarJobRecord(row) : null;
    },

    insertBooking: async (input: NewSessionBookingRecord) => {
      const [row] = await tx
        .insert(bookings)
        .values({
          producerId: input.producerId,
          projectId: input.projectId,
          purchaseId: input.purchaseId,
          sessionAllowanceId: input.sessionAllowanceId,
          title: input.title,
          origin: input.origin,
          billingTreatment: input.billingTreatment,
          artistName: input.artistName,
          artistEmail: input.artistEmail,
          startsAt: input.startsAt,
          durationMin: input.durationMin,
          operationKey: input.operationKey,
          operationDigest: input.operationDigest,
          rescheduledFromBookingId: input.rescheduledFromBookingId,
          allowanceUseId: input.allowanceUseId,
          cancellationPolicyHoursSnapshot: input.cancellationPolicyHoursSnapshot,
          cancellationPolicySnapshottedAt: input.cancellationPolicySnapshottedAt,
          cancellationPolicyBackfilled: input.cancellationPolicyBackfilled,
          heldExpiresAt: input.heldExpiresAt,
          heldExpiredAt: input.heldExpiredAt,
          heldExpiryReason: input.heldExpiryReason,
          status: input.status,
          statusChangedAt: input.occurredAt,
          outcome: input.outcome,
          outcomeChangedAt: input.occurredAt,
          calendarRevision: input.calendarRevision,
          artistRsvpStatus: input.artistRsvpStatus,
          artistRsvpRespondedAt: input.artistRsvpRespondedAt,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        })
        .returning();
      if (!row) throw new SessionBookingDomainError("INVALID_STATUS", "Booking insert failed");
      return bookingRecord(row);
    },

    updateBooking: async (input) => {
      const [row] = await tx
        .update(bookings)
        .set({
          status: input.status,
          statusChangedAt: input.occurredAt,
          outcome: input.outcome,
          outcomeChangedAt: input.occurredAt,
          calendarRevision: sql`${bookings.calendarRevision} + 1`,
          updatedAt: input.occurredAt,
          ...(input.heldExpiredAt
            ? {
                heldExpiredAt: input.heldExpiredAt,
                heldExpiryReason: input.heldExpiryReason,
              }
            : {}),
        })
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.producerId, input.producerId),
            eq(bookings.status, input.expectedStatus),
          ),
        )
        .returning();
      if (!row) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "The session changed while this command was running",
        );
      }
      return bookingRecord(row);
    },

    updateBookingCalendarProjection: async (input) => {
      const [row] = await tx
        .update(bookings)
        .set({
          calendarRevision: input.nextCalendarRevision,
          ...(Object.prototype.hasOwnProperty.call(input, "title")
            ? { title: input.title ?? null }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(input, "artistRsvpStatus")
            ? {
                artistRsvpStatus: input.artistRsvpStatus ?? null,
                artistRsvpRespondedAt: input.artistRsvpRespondedAt ?? null,
              }
            : {}),
          updatedAt: sql<Date>`greatest(
            ${input.occurredAt},
            ${bookings.updatedAt} + interval '1 millisecond'
          )`,
        })
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.producerId, input.producerId),
            eq(bookings.status, "confirmed"),
            eq(bookings.calendarRevision, input.expectedCalendarRevision),
          ),
        )
        .returning();
      if (!row) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "The session changed while Google Calendar was being checked",
        );
      }
      return bookingRecord(row);
    },

    insertTransitionEvent: async (input: SessionBookingTransitionEventDraft) => {
      const [row] = await tx.insert(bookingTransitionEvents).values(input).returning();
      if (!row)
        throw new SessionBookingDomainError("INVALID_STATUS", "Booking audit insert failed");
      return row satisfies StoredSessionBookingTransitionEvent;
    },

    insertChangeRequest: async (input: NewSessionBookingChangeRequestRecord) => {
      const { occurredAt, ...values } = input;
      const [row] = await tx
        .insert(bookingChangeRequests)
        .values({ ...values, createdAt: occurredAt, updatedAt: occurredAt })
        .returning();
      if (!row) {
        throw new SessionBookingDomainError("INVALID_STATUS", "Change request insert failed");
      }
      return changeRequestRecord(row);
    },

    decideChangeRequest: async (input) => {
      const [row] = await tx
        .update(bookingChangeRequests)
        .set({
          status: input.status,
          decisionOperationKey: input.decisionOperationKey,
          decisionOperationDigest: input.decisionOperationDigest,
          decidedByClerkUserId: input.decidedByClerkUserId,
          decidedAt: input.decidedAt,
          replacementBookingId: input.replacementBookingId,
          updatedAt: input.decidedAt,
        })
        .where(
          and(
            eq(bookingChangeRequests.id, input.requestId),
            eq(bookingChangeRequests.producerId, input.producerId),
            eq(bookingChangeRequests.status, "pending"),
          ),
        )
        .returning();
      if (!row) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "The session change request changed while this command was running",
        );
      }
      return changeRequestRecord(row);
    },

    findCalendarSyncJob: async (input) => {
      const [row] = await tx
        .select()
        .from(calendarSyncJobs)
        .where(
          and(
            eq(calendarSyncJobs.deliveryChannel, "ics"),
            eq(calendarSyncJobs.operation, "send_ics"),
            eq(calendarSyncJobs.desiredRevision, input.desiredRevision),
            sql`${calendarSyncJobs.payloadSnapshot}->>'uid' = ${input.uid}`,
          ),
        )
        .limit(1);
      return row ? calendarJobRecord(row) : null;
    },

    findGoogleCalendarSyncJob: async (input) => {
      const [row] = await tx
        .select()
        .from(calendarSyncJobs)
        .where(
          and(
            eq(calendarSyncJobs.deliveryChannel, "google"),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.bookingCalendarLinkId, input.bookingCalendarLinkId),
            eq(calendarSyncJobs.desiredRevision, input.desiredRevision),
            inArray(calendarSyncJobs.operation, ["upsert_google_event", "delete_google_event"]),
          ),
        )
        .limit(1);
      return row ? calendarJobRecord(row) : null;
    },

    findCalendarSyncJobForEvent: async (input) => {
      const intentFilter =
        input.intent === "opaque_hold"
          ? and(
              eq(calendarSyncJobs.deliveryChannel, "google"),
              sql`${calendarSyncJobs.payloadSnapshot}->>'action' = 'upsert'`,
              sql`${calendarSyncJobs.payloadSnapshot}->>'eventKind' = 'opaque_hold'`,
            )
          : input.intent === "confirmed"
            ? or(
                and(
                  eq(calendarSyncJobs.deliveryChannel, "ics"),
                  sql`${calendarSyncJobs.payloadSnapshot}->>'method' = 'REQUEST'`,
                ),
                and(
                  eq(calendarSyncJobs.deliveryChannel, "google"),
                  sql`${calendarSyncJobs.payloadSnapshot}->>'action' = 'upsert'`,
                  sql`${calendarSyncJobs.payloadSnapshot}->>'eventKind' = 'confirmed'`,
                ),
              )
            : or(
                and(
                  eq(calendarSyncJobs.deliveryChannel, "ics"),
                  sql`${calendarSyncJobs.payloadSnapshot}->>'method' = 'CANCEL'`,
                ),
                and(
                  eq(calendarSyncJobs.deliveryChannel, "google"),
                  sql`${calendarSyncJobs.payloadSnapshot}->>'action' = 'delete'`,
                ),
              );
      const [row] = await tx
        .select()
        .from(calendarSyncJobs)
        .where(
          and(
            eq(calendarSyncJobs.bookingId, input.bookingId),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.createdAt, input.occurredAt),
            intentFilter,
          ),
        )
        .limit(1);
      return row ? calendarJobRecord(row) : null;
    },

    prepareBookingCalendarLink: async (input) => {
      const [connection] = await tx
        .select({
          id: googleCalendarConnections.id,
          accountVersion: googleCalendarConnections.accountVersion,
          status: googleCalendarConnections.status,
        })
        .from(googleCalendarConnections)
        .where(eq(googleCalendarConnections.producerId, input.producerId))
        .limit(1);
      if (!connection) return null;

      const linkFilter = and(
        eq(bookingCalendarLinks.producerId, input.producerId),
        eq(bookingCalendarLinks.allowanceUseId, input.allowanceUseId),
        eq(bookingCalendarLinks.connectionId, connection.id),
        eq(bookingCalendarLinks.accountVersion, connection.accountVersion),
      );
      const advanceLink = async (
        existing: BookingCalendarLink,
      ): Promise<BookingCalendarLinkRecord> => {
        if (
          input.desiredRevision < existing.desiredRevision ||
          (input.desiredRevision === existing.desiredRevision &&
            input.bookingId !== existing.currentBookingId)
        ) {
          throw new SessionBookingDomainError(
            "OPERATION_KEY_CONFLICT",
            "This calendar revision already belongs to another booking state",
          );
        }
        if (
          input.desiredRevision === existing.desiredRevision &&
          input.bookingId === existing.currentBookingId
        ) {
          return bookingCalendarLinkRecord(existing);
        }
        const [updated] = await tx
          .update(bookingCalendarLinks)
          .set({
            currentBookingId: input.bookingId,
            desiredRevision: input.desiredRevision,
            ...(existing.syncState === "missing" || existing.syncState === "conflict"
              ? {}
              : {
                  syncState: "pending" as const,
                  syncStateChangedAt:
                    existing.syncState === "pending"
                      ? existing.syncStateChangedAt
                      : new Date(
                          Math.max(input.occurredAt.getTime(), existing.updatedAt.getTime() + 1),
                        ),
                  lastSyncErrorCode: null,
                }),
            updatedAt: new Date(
              Math.max(input.occurredAt.getTime(), existing.updatedAt.getTime() + 1),
            ),
          })
          .where(
            and(
              eq(bookingCalendarLinks.id, existing.id),
              eq(bookingCalendarLinks.producerId, input.producerId),
            ),
          )
          .returning();
        if (!updated) {
          throw new SessionBookingDomainError("INVALID_STATUS", "Calendar link update failed");
        }
        return bookingCalendarLinkRecord(updated);
      };

      const [existing] = await tx
        .select()
        .from(bookingCalendarLinks)
        .where(linkFilter)
        .limit(1)
        .for("update");
      if (existing) {
        return advanceLink(existing);
      }

      if (!input.allowCreate) return null;
      const linkId = randomUUID();
      await tx
        .insert(bookingCalendarLinks)
        .select(
          tx
            .select({
              id: sql<string>`${linkId}`.as("id"),
              producerId: googleCalendarConnections.producerId,
              allowanceUseId: sql<string>`${input.allowanceUseId}`.as("allowance_use_id"),
              originBookingId: sql<string>`${input.bookingId}`.as("origin_booking_id"),
              currentBookingId: sql<string>`${input.bookingId}`.as("current_booking_id"),
              connectionId: googleCalendarConnections.id,
              accountVersion: googleCalendarConnections.accountVersion,
              destinationSelectionId: googleCalendarSelections.id,
              destinationCalendarIdCiphertext:
                googleCalendarSelections.providerCalendarIdCiphertext,
              destinationCalendarIdIv: googleCalendarSelections.providerCalendarIdIv,
              destinationCalendarIdAuthTag: googleCalendarSelections.providerCalendarIdAuthTag,
              destinationCalendarIdKeyVersion:
                googleCalendarSelections.providerCalendarIdKeyVersion,
              destinationCalendarIdFingerprint:
                googleCalendarSelections.providerCalendarIdFingerprint,
              providerEventId: sql<string>`${`sk${linkId.replaceAll("-", "")}`}`.as(
                "provider_event_id",
              ),
              providerEventEtag: sql<string | null>`null`.as("provider_event_etag"),
              providerEventUpdatedAt: sql<Date | null>`null`.as("provider_event_updated_at"),
              providerState: sql<"uncreated">`'uncreated'`.as("provider_state"),
              syncState: sql<"pending">`'pending'`.as("sync_state"),
              syncStateChangedAt: sql<Date>`${input.occurredAt}`.as("sync_state_changed_at"),
              attentionDismissedAt: sql<Date | null>`null`.as("attention_dismissed_at"),
              lastInboundReconciledAt: sql<Date | null>`null`.as("last_inbound_reconciled_at"),
              lastSyncErrorCode: sql<null>`null`.as("last_sync_error_code"),
              desiredRevision: sql<number>`${input.desiredRevision}`.as("desired_revision"),
              lastGoogleRevision: sql<number>`0`.as("last_google_revision"),
              lastGoogleSyncedAt: sql<Date | null>`null`.as("last_google_synced_at"),
              invitationRevision: sql<number>`0`.as("invitation_revision"),
              invitationChannel: sql<"ics" | "google" | null>`null`.as("invitation_channel"),
              invitationReservedAt: sql<Date | null>`null`.as("invitation_reserved_at"),
              invitationAttemptedAt: sql<Date | null>`null`.as("invitation_attempted_at"),
              invitationDeliveredAt: sql<Date | null>`null`.as("invitation_delivered_at"),
              createdAt: sql<Date>`${input.occurredAt}`.as("created_at"),
              updatedAt: sql<Date>`${input.occurredAt}`.as("updated_at"),
            })
            .from(googleCalendarConnections)
            .innerJoin(
              googleCalendarSelections,
              and(
                eq(googleCalendarSelections.connectionId, googleCalendarConnections.id),
                eq(googleCalendarSelections.producerId, googleCalendarConnections.producerId),
                eq(
                  googleCalendarSelections.accountVersion,
                  googleCalendarConnections.accountVersion,
                ),
              ),
            )
            .where(
              and(
                eq(googleCalendarConnections.id, connection.id),
                eq(googleCalendarConnections.producerId, input.producerId),
                eq(googleCalendarConnections.accountVersion, connection.accountVersion),
                eq(googleCalendarConnections.status, "connected"),
                eq(googleCalendarSelections.isDestination, true),
              ),
            )
            .limit(1),
        )
        .onConflictDoNothing({
          target: [
            bookingCalendarLinks.producerId,
            bookingCalendarLinks.allowanceUseId,
            bookingCalendarLinks.connectionId,
            bookingCalendarLinks.accountVersion,
          ],
        });

      const [createdOrRaced] = await tx
        .select()
        .from(bookingCalendarLinks)
        .where(linkFilter)
        .limit(1)
        .for("update");
      if (!createdOrRaced) return null;
      return advanceLink(createdOrRaced);
    },

    advanceGoogleCalendarLink: async (input) => {
      const [existing] = await tx
        .select()
        .from(bookingCalendarLinks)
        .where(
          and(
            eq(bookingCalendarLinks.id, input.linkId),
            eq(bookingCalendarLinks.producerId, input.producerId),
            eq(bookingCalendarLinks.currentBookingId, input.expectedCurrentBookingId),
            eq(bookingCalendarLinks.desiredRevision, input.expectedDesiredRevision),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "The calendar link changed while Google Calendar was being checked",
        );
      }
      const occurredAt = new Date(
        Math.max(input.occurredAt.getTime(), existing.updatedAt.getTime() + 1),
      );
      const syncFactsChanged =
        existing.syncState !== input.syncState ||
        existing.lastSyncErrorCode !== input.lastSyncErrorCode;
      const [updated] = await tx
        .update(bookingCalendarLinks)
        .set({
          currentBookingId: input.currentBookingId,
          desiredRevision: input.desiredRevision,
          syncState: input.syncState,
          syncStateChangedAt: syncFactsChanged ? occurredAt : existing.syncStateChangedAt,
          lastSyncErrorCode: input.lastSyncErrorCode,
          ...(input.providerEventEtag === undefined
            ? {}
            : { providerEventEtag: input.providerEventEtag }),
          ...(input.providerEventUpdatedAt === undefined
            ? {}
            : { providerEventUpdatedAt: input.providerEventUpdatedAt }),
          ...(input.lastInboundReconciledAt === undefined
            ? {}
            : { lastInboundReconciledAt: input.lastInboundReconciledAt }),
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(bookingCalendarLinks.id, existing.id),
            eq(bookingCalendarLinks.producerId, existing.producerId),
            eq(bookingCalendarLinks.currentBookingId, input.expectedCurrentBookingId),
            eq(bookingCalendarLinks.desiredRevision, input.expectedDesiredRevision),
          ),
        )
        .returning();
      if (!updated) {
        throw new SessionBookingDomainError(
          "INVALID_STATUS",
          "The calendar link changed while Google Calendar was being checked",
        );
      }
      return bookingCalendarLinkRecord(updated);
    },

    completeGoogleCalendarReconciliationJob: async (input) => {
      const completedAt = sql<Date>`greatest(
        ${input.completedAt},
        ${calendarSyncJobs.updatedAt} + interval '1 millisecond'
      )`;
      const rows = await tx
        .update(calendarSyncJobs)
        .set({
          status: "completed",
          nextAttemptAt: null,
          leaseToken: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          providerMessageId: "reconciled",
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(calendarSyncJobs.id, input.jobId),
            eq(calendarSyncJobs.producerId, input.producerId),
            eq(calendarSyncJobs.bookingCalendarLinkId, input.bookingCalendarLinkId),
            eq(calendarSyncJobs.operation, "reconcile_google_event"),
            eq(calendarSyncJobs.desiredRevision, input.capturedRevision),
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning({ id: calendarSyncJobs.id });
      return rows.length === 1;
    },

    insertCalendarSyncJob: async (input: NewCalendarSyncJobRecord) => {
      const { occurredAt, ...values } = input;
      const [row] = await tx
        .insert(calendarSyncJobs)
        .values({
          ...values,
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: occurredAt,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        })
        .returning();
      if (!row) {
        throw new SessionBookingDomainError("INVALID_STATUS", "Calendar delivery insert failed");
      }
      return calendarJobRecord(row);
    },
  };
}

async function discoverBookingScope(
  tx: TransactionDb,
  scope: Extract<SessionBookingAtomicScope, { kind: "booking" }>,
): Promise<{
  producerId: string;
  projectId: string;
  purchaseId: string;
  sessionAllowanceId: string;
} | null> {
  const [row] = await tx
    .select({
      producerId: bookings.producerId,
      projectId: bookings.projectId,
      purchaseId: bookings.purchaseId,
      sessionAllowanceId: bookings.sessionAllowanceId,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, scope.bookingId),
        scope.producerId ? eq(bookings.producerId, scope.producerId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

async function discoverChangeRequestScope(
  tx: TransactionDb,
  scope: Extract<SessionBookingAtomicScope, { kind: "change_request" }>,
): Promise<{
  producerId: string;
  projectId: string;
  purchaseId: string;
  sessionAllowanceId: string;
} | null> {
  const [row] = await tx
    .select({
      producerId: bookings.producerId,
      projectId: bookings.projectId,
      purchaseId: bookings.purchaseId,
      sessionAllowanceId: bookings.sessionAllowanceId,
    })
    .from(bookingChangeRequests)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, bookingChangeRequests.bookingId),
        eq(bookings.producerId, bookingChangeRequests.producerId),
      ),
    )
    .where(
      and(
        eq(bookingChangeRequests.id, scope.requestId),
        eq(bookingChangeRequests.producerId, scope.producerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function sessionBookingScheduleAdvisoryLockKey(producerId: string): string {
  const normalized = producerId.trim();
  if (!normalized) throw new Error("Producer id must not be empty");
  return `session-booking:schedule:${normalized}`;
}

/** Shared lock order: producer schedule -> project -> purchase -> allowance. */
export function sessionBookingRepository(db: Db): SessionBookingRepository {
  return {
    findBookingGoogleCalendarSyncStatuses: async (input) => {
      if (input.bookingIds.length === 0) return [];
      const rows = await db
        .select({
          bookingId: bookingCalendarLinks.currentBookingId,
          syncState: bookingCalendarLinks.syncState,
          connectionStatus: googleCalendarConnections.status,
        })
        .from(bookingCalendarLinks)
        .innerJoin(
          bookings,
          and(
            eq(bookings.id, bookingCalendarLinks.currentBookingId),
            eq(bookings.producerId, bookingCalendarLinks.producerId),
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
            eq(bookingCalendarLinks.producerId, input.producerId),
            eq(bookings.producerId, input.producerId),
            inArray(bookingCalendarLinks.currentBookingId, [...input.bookingIds]),
          ),
        )
        .orderBy(desc(bookingCalendarLinks.accountVersion), desc(bookingCalendarLinks.updatedAt));
      const statusByBookingId = new Map<
        string,
        (typeof rows)[number]["syncState"] | "disconnected"
      >();
      for (const row of rows) {
        if (statusByBookingId.has(row.bookingId)) continue;
        statusByBookingId.set(
          row.bookingId,
          row.connectionStatus === "connected" ? row.syncState : "disconnected",
        );
      }
      return input.bookingIds.flatMap((bookingId) => {
        const status = statusByBookingId.get(bookingId);
        return status ? [{ bookingId, status }] : [];
      });
    },

    findProducerManualSessionBookingByOperationKey: async (input) => {
      const [row] = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, input.producerId),
            eq(bookings.operationKey, input.operationKey),
          ),
        )
        .limit(1);
      if (!row) return null;

      const [event] = await db
        .select()
        .from(bookingTransitionEvents)
        .where(
          and(
            eq(bookingTransitionEvents.bookingId, row.id),
            eq(bookingTransitionEvents.operationKey, input.operationKey),
          ),
        )
        .limit(1);
      const [calendarJob] = event
        ? await db
            .select({ id: calendarSyncJobs.id })
            .from(calendarSyncJobs)
            .where(
              and(
                eq(calendarSyncJobs.bookingId, row.id),
                eq(calendarSyncJobs.createdAt, event.occurredAt),
              ),
            )
            .limit(1)
        : [];
      return {
        booking: bookingRecord(row),
        event: event ?? null,
        calendarSyncJobId: calendarJob?.id ?? null,
      };
    },

    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        const anchors =
          scope.kind === "create"
            ? scope
            : scope.kind === "booking"
              ? await discoverBookingScope(tx, scope)
              : await discoverChangeRequestScope(tx, scope);
        if (!anchors) {
          throw new SessionBookingDomainError("NOT_FOUND", "The session was not found");
        }
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${sessionBookingScheduleAdvisoryLockKey(anchors.producerId)}, 0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(anchors.projectId)}, 0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${purchaseLedgerAdvisoryLockKey(anchors.purchaseId)}, 0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`session-booking:allowance:${anchors.sessionAllowanceId}`}, 0))`,
        );
        return work(transactionAdapter(tx));
      }),
  };
}
