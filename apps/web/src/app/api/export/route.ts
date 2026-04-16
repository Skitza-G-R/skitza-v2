import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Streaming-friendly export endpoint. Returns the producer's full data
// as a downloadable JSON attachment. Auth-gated via Clerk — the same
// cookie that grants dashboard access.
//
// No cache headers intentional; each fetch must be fresh (producer may
// have just added a track + expect it to appear).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await appRouter.createCaller({ userId }).producer.export();
    const filename = `skitza-export-${payload.profile.slug}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    // Don't leak internal failures. Logs on Vercel will carry the
    // underlying stack for us.
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }
}
