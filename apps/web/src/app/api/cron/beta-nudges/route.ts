import {
  createDb,
  listBetaNudgeCandidates,
  markBetaNudgeSent,
  selectBetaNudges,
  syncBetaInviteeStatuses,
} from "@skitza/db";
import { NextResponse } from "next/server";

import {
  sendBetaActivationHelpEmail,
  sendBetaSignupReminderEmail,
} from "~/server/email/send";

// SK-273 — Vercel Cron entry point, fires daily at 08:00 UTC (see
// vercel.json). Refreshes beta invitee statuses from database truth first
// (someone may have signed up since the founder last opened the admin Beta
// page), then sends the two one-shot nudges:
//   - invited >=5 days with no signup  -> "your invite is waiting"
//   - signed up >=7 days with no first project -> "need a hand?"
// The `*_sent_at` stamp is written right after each successful send, so a
// failed send is retried on the next daily run and a sent nudge can never
// repeat — the selection helper only ever picks rows with a null stamp.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` — we 401
// anything else so this can't be a public trigger for the email quota.
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

  const synced = await syncBetaInviteeStatuses(db, now);
  const { activationHelp, signupReminders } = selectBetaNudges(
    await listBetaNudgeCandidates(db),
    now,
  );

  let remindersSent = 0;
  let helpSent = 0;
  let failed = 0;

  for (const invitee of signupReminders) {
    try {
      await sendBetaSignupReminderEmail(invitee.email, { name: invitee.name });
      await markBetaNudgeSent(db, invitee.id, "signup_reminder", new Date());
      remindersSent += 1;
    } catch (error) {
      failed += 1;
      console.warn("[beta-nudges] signup reminder failed", invitee.email, error);
    }
  }

  for (const invitee of activationHelp) {
    try {
      await sendBetaActivationHelpEmail(invitee.email, { name: invitee.name });
      await markBetaNudgeSent(db, invitee.id, "activation_help", new Date());
      helpSent += 1;
    } catch (error) {
      failed += 1;
      console.warn("[beta-nudges] activation help failed", invitee.email, error);
    }
  }

  return NextResponse.json({
    ok: true,
    activated: synced.activated,
    signedUp: synced.signedUp,
    remindersSent,
    helpSent,
    failed,
  });
}
