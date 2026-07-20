import { and, createDb, eq, isNull, producers, projects } from "@skitza/db";
import { NextResponse } from "next/server";

import { SITE_URL, sendPaymentReminderEmail } from "~/server/email/send";
import {
  paymentReminderRepository,
  sendAutomaticPurchaseReminders,
} from "~/server/domain/purchase-ledger/reminders";

// Autopilot cron. Purchase reminders use the exact purchase ledger and an
// immutable successful-send log; song archival remains deferred until its
// song-level policy exists.
//
// Request-testimonial detects projects that reached lifecycle completion and
//      producer.autopilot_request_testimonial = true, ask the artist
//      for a testimonial. 2026-04-22 — wired for DB detection only
//      because the capture form (public /t/<token> surface) isn't
//      built yet. Route returns the count of eligible projects in
//      `deferred.request-testimonial-eligible` so Gili can see the
//      target population; the actual email send + DB stamp fires
//      once the capture form ships (follow-up PR).
// Auth via CRON_SECRET bearer token. Not yet scheduled in vercel.json
// because Hobby tier's only daily slot is on /api/cron/session-
// reminders. To enable scheduled runs, add to vercel.json once on Pro:
//   { "path": "/api/cron/autopilot", "schedule": "0 */6 * * *" }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const unpaidReminder = await sendAutomaticPurchaseReminders(
    paymentReminderRepository(db),
    ({ to, props, idempotencyKey }) => sendPaymentReminderEmail(to, props, idempotencyKey),
    {
      asOf: now,
      paymentUrlForPurchase: (purchaseId) =>
        `${SITE_URL}/artist/payments/${encodeURIComponent(purchaseId)}`,
    },
  );

  // Request-testimonial sweep — detection only, no send.
  // The email + capture flow needs the /t/<token> testimonial-
  // capture page to exist first (not yet built — flagged in the
  // overnight plan). We count eligible projects so producers can see
  // the target population; we don't stamp or email until the form
  // ships, because emailing a dead link is worse than silence.
  const testimonialEligible = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(producers, eq(projects.producerId, producers.id))
    .where(
      and(
        eq(projects.lifecycleStatus, "completed"),
        isNull(projects.testimonialRequestedAt),
        eq(producers.autopilotRequestTestimonial, true),
      ),
    );

  return NextResponse.json({
    ok: true,
    ranAt: now.toISOString(),
    unpaidReminder,
    requestTestimonial: {
      eligible: testimonialEligible.length,
      deferred: "send+stamp gated on /t/<token> capture page — not yet built",
    },
    autoArchive: {
      archived: 0,
      deferred: "song-level archive policy is not available in SK-90",
    },
  });
}
