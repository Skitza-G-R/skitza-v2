import {
  and,
  bookings,
  clientContacts,
  createDb,
  eq,
  gte,
  isNull,
  lte,
  producers,
  purchases,
} from "@skitza/db";

import {
  sendBookingCancelledOrRescheduledEmail,
  sendSessionReminder24h,
} from "~/server/email/send";
import { emitArtistSessionNotification } from "~/server/artist/notification-emitters";
import { sessionBookingRepository } from "~/server/domain/session-booking/db";
import { expireHeldSessionBooking } from "~/server/domain/session-booking/service";

type Db = ReturnType<typeof createDb>;

// SK-280: shared held-expiry + reminder sweep.
//
// This used to live only inside /api/cron/session-reminders — a route that was
// never registered in any vercel.json, so held requests wedged forever and no
// reminder ever sent. The Hobby plan allows exactly two cron jobs (both taken:
// calendar-sync and beta-nudges), so the sweep now ALSO runs as a phase of the
// nightly /api/cron/calendar-sync worker, and the windows below are written to
// CATCH UP rather than assume a 15-minute cadence:
//
// - 24h reminders scan (now+1h, now+24h20m]: every confirmed session is picked
//   up exactly once whatever the cadence; on a daily tick the email lands 1-25
//   hours before start.
//
// SK-290: the 1h "starting soon" reminder was removed. Its window was only 75
// minutes wide, so on a once-a-night cadence a session had to start in a narrow
// slice right after the tick to ever get one. The bookings.reminder_sent_1h
// column and the session_reminder_1h notification kind stay in the schema —
// production history already references them.
//
// Idempotency: a reminder row is CLAIMED (stamped) before sending so two
// concurrent sweeps can't double-mail, and UNCLAIMED again if the artist send
// throws so the next sweep retries — the previous version stamped first and
// dropped the reminder forever on a transient provider failure.
export type SessionReminderSweepResult = Readonly<{
  scanned: Readonly<{ held: number; twentyFour: number }>;
  expiredHeld: number;
  sent: Readonly<{ twentyFour: number }>;
}>;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const CATCH_UP_SLACK_MS = 20 * MINUTE_MS;

export function reminderWindows(now: Date): Readonly<{
  window24Start: Date;
  window24End: Date;
}> {
  return {
    window24Start: new Date(now.getTime() + HOUR_MS),
    window24End: new Date(now.getTime() + DAY_MS + CATCH_UP_SLACK_MS),
  };
}

export async function runSessionReminderSweep(
  db: Db,
  now: Date,
): Promise<SessionReminderSweepResult> {
  const { window24Start, window24End } = reminderWindows(now);

  // Expire Held requests through the same serialized lifecycle service used
  // by interactive booking actions. Every worker uses the same operation key,
  // so concurrent sweeps replay the first committed transition.
  const overdueHeld = await db
    .select({
      id: bookings.id,
      producerId: bookings.producerId,
      purchaseId: bookings.purchaseId,
      artistName: bookings.artistName,
      artistEmail: bookings.artistEmail,
      startsAt: bookings.startsAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "pending_approval"),
        lte(bookings.heldExpiresAt, now),
        isNull(bookings.heldExpiredAt),
      ),
    );

  let expiredHeld = 0;
  for (const booking of overdueHeld) {
    try {
      const result = await expireHeldSessionBooking(sessionBookingRepository(db), {
        bookingId: booking.id,
        operationKey: `cron:held-expiry:${booking.id}`,
        now,
      });
      if (!result.changed) continue;

      const context = await loadEmailContext(db, booking.producerId, booking.purchaseId);
      let emailEnabled = true;
      try {
        const delivery = await emitArtistSessionNotification(db, {
          recipientClerkUserId: context.artistClerkUserId,
          producerId: booking.producerId,
          bookingId: booking.id,
          producerName: context.producerDisplayName,
          sessionName: context.purchaseName ?? "Session",
          kind: "booking_cancelled",
          sourceEventId: `held-expiry:${booking.id}`,
        });
        emailEnabled = delivery.emailEnabled;
      } catch (error) {
        console.warn("[artist-notify] held-expiry event failed", error);
      }
      if (emailEnabled) {
        try {
          await sendBookingCancelledOrRescheduledEmail(booking.artistEmail, {
            recipientName: booking.artistName,
            counterpartName: context.producerDisplayName,
            productName: context.purchaseName ?? "Session",
            status: "cancelled",
            oldStartsAt: booking.startsAt,
            newStartsAt: null,
            producerTimezone: context.timezone,
            reason: "The booking request expired before it was confirmed.",
          });
        } catch (error) {
          console.warn("[cron] held-expiry artist email failed for booking", booking.id, error);
        }
      }
      expiredHeld++;
    } catch (error) {
      console.warn("[cron] held-expiry transition failed for booking", booking.id, error);
    }
  }

  // ── 24h reminders ──────────────────────────────────────────────
  const due24 = await db
    .select({
      id: bookings.id,
      producerId: bookings.producerId,
      purchaseId: bookings.purchaseId,
      artistName: bookings.artistName,
      artistEmail: bookings.artistEmail,
      startsAt: bookings.startsAt,
      durationMin: bookings.durationMin,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        gte(bookings.startsAt, window24Start),
        lte(bookings.startsAt, window24End),
        isNull(bookings.reminderSent24h),
      ),
    );

  let sent24 = 0;
  for (const b of due24) {
    if (b.durationMin <= 0) continue; // pure-deliverable, no session
    const ctx = await loadEmailContext(db, b.producerId, b.purchaseId);
    const productName = ctx.purchaseName ?? "Session";
    const [claimed] = await db
      .update(bookings)
      .set({ reminderSent24h: now })
      .where(
        and(
          eq(bookings.id, b.id),
          eq(bookings.status, "confirmed"),
          isNull(bookings.reminderSent24h),
        ),
      )
      .returning({ id: bookings.id });
    if (!claimed) continue;

    let artistEmailEnabled = true;
    try {
      const delivery = await emitArtistSessionNotification(db, {
        recipientClerkUserId: ctx.artistClerkUserId,
        producerId: b.producerId,
        bookingId: b.id,
        producerName: ctx.producerDisplayName,
        sessionName: productName,
        kind: "session_reminder_24h",
        sourceEventId: `${b.id}:24h`,
      });
      artistEmailEnabled = delivery.emailEnabled;
    } catch (error) {
      console.warn("[artist-notify] 24h reminder event failed", b.id, error);
    }
    if (artistEmailEnabled) {
      try {
        await sendSessionReminder24h(b.artistEmail, {
          recipientName: b.artistName,
          recipientRole: "artist",
          counterpartName: ctx.producerDisplayName,
          productName,
          startsAt: b.startsAt,
          producerTimezone: ctx.timezone,
          durationMin: b.durationMin,
        });
      } catch (error) {
        // Release the claim so the next sweep retries this reminder.
        console.warn("[cron] 24h artist reminder failed for booking", b.id, error);
        await unclaimReminder(db, b.id);
        continue;
      }
    }
    if (ctx.producerEmail) {
      try {
        await sendSessionReminder24h(ctx.producerEmail, {
          recipientName: ctx.producerDisplayName,
          recipientRole: "producer",
          counterpartName: b.artistName,
          productName,
          startsAt: b.startsAt,
          producerTimezone: ctx.timezone,
          durationMin: b.durationMin,
        });
      } catch (error) {
        // The artist half already went out — keep the claim, drop only this
        // producer copy rather than double-mailing the artist on retry.
        console.warn("[cron] 24h producer reminder failed for booking", b.id, error);
      }
    }
    sent24++;
  }

  return {
    scanned: { held: overdueHeld.length, twentyFour: due24.length },
    expiredHeld,
    sent: { twentyFour: sent24 },
  };
}

async function unclaimReminder(db: Db, bookingId: string): Promise<void> {
  try {
    await db
      .update(bookings)
      .set({ reminderSent24h: null })
      .where(eq(bookings.id, bookingId));
  } catch (error) {
    console.warn("[cron] 24h reminder unclaim failed for booking", bookingId, error);
  }
}

// Pull producer context plus the immutable accepted purchase name. A
// later catalog edit must never rewrite what this session was bought as.
async function loadEmailContext(
  db: Db,
  producerId: string,
  purchaseId: string,
): Promise<{
  producerEmail: string | null;
  producerDisplayName: string;
  timezone: string;
  purchaseName: string | null;
  artistClerkUserId: string | null;
}> {
  const [producerRow] = await db
    .select({
      email: producers.email,
      displayName: producers.displayName,
      timezone: producers.timezone,
    })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1);
  const [purchaseRow] = await db
    .select({
      snapshot: purchases.commercialSnapshot,
      artistClerkUserId: clientContacts.clerkUserId,
      artistContactArchivedAt: clientContacts.archivedAt,
    })
    .from(purchases)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
      ),
    )
    .where(and(eq(purchases.id, purchaseId), eq(purchases.producerId, producerId)))
    .limit(1);
  return {
    producerEmail: producerRow?.email ?? null,
    producerDisplayName: producerRow?.displayName ?? "there",
    timezone: producerRow?.timezone ?? "UTC",
    purchaseName: purchaseRow?.snapshot.productOrOfferName ?? null,
    artistClerkUserId:
      purchaseRow?.artistContactArchivedAt === null
        ? (purchaseRow.artistClerkUserId ?? null)
        : null,
  };
}
