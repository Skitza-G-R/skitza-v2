import type { Db } from "@skitza/db";

import {
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar/config";
import { createGoogleCalendarProvider } from "~/server/google-calendar/provider";
import { createGoogleCalendarRepository } from "~/server/google-calendar/repository-drizzle";
import { createGoogleCalendarService } from "~/server/google-calendar/service";

import { AccountClosureTaskError, type AccountClosureAutomation } from "./account-closure";

/**
 * The existing Calendar disconnect path is the only supported credential
 * cleanup path: it best-effort revokes Google authorization, retires watches,
 * and always commits local token/selection removal. This adapter is inert
 * until an authenticated operator explicitly runs the closure service.
 */
export function createAccountClosureAutomation(db: Db): AccountClosureAutomation {
  return {
    async disconnectGoogleCalendar(producerId) {
      if (!isGoogleCalendarServerConfigured()) {
        throw new AccountClosureTaskError("google_calendar_not_configured");
      }
      const config = loadGoogleCalendarServerConfig();
      const service = createGoogleCalendarService({
        repository: createGoogleCalendarRepository(db),
        provider: createGoogleCalendarProvider({ config }),
        config,
      });
      await service.disconnect(producerId);
    },
  };
}
