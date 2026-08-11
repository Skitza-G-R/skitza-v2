"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";
import type { GoogleCalendarBusyWeekView } from "~/server/google-calendar/busy-week";

import type {
  GoogleCalendarActionResult,
  GoogleCalendarSelection,
} from "./google-calendar-ui-model";

const CALENDAR_PATH = "/dashboard/calendar";

function safeFailure(error: unknown): GoogleCalendarActionResult {
  if (error instanceof TRPCError) {
    if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
      return { ok: false, reason: "permission_required" };
    }
    if (error.code === "BAD_REQUEST") {
      return { ok: false, reason: "invalid_selection" };
    }
    if (error.code === "PRECONDITION_FAILED") {
      return { ok: false, reason: "permission_required" };
    }
  }
  return { ok: false, reason: "unavailable" };
}

async function producerCaller() {
  const { userId } = await auth();
  return userId ? appRouter.createCaller({ userId }) : null;
}

function unavailableBusyWeek(): GoogleCalendarBusyWeekView {
  return {
    protection: "skitza_only",
    health: "unavailable",
    intervals: [],
  };
}

/** Loads one live, producer-scoped week without exposing Google event data. */
export async function loadGoogleCalendarBusyWeek(input: {
  weekStart: string;
}): Promise<GoogleCalendarBusyWeekView> {
  const caller = await producerCaller();
  if (!caller) return unavailableBusyWeek();
  try {
    return await caller.googleCalendar.busyWeek(input);
  } catch {
    return unavailableBusyWeek();
  }
}

export async function saveGoogleCalendarSelection(
  selection: GoogleCalendarSelection,
): Promise<GoogleCalendarActionResult> {
  if (!selection.destinationSelectionKey || selection.busySelectionKeys.length < 1) {
    return { ok: false, reason: "invalid_selection" };
  }
  const caller = await producerCaller();
  if (!caller) return { ok: false, reason: "permission_required" };
  try {
    await caller.googleCalendar.selection.save({
      destinationCalendarId: selection.destinationSelectionKey,
      availabilityCalendarIds: [...selection.busySelectionKeys],
    });
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarActionResult> {
  const caller = await producerCaller();
  if (!caller) return { ok: false, reason: "permission_required" };
  try {
    await caller.googleCalendar.disconnect();
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function refreshGoogleCalendarCalendars(): Promise<GoogleCalendarActionResult> {
  const caller = await producerCaller();
  if (!caller) return { ok: false, reason: "permission_required" };
  try {
    await caller.googleCalendar.calendars();
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function repairGoogleCalendarSync(input: {
  forcePending: boolean;
}): Promise<GoogleCalendarActionResult> {
  const caller = await producerCaller();
  if (!caller) return { ok: false, reason: "permission_required" };
  try {
    await caller.googleCalendar.repair(input);
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}
