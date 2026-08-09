import type { Db } from "@skitza/db";

import { sendSessionCalendarEmail } from "~/server/email/send";
import {
  createGoogleCalendarLinkedEventReader,
  createGoogleCalendarProvider,
  createGoogleCalendarRepository,
  createGoogleCalendarWorkerAccess,
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar";
import { processCalendarSyncJobs } from "./delivery";
import { processGoogleCalendarSyncJobs } from "./google-delivery";
import { processGoogleCalendarReconciliations } from "./google-reconciliation";
import { calendarDeliveryRepository } from "./repository";
import { sessionBookingRepository } from "../domain/session-booking/db";
import { applyGoogleCalendarSessionReconciliation } from "../domain/session-booking/service";

/** Bounded wake used after a verified webhook has durably enqueued known-link jobs. */
export async function reconcileGoogleCalendarBestEffort(db: Db): Promise<void> {
  if (!isGoogleCalendarServerConfigured()) return;
  try {
    const config = loadGoogleCalendarServerConfig();
    const provider = createGoogleCalendarProvider({ config });
    const googleRepository = createGoogleCalendarRepository(db);
    const bookingRepository = sessionBookingRepository(db);
    await processGoogleCalendarReconciliations(
      {
        repository: calendarDeliveryRepository(db),
        reader: createGoogleCalendarLinkedEventReader({
          repository: googleRepository,
          provider,
          config,
        }),
        apply: (prepared, lookup, input) =>
          applyGoogleCalendarSessionReconciliation(bookingRepository, prepared, lookup, input),
      },
      { limit: 10 },
    );
  } catch {
    console.error("[calendar] Google Calendar reconciliation wake failed");
  }
}

export async function deliverCalendarSyncJobBestEffort(
  db: Db,
  jobId: string | null,
): Promise<void> {
  if (!jobId) return;
  try {
    const deliveryRepository = calendarDeliveryRepository(db);
    let fallbackJobIds: readonly string[] = [];
    if (isGoogleCalendarServerConfigured()) {
      const config = loadGoogleCalendarServerConfig();
      const provider = createGoogleCalendarProvider({ config });
      const googleRepository = createGoogleCalendarRepository(db);
      const google = await processGoogleCalendarSyncJobs(
        {
          repository: deliveryRepository,
          provider,
          access: createGoogleCalendarWorkerAccess({
            repository: googleRepository,
            provider,
            config,
          }),
        },
        { jobId, limit: 1 },
      );
      fallbackJobIds = google.fallbackJobIds;
    }
    await processCalendarSyncJobs(deliveryRepository, sendSessionCalendarEmail, {
      jobId,
      limit: 1,
    });
    for (const fallbackJobId of fallbackJobIds) {
      await processCalendarSyncJobs(deliveryRepository, sendSessionCalendarEmail, {
        jobId: fallbackJobId,
        limit: 1,
      });
    }
  } catch {
    // The durable job remains recoverable by the scheduled worker. Keep
    // recipient/provider details out of request logs.
    console.error("[calendar] immediate invitation delivery failed");
  }
}
