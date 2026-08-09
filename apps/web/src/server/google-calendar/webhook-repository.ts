import { randomUUID } from "node:crypto";

import {
  and,
  bookingCalendarLinks,
  bookings,
  calendarSyncJobs,
  eq,
  googleCalendarWatches,
  gt,
  inArray,
  sql,
  type Db,
  type GoogleCalendarReconcileJobPayloadSnapshot,
} from "@skitza/db";

import type { GoogleCalendarWebhookNotification } from "./watch";

const MAX_LINKS_PER_NOTIFICATION = 500;

export type GoogleCalendarWebhookEnqueueResult = Readonly<{
  outcome: "accepted" | "unknown" | "replayed";
  jobsEnqueued: number;
  jobIds: readonly string[];
}>;

export interface GoogleCalendarWebhookRepository {
  enqueueVerifiedNotification(
    notification: GoogleCalendarWebhookNotification & Readonly<{ receivedAt: Date }>,
  ): Promise<GoogleCalendarWebhookEnqueueResult>;
}

/**
 * Trust verification, monotonic message advancement, and per-known-link job
 * insertion share one transaction. A wrong or replayed notification cannot
 * leave partial work behind.
 */
export function createGoogleCalendarWebhookRepository(db: Db): GoogleCalendarWebhookRepository {
  return {
    async enqueueVerifiedNotification(notification) {
      return db.transaction(async (tx) => {
        const [watch] = await tx
          .select()
          .from(googleCalendarWatches)
          .where(
            and(
              eq(googleCalendarWatches.providerChannelId, notification.channelId),
              eq(googleCalendarWatches.providerResourceId, notification.resourceId),
              eq(googleCalendarWatches.channelTokenDigest, notification.channelTokenDigest),
              inArray(googleCalendarWatches.state, ["renewing", "active"]),
              gt(googleCalendarWatches.expiresAt, notification.receivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!watch) {
          return { outcome: "unknown", jobsEnqueued: 0, jobIds: [] } as const;
        }

        const [advanced] = await tx
          .update(googleCalendarWatches)
          .set({
            lastMessageNumber: notification.messageNumber,
            lastNotificationAt: notification.receivedAt,
            updatedAt: sql`greatest(
              ${notification.receivedAt},
              ${googleCalendarWatches.updatedAt} + interval '1 millisecond'
            )`,
          })
          .where(
            and(
              eq(googleCalendarWatches.id, watch.id),
              eq(googleCalendarWatches.producerId, watch.producerId),
              sql`${googleCalendarWatches.lastMessageNumber}::numeric < ${notification.messageNumber}::numeric`,
            ),
          )
          .returning({ id: googleCalendarWatches.id });
        if (!advanced) {
          return { outcome: "replayed", jobsEnqueued: 0, jobIds: [] } as const;
        }
        if (notification.resourceState === "sync") {
          return { outcome: "accepted", jobsEnqueued: 0, jobIds: [] } as const;
        }

        const links = await tx
          .select({
            bookingId: bookingCalendarLinks.currentBookingId,
            linkId: bookingCalendarLinks.id,
            producerId: bookingCalendarLinks.producerId,
            desiredRevision: bookingCalendarLinks.desiredRevision,
          })
          .from(bookingCalendarLinks)
          .innerJoin(
            bookings,
            and(
              eq(bookings.id, bookingCalendarLinks.currentBookingId),
              eq(bookings.producerId, bookingCalendarLinks.producerId),
            ),
          )
          .where(
            and(
              eq(bookingCalendarLinks.producerId, watch.producerId),
              eq(bookingCalendarLinks.connectionId, watch.connectionId),
              eq(bookingCalendarLinks.accountVersion, watch.accountVersion),
              eq(
                bookingCalendarLinks.destinationCalendarIdFingerprint,
                watch.destinationCalendarIdFingerprint,
              ),
              eq(bookingCalendarLinks.providerState, "active"),
              eq(bookings.status, "confirmed"),
              gt(bookings.startsAt, notification.receivedAt),
            ),
          )
          .orderBy(bookings.startsAt, bookingCalendarLinks.id)
          .limit(MAX_LINKS_PER_NOTIFICATION);
        if (links.length === 0) {
          return { outcome: "accepted", jobsEnqueued: 0, jobIds: [] } as const;
        }

        const rows = links.map((link) => {
          const payloadSnapshot: GoogleCalendarReconcileJobPayloadSnapshot = {
            schemaVersion: 3,
            action: "reconcile",
            source: "webhook",
            watchId: watch.id,
            messageNumber: notification.messageNumber,
          };
          return {
            id: randomUUID(),
            bookingId: link.bookingId,
            producerId: link.producerId,
            deliveryChannel: "google" as const,
            bookingCalendarLinkId: link.linkId,
            googleCalendarWatchId: watch.id,
            webhookMessageNumber: notification.messageNumber,
            operation: "reconcile_google_event" as const,
            status: "pending" as const,
            desiredRevision: link.desiredRevision,
            idempotencyKey: `google:webhook:${watch.id}:${notification.messageNumber}:${link.linkId}`,
            payloadSnapshot,
            nextAttemptAt: notification.receivedAt,
            createdAt: notification.receivedAt,
            updatedAt: notification.receivedAt,
          };
        });
        const inserted = await tx
          .insert(calendarSyncJobs)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: calendarSyncJobs.id });
        return {
          outcome: "accepted",
          jobsEnqueued: inserted.length,
          jobIds: inserted.map((row) => row.id),
        } as const;
      });
    },
  };
}
