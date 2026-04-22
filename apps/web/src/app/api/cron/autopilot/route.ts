import {
  and,
  createDb,
  eq,
  inArray,
  invoices,
  isNull,
  lt,
  producers,
  projects,
} from "@skitza/db";
import { NextResponse } from "next/server";

import { FROM_ADDRESS, getResend } from "~/server/email/client";

// Autopilot cron — audit Task 12 (overnight Task E). Three behaviors
// the producer can opt into via Setup → Autopilot:
//
//   1. unpaid-reminder — 7+ days after an invoice was created, if
//      still unpaid and producer.autopilot_unpaid_reminder = true,
//      email the customer (artist) a nudge. Stamp
//      invoices.reminder_sent_at to guarantee idempotency across
//      re-runs.
//
//   2. request-testimonial — when a project reaches stage='paid' and
//      producer.autopilot_request_testimonial = true, ask the artist
//      for a testimonial. 2026-04-22 — wired for DB detection only
//      because the capture form (public /t/<token> surface) isn't
//      built yet. Route returns the count of eligible projects in
//      `deferred.request-testimonial-eligible` so Gili can see the
//      target population; the actual email send + DB stamp fires
//      once the capture form ships (follow-up PR).
//
//   3. auto-archive — 30 days after a project reaches 'paid', if
//      producer.autopilot_auto_archive = true, flip stage to
//      'archived'. Safe + reversible via the stage dropdown.
//
// Auth via CRON_SECRET bearer token. Not yet scheduled in vercel.json
// because Hobby tier's only daily slot is on /api/cron/session-
// reminders. To enable scheduled runs, add to vercel.json once on Pro:
//   { "path": "/api/cron/autopilot", "schedule": "0 */6 * * *" }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Kinds that represent "still owed" money. Paid, refunded, void are
// excluded — we never re-nudge them. Typed via `satisfies` so
// drizzle's `inArray` accepts it as the exact enum-literal tuple.
const UNPAID_STATUSES: ReadonlyArray<
  "draft" | "sent" | "uncollectible"
> = ["draft", "sent", "uncollectible"] as const;

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
    return NextResponse.json(
      { ok: false, reason: "unauthorized" },
      { status: 401 },
    );
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
  const unpaidCutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
  const archiveCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);

  // ── 1. unpaid-reminder sweep ─────────────────────────────────────
  // Target rows: invoices older than 7d, still unpaid, whose owner
  // producer has Autopilot-unpaid-reminder enabled, and that haven't
  // been reminded yet. Join producers to get the toggle + display
  // name for the email body.
  const unpaidRows = await db
    .select({
      invoiceId: invoices.id,
      customerEmail: invoices.customerEmail,
      customerName: invoices.customerName,
      producerId: producers.id,
      producerDisplayName: producers.displayName,
      producerAutopilot: producers.autopilotUnpaidReminder,
    })
    .from(invoices)
    .innerJoin(producers, eq(invoices.producerId, producers.id))
    .where(
      and(
        inArray(invoices.status, [...UNPAID_STATUSES]),
        lt(invoices.createdAt, unpaidCutoff),
        isNull(invoices.reminderSentAt),
        eq(producers.autopilotUnpaidReminder, true),
      ),
    );

  let unpaidSent = 0;
  const unpaidErrors: string[] = [];
  for (const row of unpaidRows) {
    if (!row.customerEmail) continue;
    const producerName = row.producerDisplayName ?? "Your producer";
    const artistName = row.customerName ?? "there";
    try {
      await getResend().emails.send({
        from: FROM_ADDRESS,
        to: row.customerEmail,
        subject: `Reminder — unpaid invoice from ${producerName}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 24px auto; padding: 24px; background: #FBF7F0; border-radius: 12px; color: #1A1714;">
            <h1 style="font-family: Georgia, serif; color: #A25A28; margin: 0 0 16px;">Invoice reminder</h1>
            <p>Hi ${artistName},</p>
            <p>Just a friendly nudge — you have an open invoice from <strong>${producerName}</strong> that's been outstanding for a week. When you get a chance, open your Skitza workspace to settle it.</p>
            <p style="color: #6B6158; font-size: 12px; margin-top: 24px;">Sent from Skitza on behalf of ${producerName}. Reply to this email to reach them directly.</p>
          </div>
        `,
      });
      // Stamp the sent-at column so the next tick skips this row.
      await db
        .update(invoices)
        .set({ reminderSentAt: new Date() })
        .where(eq(invoices.id, row.invoiceId));
      unpaidSent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        "[autopilot] unpaid-reminder send failed for invoice",
        row.invoiceId,
        msg,
      );
      unpaidErrors.push(row.invoiceId);
    }
  }

  // ── 2. request-testimonial sweep — detection only, no send ──────
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
        eq(projects.stage, "paid"),
        isNull(projects.testimonialRequestedAt),
        eq(producers.autopilotRequestTestimonial, true),
      ),
    );

  // ── 3. auto-archive sweep ──────────────────────────────────────
  // Pure UPDATE — flip stage='paid' rows 30d+ old to 'archived' for
  // producers who opted in. `returning` gives us the affected count.
  const archived = await db
    .update(projects)
    .set({ stage: "archived", updatedAt: new Date() })
    .from(producers)
    .where(
      and(
        eq(projects.producerId, producers.id),
        eq(projects.stage, "paid"),
        lt(projects.updatedAt, archiveCutoff),
        eq(producers.autopilotAutoArchive, true),
      ),
    )
    .returning({ id: projects.id });

  return NextResponse.json({
    ok: true,
    ranAt: now.toISOString(),
    unpaidReminder: {
      eligible: unpaidRows.length,
      sent: unpaidSent,
      errored: unpaidErrors.length,
    },
    requestTestimonial: {
      eligible: testimonialEligible.length,
      deferred:
        "send+stamp gated on /t/<token> capture page — not yet built",
    },
    autoArchive: {
      archived: archived.length,
    },
  });
}
