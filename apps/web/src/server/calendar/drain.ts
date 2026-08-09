import type { Db } from "@skitza/db";

import { sendSessionCalendarEmail } from "~/server/email/send";
import {
  createGoogleCalendarProvider,
  createGoogleCalendarRepository,
  createGoogleCalendarWorkerAccess,
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar";
import { processCalendarSyncJobs } from "./delivery";
import { processGoogleCalendarSyncJobs } from "./google-delivery";
import { calendarDeliveryRepository } from "./repository";

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
