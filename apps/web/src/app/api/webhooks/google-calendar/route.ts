import { createDb } from "@skitza/db";
import { after } from "next/server";

import { reconcileGoogleCalendarBestEffort } from "~/server/calendar/drain";
import {
  acceptGoogleCalendarWebhook,
  createGoogleCalendarWebhookRepository,
  isGoogleCalendarServerConfigured,
} from "~/server/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function empty(status: number): Response {
  return new Response(null, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!isGoogleCalendarServerConfigured()) return empty(204);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return empty(503);

  try {
    const db = createDb(databaseUrl);
    const repository = createGoogleCalendarWebhookRepository(db);
    const accepted = await acceptGoogleCalendarWebhook({ headers: request.headers, repository });
    if (accepted.jobsEnqueued > 0) {
      after(() => reconcileGoogleCalendarBestEffort(db));
    }
    return empty(204);
  } catch {
    // Provider identifiers, channel tokens, and event details must never reach logs.
    console.error("[google-calendar] webhook enqueue failed");
    return empty(500);
  }
}
