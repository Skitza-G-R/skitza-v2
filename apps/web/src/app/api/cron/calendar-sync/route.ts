import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import { processCalendarSyncJobs } from "~/server/calendar/delivery";
import {
  processGoogleCalendarSyncJobs,
  type ProcessGoogleCalendarSyncJobsResult,
} from "~/server/calendar/google-delivery";
import { calendarDeliveryRepository } from "~/server/calendar/repository";
import { sendSessionCalendarEmail } from "~/server/email/send";
import {
  createGoogleCalendarProvider,
  createGoogleCalendarRepository,
  createGoogleCalendarWorkerAccess,
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar";

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
    const deliveryRepository = calendarDeliveryRepository(db);
    const googleRepository = createGoogleCalendarRepository(db);
    const initialSync = await googleRepository.enqueueFutureConfirmedEvents({
      now: new Date(),
      limit: 100,
    });
    let google: ProcessGoogleCalendarSyncJobsResult = {
      claimed: 0,
      completed: 0,
      retried: 0,
      terminal: 0,
      leaseLost: 0,
      fallbackEnqueued: 0,
      fallbackJobIds: [] as string[],
    };
    if (isGoogleCalendarServerConfigured()) {
      const config = loadGoogleCalendarServerConfig();
      const provider = createGoogleCalendarProvider({ config });
      google = await processGoogleCalendarSyncJobs({
        repository: deliveryRepository,
        provider,
        access: createGoogleCalendarWorkerAccess({
          repository: googleRepository,
          provider,
          config,
        }),
      });
    }
    for (const fallbackJobId of google.fallbackJobIds) {
      await processCalendarSyncJobs(deliveryRepository, sendSessionCalendarEmail, {
        jobId: fallbackJobId,
        limit: 1,
      });
    }
    const ics = await processCalendarSyncJobs(deliveryRepository, sendSessionCalendarEmail);
    const googleCounters = {
      claimed: google.claimed,
      completed: google.completed,
      retried: google.retried,
      terminal: google.terminal,
      leaseLost: google.leaseLost,
      fallbackEnqueued: google.fallbackEnqueued,
    };
    return NextResponse.json({
      ok: true,
      initialSync: {
        scanned: initialSync.scanned,
        linksCreated: initialSync.linksCreated,
        jobsEnqueued: initialSync.jobsEnqueued,
      },
      google: googleCounters,
      ics,
    });
  } catch {
    // Keep database/provider details and recipient data out of route responses
    // and logs while retaining one operational signal for the failed run.
    console.error("[cron] calendar sync worker failed");
    return NextResponse.json({ ok: false, reason: "calendar delivery failed" }, { status: 500 });
  }
}
