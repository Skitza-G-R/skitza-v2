import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar/config";
import { createGoogleCalendarProvider } from "~/server/google-calendar/provider";
import { createGoogleCalendarRepository } from "~/server/google-calendar/repository-drizzle";
import {
  createGoogleCalendarService,
  GoogleCalendarServiceError,
  type GoogleCalendarService,
} from "~/server/google-calendar/service";

import { producerProcedure } from "../producer-procedure";
import { router } from "../init";

const oauthIntent = z.enum(["connect", "reconnect", "switch_account"]);
const selectionInput = z.object({
  destinationCalendarId: z.string().uuid(),
  availabilityCalendarIds: z.array(z.string().uuid()).min(1).max(10_000),
});

function serviceForDatabase(
  db: Parameters<typeof createGoogleCalendarRepository>[0],
): GoogleCalendarService {
  if (!isGoogleCalendarServerConfigured()) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  }
  const config = loadGoogleCalendarServerConfig();
  return createGoogleCalendarService({
    repository: createGoogleCalendarRepository(db),
    provider: createGoogleCalendarProvider({ config }),
    config,
  });
}

async function callGoogleCalendar<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof GoogleCalendarServiceError)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Google Calendar is unavailable",
      });
    }

    const code =
      error.code === "stale_connection" || error.code === "wrong_account"
        ? "CONFLICT"
        : error.code === "reconnect_required" || error.code === "refresh_token_missing"
          ? "PRECONDITION_FAILED"
          : error.code === "provider_unavailable"
            ? "TIMEOUT"
            : error.code === "state_invalid"
              ? "FORBIDDEN"
              : "BAD_REQUEST";
    throw new TRPCError({ code, message: error.message });
  }
}

export const googleCalendarRouter = router({
  status: producerProcedure.query(({ ctx }) =>
    callGoogleCalendar(() => serviceForDatabase(ctx.db).status(ctx.producerId)),
  ),

  calendars: producerProcedure.query(({ ctx }) =>
    callGoogleCalendar(() => serviceForDatabase(ctx.db).listCalendars(ctx.producerId)),
  ),

  selection: router({
    save: producerProcedure.input(selectionInput).mutation(({ ctx, input }) =>
      callGoogleCalendar(async () => {
        await serviceForDatabase(ctx.db).saveSelection({
          producerId: ctx.producerId,
          destinationCalendarId: input.destinationCalendarId,
          availabilityCalendarIds: input.availabilityCalendarIds,
        });
        return { ok: true as const };
      }),
    ),
  }),

  disconnect: producerProcedure.mutation(({ ctx }) =>
    callGoogleCalendar(async () => {
      await serviceForDatabase(ctx.db).disconnect(ctx.producerId);
      return { ok: true as const };
    }),
  ),

  oauth: router({
    begin: producerProcedure
      .input(
        z.object({
          intent: oauthIntent,
          switchConfirmed: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        callGoogleCalendar(() =>
          serviceForDatabase(ctx.db).beginOAuth({
            producerId: ctx.producerId,
            intent: input.intent,
            ...(input.switchConfirmed !== undefined
              ? { switchConfirmed: input.switchConfirmed }
              : {}),
          }),
        ),
      ),

    complete: producerProcedure
      .input(
        z.object({
          stateToken: z.string().min(1).max(1_024),
          code: z.string().min(1).max(4_096).optional(),
          providerError: z.string().min(1).max(128).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        callGoogleCalendar(() =>
          serviceForDatabase(ctx.db).completeOAuth({
            producerId: ctx.producerId,
            stateToken: input.stateToken,
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.providerError !== undefined ? { providerError: input.providerError } : {}),
          }),
        ),
      ),
  }),
});
