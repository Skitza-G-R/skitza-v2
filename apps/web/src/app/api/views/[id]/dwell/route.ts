import { createDb, eq, magicLinkViews } from "@skitza/db";
import { NextResponse } from "next/server";
import { z } from "zod";

// Beacon endpoint: `navigator.sendBeacon` from the public portfolio fires
// here on `visibilitychange → hidden` with the view's dwell time in ms.
//
// Runtime: node (for Neon driver). Edge would work too but Drizzle's edge
// import path is slightly different and the latency difference on a
// fire-and-forget PATCH is not worth the complexity.
export const runtime = "nodejs";

// Security model — this endpoint is public (unauthenticated):
// * `viewId` is the UUIDv4 PK of a view row. Non-enumerable; an attacker
//   who doesn't already hold a view URL can't forge one.
// * We WRITE ONLY when `dwell_ms IS NULL`. This means the first
//   sendBeacon wins; replay attempts from someone scraping a view URL
//   can't overwrite legitimate data.
// * We clamp `dwellMs` to a sane window. Anyone beaconing > 2h is either
//   sleep-typing or malicious; either way we discard.
// * We never reveal whether a viewId exists. All failure paths return
//   the same 204 — this is analytics, not an oracle.
const Body = z.object({
  // Round to nearest 100ms client-side to reduce analytics noise and
  // shave a few bytes off the beacon payload. We still cap server-side.
  dwellMs: z.number().int().min(0).max(2 * 60 * 60 * 1000), // 2 hours
});

const ParamSchema = z.object({ id: z.string().uuid() });

async function handle(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const paramParse = ParamSchema.safeParse({ id: rawId });
  if (!paramParse.success) return new NextResponse(null, { status: 204 });
  const id = paramParse.data.id;

  let payload: unknown;
  try {
    // sendBeacon sends as Blob; fetch-based calls send as JSON. Accept either.
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json") || contentType.includes("text/plain")) {
      payload = await req.json();
    } else {
      const text = await req.text();
      payload = text ? JSON.parse(text) : null;
    }
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return new NextResponse(null, { status: 204 });
  const db = createDb(dbUrl);

  // First-write-wins: only set dwell_ms when still NULL. Drizzle doesn't
  // expose a composite WHERE on UPDATE via the typed API with ease, so
  // we fetch-then-conditional-update. Small race window (two rapid
  // beacons could both read NULL before either writes), acceptable for
  // dwell analytics.
  const [row] = await db
    .select({ id: magicLinkViews.id, dwellMs: magicLinkViews.dwellMs })
    .from(magicLinkViews)
    .where(eq(magicLinkViews.id, id))
    .limit(1);
  if (!row || row.dwellMs !== null) return new NextResponse(null, { status: 204 });

  await db
    .update(magicLinkViews)
    .set({ dwellMs: parsed.data.dwellMs })
    .where(eq(magicLinkViews.id, id));

  return new NextResponse(null, { status: 204 });
}

// Both POST (sendBeacon default) and PATCH (semantic for "update this
// resource") so either works from the client — we pick POST below for
// sendBeacon compatibility, but the endpoint accepts PATCH too for
// future fetch-based callers.
export { handle as POST, handle as PATCH };
