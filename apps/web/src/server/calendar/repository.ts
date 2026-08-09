import {
  and,
  asc,
  calendarSyncJobs,
  eq,
  lte,
  or,
  sql,
  type CalendarSyncJob,
  type Db,
} from "@skitza/db";

import type { CalendarDeliveryRepository } from "./delivery";

function afterExistingTimestamp(requested: Date, existing: Date): Date {
  return new Date(Math.max(requested.getTime(), existing.getTime() + 1));
}

function resolutionTimestamp(requested: Date) {
  return sql<Date>`greatest(${requested}, ${calendarSyncJobs.updatedAt} + interval '1 millisecond')`;
}

export function calendarDeliveryRepository(db: Db): CalendarDeliveryRepository {
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
          .where(and(due, input.jobId ? eq(calendarSyncJobs.id, input.jobId) : undefined))
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

    completeJob: async (input) => {
      const occurredAt = resolutionTimestamp(input.completedAt);
      const rows = await db
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
            eq(calendarSyncJobs.status, "processing"),
            eq(calendarSyncJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning({ id: calendarSyncJobs.id });
      return rows.length === 1;
    },

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
  };
}
