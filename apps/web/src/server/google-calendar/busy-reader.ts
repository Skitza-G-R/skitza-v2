import type { Db } from "@skitza/db";

import { loadGoogleCalendarServerConfig } from "./config";
import { createGoogleCalendarProvider } from "./provider";
import { createGoogleCalendarRepository } from "./repository-drizzle";
import { createGoogleCalendarService, type GoogleCalendarBusyResult } from "./service";

/**
 * Fail-open application entry point. Call it before a booking transaction or
 * lock, then pass only the returned UTC intervals into the booking domain.
 */
export async function readGoogleCalendarBusyIntervals(
  input: Readonly<{
    db: Db;
    producerId: string;
    timeMin: Date;
    timeMax: Date;
  }>,
): Promise<GoogleCalendarBusyResult> {
  try {
    const config = loadGoogleCalendarServerConfig();
    return await createGoogleCalendarService({
      repository: createGoogleCalendarRepository(input.db),
      provider: createGoogleCalendarProvider({ config }),
      config,
    }).busyIntervals({
      producerId: input.producerId,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
    });
  } catch {
    // SK-280: reaching this catch means the Google integration is not
    // configured at all — nothing to protect, so no reduced-protection nag.
    return {
      protection: "google_aware",
      health: "not_connected",
      intervals: [],
    };
  }
}
