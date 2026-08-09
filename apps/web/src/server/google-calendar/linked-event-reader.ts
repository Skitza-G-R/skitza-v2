import type { GoogleCalendarPreparedLink } from "../calendar/google-delivery";
import type { GoogleCalendarServerConfig } from "./config";
import {
  GoogleCalendarProviderError,
  type GoogleCalendarLinkedEventLookup,
  type GoogleCalendarProvider,
} from "./provider";
import type { GoogleCalendarRepository } from "./repository";
import { createGoogleCalendarWorkerAccess } from "./worker-access";

export type GoogleCalendarLinkedEventReadResult =
  | Readonly<{ status: "ready"; lookup: GoogleCalendarLinkedEventLookup }>
  | Readonly<{ status: "unavailable" | "reconnect_required" | "disconnected" }>;

export type GoogleCalendarLinkedEventReader = (
  link: GoogleCalendarPreparedLink,
  input: Readonly<{ artistEmail: string; ifNoneMatch?: string }>,
) => Promise<GoogleCalendarLinkedEventReadResult>;

/**
 * Reconciliation receives a narrow reader instead of credentials or raw
 * provider calendar IDs. Token refresh, decryption, and permission failure
 * remain inside the Google Calendar boundary.
 */
export function createGoogleCalendarLinkedEventReader(
  input: Readonly<{
    repository: GoogleCalendarRepository;
    provider: GoogleCalendarProvider;
    config: GoogleCalendarServerConfig;
    now?: () => Date;
  }>,
): GoogleCalendarLinkedEventReader {
  const access = createGoogleCalendarWorkerAccess(input);
  return async (link, read) => {
    const ready = await access(link);
    if (ready.status !== "ready") return ready;
    try {
      const lookup = await input.provider.getLinkedEvent(ready.accessToken, {
        calendarId: ready.calendarId,
        eventId: link.providerEventId,
        artistEmail: read.artistEmail,
        ...(read.ifNoneMatch === undefined ? {} : { ifNoneMatch: read.ifNoneMatch }),
      });
      return { status: "ready", lookup };
    } catch (error) {
      if (error instanceof GoogleCalendarProviderError && error.code === "access_unauthorized") {
        await ready.markReconnectRequired();
        return { status: "reconnect_required" };
      }
      throw error;
    }
  };
}
