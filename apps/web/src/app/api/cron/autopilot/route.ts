import { NextResponse } from "next/server";

// Batch G — Autopilot cron entry point.
//
// Three of the five Autopilot behaviors are time-based rather than
// event-driven, so they need a periodic sweep instead of a synchronous
// hook. Those three are:
//   * autopilot_unpaid_reminder — after 7 days unpaid, email the
//     producer a reminder about the outstanding invoice.
//   * autopilot_request_testimonial — when a project reaches 'paid',
//     ask the artist for a testimonial.
//   * autopilot_auto_archive — 30 days after a project reaches
//     'paid', move it to 'archived'.
//
// Vercel Hobby tier only allows daily crons (the finest granularity
// below Pro). A daily sweep is plenty for all three behaviors — they
// all key off day-resolution deltas (7d, 30d), not minutes. Once
// we're on Pro, the same route can be scheduled on a tighter cadence
// without changing the logic.
//
// For now the route is NOT scheduled in vercel.json — the project is
// on Hobby and our existing /api/cron/session-reminders already burns
// the daily slot. The route is wired + importable so manual triggers
// (local curl, staging smoke) work today, and flipping from "manual"
// to "scheduled" in vercel.json once we upgrade is a one-line change.
//
// TODO(autopilot-cron-schedule): add to vercel.json's `crons` array
// once upgraded to Pro:
//   { "path": "/api/cron/autopilot", "schedule": "0 */6 * * *" }
// (6-hourly is generous for day-granularity checks and keeps latency
// on the "7 days unpaid" nudge under a quarter-day.)

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Auth — same pattern as session-reminders: require the CRON_SECRET
  // Bearer token. Unauthenticated hits 401 so this endpoint can't be
  // a public DOS surface for the downstream email/DB work.
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
  // Yield a tick so Next treats the handler as a proper async entry
  // and static analyzers don't flag "no await" once the TODO body is
  // still empty. Replaced by real DB work in the follow-up PR.
  await Promise.resolve();

  // TODO(unpaid-reminder): SELECT invoices WHERE status IN
  // ('draft','sent','uncollectible') AND created_at < now - 7d AND
  // producer.autopilot_unpaid_reminder = true — then send one Resend
  // email per invoice. Requires an `invoice_reminder_sent_at` column
  // on invoices to idempotently avoid spamming the producer every
  // tick; migration 0028 can add it when this lands.
  //
  // TODO(request-testimonial): SELECT projects WHERE stage='paid'
  // AND testimonial_requested_at IS NULL AND
  // producer.autopilot_request_testimonial = true — send the artist
  // an email asking for a short quote + star rating. Needs a
  // `testimonial_requested_at` column (migration 0028) and a
  // testimonial-capture form (public page at /t/<token>).
  //
  // TODO(auto-archive): UPDATE projects SET stage='archived' WHERE
  // stage='paid' AND updated_at < now - 30d AND
  // producer.autopilot_auto_archive = true. Safe — archived is
  // terminal in the timeline, reversible via the stage dropdown.

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    deferred: [
      "unpaid-reminder",
      "request-testimonial",
      "auto-archive",
    ],
    note: "Runs daily via /api/cron/* once on Vercel Pro — see route comment.",
  });
}
