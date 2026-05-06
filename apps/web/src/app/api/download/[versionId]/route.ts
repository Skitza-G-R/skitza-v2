import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { NextResponse } from "next/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Same-origin download proxy for track audio. The L3 song-page tried
// a client-side fetch + blob in round 4, but R2's public bucket
// doesn't honour CORS for our preview origins, so the fetch threw
// and the fallback opened the file in a new tab (browser's native
// audio player on a black background). The founder asked: "the
// download button should simply download the file."
//
// Routing through this server endpoint dodges CORS entirely:
//   - The Node fetch is server-to-server (no preflight, no Origin).
//   - We re-emit the bytes with Content-Disposition: attachment
//     so the browser writes them to disk instead of inlining.
//
// Auth is enforced through the existing producer.music.detail tRPC
// procedure -- the same path used by the L3 page itself, so we cannot
// download a version we could not load. NOT_FOUND is bridged to a
// 404 to avoid leaking which IDs exist for other producers.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<NextResponse> {
  const { versionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const caller = appRouter.createCaller({ userId });
  let detail: Awaited<ReturnType<typeof caller.producer.music.detail>>;
  try {
    detail = await caller.producer.music.detail({ versionId });
  } catch (e) {
    if (e instanceof TRPCError) {
      if (e.code === "NOT_FOUND") {
        return new NextResponse("Not found", { status: 404 });
      }
      if (e.code === "FORBIDDEN" || e.code === "UNAUTHORIZED") {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
    throw e;
  }

  const version = detail.versions.find((v) => v.id === versionId);
  if (!version || !version.audioUrl) {
    return new NextResponse("Not found", { status: 404 });
  }

  const upstream = await fetch(version.audioUrl);
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Upstream error", { status: 502 });
  }

  const extMatch = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(version.audioUrl);
  const ext = extMatch?.[1]?.toLowerCase() ?? "audio";
  const safeTitle = sanitizeFilename(detail.track.title);
  const safeLabel = sanitizeFilename(version.label);
  const filename = `${safeTitle} - ${safeLabel}.${ext}`;

  const headers = new Headers();
  const upstreamType = upstream.headers.get("Content-Type") ?? "application/octet-stream";
  headers.set("Content-Type", upstreamType);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  const upstreamLength = upstream.headers.get("Content-Length");
  if (upstreamLength) headers.set("Content-Length", upstreamLength);
  headers.set("Cache-Control", "private, no-store");

  return new NextResponse(upstream.body, { status: 200, headers });
}

function sanitizeFilename(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "audio";
}
