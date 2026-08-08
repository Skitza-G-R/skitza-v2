import {
  and,
  availabilityBlackouts,
  availabilityBlocks,
  bookingTransitionEvents,
  bookings,
  clientContacts,
  eq,
  inArray,
  isNull,
  producers,
  projects,
  purchases,
  purchaseSessionAllowances,
  sql,
  type Booking,
  type Db,
} from "@skitza/db";

import { projectAdvisoryLockKey } from "../project-lifecycle/lock";
import { purchaseLedgerAdvisoryLockKey } from "../purchase-ledger/db";
import {
  SessionBookingDomainError,
  type NewSessionBookingRecord,
  type SessionBookingAtomicScope,
  type SessionBookingContext,
  type SessionBookingCreateContext,
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
      timeZone: row.timeZone,
      autoConfirmBookings: row.autoConfirmBookings,
      cancellationPolicyHours: row.cancellationPolicyHours,
      maxSessionsPerDay: row.maxSessionsPerDay,
    },
    project: { id: row.projectId, lifecycleStatus: row.projectLifecycleStatus },
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

    loadBookingContext: async (input) => {
      const [row] = await tx
        .select({
          booking: bookings,
          producerId: producers.id,
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

    insertTransitionEvent: async (input: SessionBookingTransitionEventDraft) => {
      const [row] = await tx.insert(bookingTransitionEvents).values(input).returning();
      if (!row)
        throw new SessionBookingDomainError("INVALID_STATUS", "Booking audit insert failed");
      return row satisfies StoredSessionBookingTransitionEvent;
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

export function sessionBookingScheduleAdvisoryLockKey(producerId: string): string {
  const normalized = producerId.trim();
  if (!normalized) throw new Error("Producer id must not be empty");
  return `session-booking:schedule:${normalized}`;
}

/** Shared lock order: producer schedule -> project -> purchase -> allowance. */
export function sessionBookingRepository(db: Db): SessionBookingRepository {
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        const anchors = scope.kind === "create" ? scope : await discoverBookingScope(tx, scope);
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
