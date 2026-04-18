import {
  and,
  bookings,
  createDb,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  producers,
  products,
} from "@skitza/db";
import { NextResponse } from "next/server";

import {
  sendSessionReminder1h,
  sendSessionReminder24h,
} from "~/server/email/send";

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
    return NextResponse.json(
      { ok: false, reason: "missing CRON_SECRET" },
      { status: 503 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json(
      { ok: false, reason: "missing DATABASE_URL" },
      { status: 503 },
    );
  }
  const db = createDb(dbUrl);
  const now = new Date();

  const window24Start = new Date(now.getTime() + ONE_DAY_MS);
  const window24End = new Date(window24Start.getTime() + WINDOW_MS);
  const window1Start = new Date(now.getTime() + ONE_HOUR_MS);
  const window1End = new Date(window1Start.getTime() + WINDOW_MS);

  // ── 24h reminders ──────────────────────────────────────────────
  const due24 = await db
    .select({
      id: bookings.id,
      producerId: bookings.producerId,
      productId: bookings.productId,
      artistName: bookings.artistName,
      artistEmail: bookings.artistEmail,
      startsAt: bookings.startsAt,
      durationMin: bookings.durationMin,
      packageNameSnapshot: bookings.packageNameSnapshot,
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
    const ctx = await loadEmailContext(db, b.producerId, b.productId);
    if (!ctx.producerEmail) continue;
    const productName = ctx.productName ?? b.packageNameSnapshot ?? "Session";
    try {
      await sendSessionReminder24h(b.artistEmail, {
        recipientName: b.artistName,
        recipientRole: "artist",
        counterpartName: ctx.producerDisplayName,
        productName,
        startsAt: b.startsAt,
        producerTimezone: ctx.timezone,
      });
      await sendSessionReminder24h(ctx.producerEmail, {
        recipientName: ctx.producerDisplayName,
        recipientRole: "producer",
        counterpartName: b.artistName,
        productName,
        startsAt: b.startsAt,
        producerTimezone: ctx.timezone,
      });
      await db
        .update(bookings)
        .set({ reminderSent24h: new Date() })
        .where(eq(bookings.id, b.id));
      sent24++;
    } catch (err) {
      console.warn("[cron] 24h reminder failed for booking", b.id, err);
    }
  }

  // ── 1h reminders ───────────────────────────────────────────────
  const due1 = await db
    .select({
      id: bookings.id,
      producerId: bookings.producerId,
      productId: bookings.productId,
      artistName: bookings.artistName,
      artistEmail: bookings.artistEmail,
      startsAt: bookings.startsAt,
      durationMin: bookings.durationMin,
      packageNameSnapshot: bookings.packageNameSnapshot,
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
    const ctx = await loadEmailContext(db, b.producerId, b.productId);
    if (!ctx.producerEmail) continue;
    const productName = ctx.productName ?? b.packageNameSnapshot ?? "Session";
    try {
      await sendSessionReminder1h(b.artistEmail, {
        recipientName: b.artistName,
        recipientRole: "artist",
        counterpartName: ctx.producerDisplayName,
        productName,
        startsAt: b.startsAt,
        producerTimezone: ctx.timezone,
      });
      await sendSessionReminder1h(ctx.producerEmail, {
        recipientName: ctx.producerDisplayName,
        recipientRole: "producer",
        counterpartName: b.artistName,
        productName,
        startsAt: b.startsAt,
        producerTimezone: ctx.timezone,
      });
      await db
        .update(bookings)
        .set({ reminderSent1h: new Date() })
        .where(eq(bookings.id, b.id));
      sent1++;
    } catch (err) {
      console.warn("[cron] 1h reminder failed for booking", b.id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: { twentyFour: due24.length, one: due1.length },
    sent: { twentyFour: sent24, one: sent1 },
  });
}

// Tiny helper — pull the producer + product context needed to render
// the reminder template. Returns nullish fields rather than throwing
// so a missing product doesn't block other bookings in the batch.
async function loadEmailContext(
  db: ReturnType<typeof createDb>,
  producerId: string,
  productId: string | null,
): Promise<{
  producerEmail: string | null;
  producerDisplayName: string;
  timezone: string;
  productName: string | null;
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
  let productName: string | null = null;
  if (productId) {
    const productRow = await db
      .select({ name: products.name })
      .from(products)
      .where(inArray(products.id, [productId]))
      .limit(1);
    productName = productRow[0]?.name ?? null;
  }
  return {
    producerEmail: producerRow?.email ?? null,
    producerDisplayName: producerRow?.displayName ?? "there",
    timezone: producerRow?.timezone ?? "UTC",
    productName,
  };
}
