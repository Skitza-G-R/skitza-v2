"use server";

import { auth } from "~/server/auth/clerk-identity";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

import type { GoogleCalendarSessionSyncState } from "./google-calendar-session-sync-model";

const CALENDAR_PATH = "/dashboard/calendar";

export type GoogleCalendarSessionActionResult =
  | Readonly<{
      ok: true;
      status: GoogleCalendarSessionSyncState;
      replayed: boolean;
    }>
  | Readonly<{ ok: false; error: string }>;

export type GoogleCalendarSessionStatusResult =
  | Readonly<{ ok: true; status: GoogleCalendarSessionSyncState | null }>
  | Readonly<{ ok: false }>;

async function producerCaller() {
  const { userId } = await auth();
  return userId ? appRouter.createCaller({ userId }) : null;
}

export async function getGoogleCalendarSyncStatus(input: {
  id: string;
}): Promise<GoogleCalendarSessionStatusResult> {
  const caller = await producerCaller();
  if (!caller) return { ok: false };
  try {
    const statuses = await caller.booking.googleCalendarSync.status({ ids: [input.id] });
    return { ok: true, status: statuses[0]?.status ?? null };
  } catch {
    return { ok: false };
  }
}

export async function retryGoogleCalendarSync(input: {
  id: string;
  operationKey: string;
}): Promise<GoogleCalendarSessionActionResult> {
  const caller = await producerCaller();
  if (!caller) return { ok: false, error: "Please sign in to continue." };
  try {
    const result = await caller.booking.googleCalendarSync.retry(input);
    revalidatePath(CALENDAR_PATH);
    return { ok: true, status: result.status, replayed: result.replayed };
  } catch {
    return { ok: false, error: "Could not retry calendar sync. Try again." };
  }
}

export async function restoreGoogleCalendarEvent(input: {
  id: string;
  operationKey: string;
}): Promise<GoogleCalendarSessionActionResult> {
  const caller = await producerCaller();
  if (!caller) return { ok: false, error: "Please sign in to continue." };
  try {
    const result = await caller.booking.googleCalendarSync.restore(input);
    revalidatePath(CALENDAR_PATH);
    return { ok: true, status: result.status, replayed: result.replayed };
  } catch {
    return { ok: false, error: "Could not restore the Google event. Try again." };
  }
}
