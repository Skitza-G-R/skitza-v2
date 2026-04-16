import { NextResponse } from "next/server";
import { createDb, sql } from "@skitza/db";

// Health endpoint for uptime monitoring. Returns 200 + small JSON when
// the web app can reach Postgres; 503 otherwise. We issue `SELECT 1`
// (cheapest possible trip) rather than doing a real schema query so a
// slow/broken DB surfaces quickly without dragging in app logic.
//
// Intentionally NOT cached at the edge — monitors need fresh state.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json(
      { ok: false, reason: "missing DATABASE_URL" },
      { status: 503 },
    );
  }
  try {
    const db = createDb(dbUrl);
    await db.execute(sql`select 1`);
    return NextResponse.json(
      {
        ok: true,
        service: "skitza-web",
        db: "reachable",
        latencyMs: Date.now() - startedAt,
      },
      {
        status: 200,
        headers: {
          // Prevent any layer from caching this — monitors want the
          // current truth on every call.
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { ok: false, reason: message.slice(0, 120) }, // trim; don't leak full pg error strings
      { status: 503 },
    );
  }
}
