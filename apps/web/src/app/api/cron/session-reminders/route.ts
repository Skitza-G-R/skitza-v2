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
import { NextResponse } from "next/server";

import {
  sendBookingCancelledOrRescheduledEmail,
  sendSessionReminder1h,
  sendSessionReminder24h,
} from "~/server/email/send";
import { emitArtistSessionNotification } from "~/server/artist/notification-emitters";
import { sessionBookingRepository } from "~/server/domain/session-booking/db";
import { expireHeldSessionBooking } from "~/server/domain/session-booking/service";

// Vercel Cron entry point — fires every 15 minutes (see vercel.json).
// We scan for confirmed bookings whose startsAt falls in either the
// next-24h or next-1h dispatch window and haven't already been
// reminded. The two windows are 15 min wide to match the cron cadence
// (so even if a single tick is dropped, the next will catch the
// booking on the second try). The `reminder_sent_*` columns gate
// idempotency: stamping NOW() right after a successful send means
// retries can't double-mail.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` for
// the request — we 401 anything else so this can't be a public DOS
// surface for the SMTP quota.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, reason: "missing CRON_SECRET" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ ok: false, reason: "missing DATABASE_URL" }, { status: 503 });
  }
  const db = createDb(dbUrl);
  const now = new Date();

  const window24Start = new Date(now.getTime() + ONE_DAY_MS);
  const window24End = new Date(window24Start.getTime() + WINDOW_MS);
  const window1Start = new Date(now.getTime() + ONE_HOUR_MS);
  const window1End = new Date(window1Start.getTime() + WINDOW_MS);

  // Expire Held requests through the same serialized lifecycle service used
  // by interactive booking actions. Every worker uses the same operation key,
  // so concurrent cron invocations replay the first committed transition.
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
        });
      } catch (error) {
        console.warn("[cron] 24h artist reminder failed for booking", b.id, error);
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
        });
      } catch (error) {
        console.warn("[cron] 24h producer reminder failed for booking", b.id, error);
      }
    }
    sent24++;
  }

  // ── 1h reminders ───────────────────────────────────────────────
  const due1 = await db
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
        gte(bookings.startsAt, window1Start),
        lte(bookings.startsAt, window1End),
        isNull(bookings.reminderSent1h),
      ),
    );

  let sent1 = 0;
  for (const b of due1) {
    if (b.durationMin <= 0) continue;
    const ctx = await loadEmailContext(db, b.producerId, b.purchaseId);
    const productName = ctx.purchaseName ?? "Session";
    const [claimed] = await db
      .update(bookings)
      .set({ reminderSent1h: now })
      .where(
        and(
          eq(bookings.id, b.id),
          eq(bookings.status, "confirmed"),
          isNull(bookings.reminderSent1h),
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
        kind: "session_reminder_1h",
        sourceEventId: `${b.id}:1h`,
      });
      artistEmailEnabled = delivery.emailEnabled;
    } catch (error) {
      console.warn("[artist-notify] 1h reminder event failed", b.id, error);
    }
    if (artistEmailEnabled) {
      try {
        await sendSessionReminder1h(b.artistEmail, {
          recipientName: b.artistName,
          recipientRole: "artist",
          counterpartName: ctx.producerDisplayName,
          productName,
          startsAt: b.startsAt,
          producerTimezone: ctx.timezone,
        });
      } catch (error) {
        console.warn("[cron] 1h artist reminder failed for booking", b.id, error);
      }
    }
    if (ctx.producerEmail) {
      try {
        await sendSessionReminder1h(ctx.producerEmail, {
          recipientName: ctx.producerDisplayName,
          recipientRole: "producer",
          counterpartName: b.artistName,
          productName,
          startsAt: b.startsAt,
          producerTimezone: ctx.timezone,
        });
      } catch (error) {
        console.warn("[cron] 1h producer reminder failed for booking", b.id, error);
      }
    }
    sent1++;
  }

  return NextResponse.json({
    ok: true,
    scanned: { held: overdueHeld.length, twentyFour: due24.length, one: due1.length },
    expiredHeld,
    sent: { twentyFour: sent24, one: sent1 },
  });
}

// Pull producer context plus the immutable accepted purchase name. A
// later catalog edit must never rewrite what this session was bought as.
async function loadEmailContext(
  db: ReturnType<typeof createDb>,
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
