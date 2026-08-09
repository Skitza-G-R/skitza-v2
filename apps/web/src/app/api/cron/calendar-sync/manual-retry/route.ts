import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  calendarManualRetryRepository,
  CalendarManualRetryError,
  manualRetryCalendarSyncJob,
} from "~/server/calendar/manual-retry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const manualRetryInput = z.object({
  jobId: z.string().uuid(),
  producerId: z.string().uuid(),
  operationKey: z.string().trim().min(1).max(200),
  actorIdentity: z.string().trim().min(1).max(200),
});

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, reason: "missing CRON_SECRET" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, reason: "missing DATABASE_URL" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid request" }, { status: 400 });
  }
  const parsed = manualRetryInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid request" }, { status: 400 });
  }

  try {
    const result = await manualRetryCalendarSyncJob(
      calendarManualRetryRepository(createDb(databaseUrl)),
      parsed.data,
    );
    return NextResponse.json({
      ok: true,
      jobId: result.jobId,
      producerId: result.producerId,
      retryNumber: result.retryNumber,
      replayed: result.replayed,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof CalendarManualRetryError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ ok: false, reason: "not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: false, reason: "retry conflict" }, { status: 409 });
    }
    console.error("[cron] calendar manual retry failed");
    return NextResponse.json({ ok: false, reason: "calendar retry failed" }, { status: 500 });
  }
}
