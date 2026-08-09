import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import { processCalendarSyncJobs } from "~/server/calendar/delivery";
import { calendarDeliveryRepository } from "~/server/calendar/repository";
import { sendSessionCalendarEmail } from "~/server/email/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, reason: "missing CRON_SECRET" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, reason: "missing DATABASE_URL" }, { status: 503 });
  }

  try {
    const db = createDb(databaseUrl);
    const result = await processCalendarSyncJobs(
      calendarDeliveryRepository(db),
      sendSessionCalendarEmail,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch {
    // Keep database/provider details and recipient data out of route responses
    // and logs while retaining one operational signal for the failed run.
    console.error("[cron] calendar sync worker failed");
    return NextResponse.json({ ok: false, reason: "calendar delivery failed" }, { status: 500 });
  }
}
