import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import {
  processCalendarSyncJobs,
  type ProcessCalendarSyncJobsResult,
} from "~/server/calendar/delivery";
import {
  processGoogleCalendarSyncJobs,
  type ProcessGoogleCalendarSyncJobsResult,
} from "~/server/calendar/google-delivery";
import {
  processGoogleCalendarReconciliations,
  type ProcessGoogleCalendarReconciliationsResult,
} from "~/server/calendar/google-reconciliation";
import { calendarDeliveryRepository } from "~/server/calendar/repository";
import { applyGoogleCalendarSessionReconciliation } from "~/server/domain/session-booking/service";
import { sessionBookingRepository } from "~/server/domain/session-booking/db";
import { sendSessionCalendarEmail } from "~/server/email/send";
import {
  runSessionReminderSweep,
  type SessionReminderSweepResult,
} from "~/server/calendar/session-reminder-sweep";
import {
  createGoogleCalendarProvider,
  createGoogleCalendarLinkedEventReader,
  createGoogleCalendarRepository,
  createGoogleCalendarService,
  createGoogleCalendarWorkerAccess,
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CalendarCronPhase =
  | "initial_sync"
  | "recovery"
  | "google_setup"
  | "watch_maintenance"
  | "reconciliation"
  | "google_delivery"
  | "fallback_ics"
  | "ics_delivery"
  | "session_reminders";

async function runCalendarCronPhase<T>(
  phase: CalendarCronPhase,
  failedPhases: Set<CalendarCronPhase>,
  fallback: T,
  work: () => Promise<T> | T,
): Promise<T> {
  try {
    return await work();
  } catch {
    failedPhases.add(phase);
    console.error(`[cron] calendar phase failed: ${phase}`);
    return fallback;
  }
}

const EMPTY_GOOGLE_DELIVERY: ProcessGoogleCalendarSyncJobsResult = {
  claimed: 0,
  completed: 0,
  retried: 0,
  terminal: 0,
  leaseLost: 0,
  fallbackEnqueued: 0,
  fallbackJobIds: [],
};

const EMPTY_RECONCILIATION: ProcessGoogleCalendarReconciliationsResult = {
  claimed: 0,
  reconciled: 0,
  unchanged: 0,
  missing: 0,
  conflicts: 0,
  corrected: 0,
  disconnected: 0,
  retried: 0,
  terminal: 0,
  leaseLost: 0,
};

const EMPTY_ICS_DELIVERY: ProcessCalendarSyncJobsResult = {
  claimed: 0,
  completed: 0,
  retried: 0,
  terminal: 0,
  leaseLost: 0,
};

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
    const bookingRepository = sessionBookingRepository(db);
    const failedPhases = new Set<CalendarCronPhase>();
    const initialSync = await runCalendarCronPhase(
      "initial_sync",
      failedPhases,
      { scanned: 0, linksCreated: 0, jobsEnqueued: 0, jobIds: [] as string[] },
      () => googleRepository.enqueueFutureConfirmedEvents({ now: new Date(), limit: 100 }),
    );
    const recovery = await runCalendarCronPhase(
      "recovery",
      failedPhases,
      { scanned: 0, jobsEnqueued: 0 },
      () =>
        deliveryRepository.enqueueGoogleReconciliationRecovery({
          now: new Date(),
          limit: 100,
        }),
    );
    let google = EMPTY_GOOGLE_DELIVERY;
    let reconciliation = EMPTY_RECONCILIATION;
    let watchMaintenance = { scanned: 0, created: 0, renewed: 0, active: 0, failed: 0 };
    const googleRuntime = isGoogleCalendarServerConfigured()
      ? await runCalendarCronPhase("google_setup", failedPhases, null, () => {
          const config = loadGoogleCalendarServerConfig();
          return { config, provider: createGoogleCalendarProvider({ config }) };
        })
      : null;
    if (googleRuntime) {
      const { config, provider } = googleRuntime;
      watchMaintenance = await runCalendarCronPhase(
        "watch_maintenance",
        failedPhases,
        watchMaintenance,
        () =>
          createGoogleCalendarService({
            repository: googleRepository,
            provider,
            config,
          }).maintainWatches({ limit: 25 }),
      );
      reconciliation = await runCalendarCronPhase(
        "reconciliation",
        failedPhases,
        EMPTY_RECONCILIATION,
        () =>
          processGoogleCalendarReconciliations({
            repository: deliveryRepository,
            reader: createGoogleCalendarLinkedEventReader({
              repository: googleRepository,
              provider,
              config,
            }),
            apply: (prepared, lookup, applyInput) =>
              applyGoogleCalendarSessionReconciliation(
                bookingRepository,
                prepared,
                lookup,
                applyInput,
              ),
          }),
      );
      google = await runCalendarCronPhase(
        "google_delivery",
        failedPhases,
        EMPTY_GOOGLE_DELIVERY,
        () =>
          processGoogleCalendarSyncJobs({
            repository: deliveryRepository,
            provider,
            access: createGoogleCalendarWorkerAccess({
              repository: googleRepository,
              provider,
              config,
            }),
          }),
      );
    }
    for (const fallbackJobId of google.fallbackJobIds) {
      await runCalendarCronPhase("fallback_ics", failedPhases, EMPTY_ICS_DELIVERY, () =>
        processCalendarSyncJobs(deliveryRepository, sendSessionCalendarEmail, {
          jobId: fallbackJobId,
          limit: 1,
        }),
      );
    }
    const ics = await runCalendarCronPhase("ics_delivery", failedPhases, EMPTY_ICS_DELIVERY, () =>
      processCalendarSyncJobs(deliveryRepository, sendSessionCalendarEmail),
    );
    // SK-280: the Hobby plan caps deployments at two cron jobs, so the
    // held-expiry + reminder sweep (formerly the never-registered
    // /api/cron/session-reminders) rides along here. Its windows are
    // cadence-independent; see session-reminder-sweep.ts for the exact
    // semantics on a daily tick.
    const EMPTY_REMINDER_SWEEP: SessionReminderSweepResult = {
      scanned: { held: 0, twentyFour: 0, one: 0 },
      expiredHeld: 0,
      sent: { twentyFour: 0, one: 0 },
    };
    const sessionReminders = await runCalendarCronPhase(
      "session_reminders",
      failedPhases,
      EMPTY_REMINDER_SWEEP,
      () => runSessionReminderSweep(db, new Date()),
    );
    const googleCounters = {
      claimed: google.claimed,
      completed: google.completed,
      retried: google.retried,
      terminal: google.terminal,
      leaseLost: google.leaseLost,
      fallbackEnqueued: google.fallbackEnqueued,
    };
    const body = {
      ok: failedPhases.size === 0,
      initialSync: {
        scanned: initialSync.scanned,
        linksCreated: initialSync.linksCreated,
        jobsEnqueued: initialSync.jobsEnqueued,
      },
      recovery,
      watchMaintenance,
      reconciliation,
      google: googleCounters,
      ics,
      sessionReminders,
      ...(failedPhases.size > 0 ? { failedPhases: [...failedPhases] } : {}),
    };
    return NextResponse.json(body, { status: failedPhases.size > 0 ? 500 : 200 });
  } catch {
    // Keep database/provider details and recipient data out of route responses
    // and logs while retaining one operational signal for the failed run.
    console.error("[cron] calendar sync worker failed");
    return NextResponse.json({ ok: false, reason: "calendar delivery failed" }, { status: 500 });
  }
}
