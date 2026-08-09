import type { Db } from "@skitza/db";

import { sendSessionCalendarEmail } from "~/server/email/send";
import { processCalendarSyncJobs } from "./delivery";
import { calendarDeliveryRepository } from "./repository";

export async function deliverCalendarSyncJobBestEffort(
  db: Db,
  jobId: string | null,
): Promise<void> {
  if (!jobId) return;
  try {
    await processCalendarSyncJobs(calendarDeliveryRepository(db), sendSessionCalendarEmail, {
      jobId,
      limit: 1,
    });
  } catch {
    // The durable job remains recoverable by the scheduled worker. Keep
    // recipient/provider details out of request logs.
    console.error("[calendar] immediate invitation delivery failed");
  }
}
