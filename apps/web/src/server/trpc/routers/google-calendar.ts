import { eq, producers } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  googleCalendarBusyWeekWindow,
  presentGoogleCalendarBusyWeek,
} from "~/server/google-calendar/busy-week";
import { readGoogleCalendarBusyIntervals } from "~/server/google-calendar/busy-reader";
import {
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar/config";
import {
  createGoogleCalendarProvider,
  GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS,
} from "~/server/google-calendar/provider";
import {
  createGoogleCalendarRepository,
  dismissGoogleCalendarSyncWarning,
} from "~/server/google-calendar/repository-drizzle";
import { isGoogleCalendarOAuthBrowserBinding } from "~/server/google-calendar/oauth";
import {
  createGoogleCalendarService,
  GoogleCalendarServiceError,
  type GoogleCalendarService,
} from "~/server/google-calendar/service";
import { repairProducerCalendarSyncBestEffort } from "~/server/calendar/drain";

import { producerProcedure } from "../producer-procedure";
import { router } from "../init";

const oauthIntent = z.enum(["connect", "reconnect", "switch_account"]);
const oauthCompletionInput = z.object({
  stateToken: z.string().min(1).max(1_024),
  browserBinding: z.string().refine(isGoogleCalendarOAuthBrowserBinding),
  code: z.string().min(1).max(4_096).optional(),
  providerError: z.string().min(1).max(128).optional(),
});
const selectionInput = z.object({
  destinationCalendarId: z.string().uuid(),
  // SK-280: mirror the Google freeBusy hard limit — see saveSelection.
  availabilityCalendarIds: z
    .array(z.string().uuid())
    .min(1)
    .max(GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS),
});
const busyWeekInput = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});
const dismissWarningInput = z.object({
  bookingId: z.string().uuid(),
  syncState: z.enum(["not_synced", "missing", "conflict"]),
  stateChangedAtIso: z.string().datetime(),
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

  busyWeek: producerProcedure.input(busyWeekInput).query(async ({ ctx, input }) => {
    const [producer] = await ctx.db
      .select({ timeZone: producers.timezone })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!producer) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

    let window: ReturnType<typeof googleCalendarBusyWeekWindow>;
    try {
      window = googleCalendarBusyWeekWindow({
        weekStart: input.weekStart,
        timeZone: producer.timeZone,
      });
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid calendar week" });
    }

    const result = await readGoogleCalendarBusyIntervals({
      db: ctx.db,
      producerId: ctx.producerId,
      timeMin: window.timeMin,
      timeMax: window.timeMax,
    });
    return presentGoogleCalendarBusyWeek(result);
  }),

  calendars: producerProcedure.query(({ ctx }) =>
    callGoogleCalendar(() => serviceForDatabase(ctx.db).listCalendars(ctx.producerId)),
  ),

  repair: producerProcedure
    .input(z.object({ forcePending: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const repaired = await repairProducerCalendarSyncBestEffort(
        ctx.db,
        ctx.producerId,
        input.forcePending
          ? { forcePending: true, actorIdentity: ctx.userId }
          : { forcePending: false },
      );
      if (!repaired) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Google Calendar is unavailable",
        });
      }
      return { ok: true as const };
    }),

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

  warning: router({
    clear: producerProcedure.input(dismissWarningInput).mutation(async ({ ctx, input }) => {
      await dismissGoogleCalendarSyncWarning(ctx.db, {
        producerId: ctx.producerId,
        bookingId: input.bookingId,
        syncState: input.syncState,
        syncStateChangedAt: new Date(input.stateChangedAtIso),
        dismissedAt: new Date(),
      });
      return { ok: true as const };
    }),
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
          browserBinding: z.string().refine(isGoogleCalendarOAuthBrowserBinding),
          switchConfirmed: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        callGoogleCalendar(() =>
          serviceForDatabase(ctx.db).beginOAuth({
            producerId: ctx.producerId,
            intent: input.intent,
            browserBinding: input.browserBinding,
            ...(input.switchConfirmed !== undefined
              ? { switchConfirmed: input.switchConfirmed }
              : {}),
          }),
        ),
      ),

    complete: producerProcedure.input(oauthCompletionInput).mutation(({ ctx, input }) =>
      callGoogleCalendar(async () => {
        const result = await serviceForDatabase(ctx.db).completeOAuth({
          producerId: ctx.producerId,
          stateToken: input.stateToken,
          browserBinding: input.browserBinding,
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.providerError !== undefined ? { providerError: input.providerError } : {}),
        });
        return { status: result.status };
      }),
    ),
  }),
});
