import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import { runSessionReminderSweep } from "~/server/calendar/session-reminder-sweep";

// Held-expiry + session-reminder sweep entry point.
//
// SK-280: this route was never registered in any vercel.json (the Hobby plan
// allows exactly two cron jobs and both slots are taken), so the sweep now
// also runs as a phase of the nightly /api/cron/calendar-sync worker. This
// route stays for an external scheduler or a manual trigger — the sweep's
// windows are cadence-independent and idempotent, so calling it from both
// places is safe.
//
// Auth: callers send `Authorization: Bearer ${CRON_SECRET}` — we 401 anything
// else so this can't be a public DOS surface for the SMTP quota.
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
  const result = await runSessionReminderSweep(createDb(dbUrl), new Date());
  return NextResponse.json({ ok: true, ...result });
}
