import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { SongPage, type SongPageData } from "./song-page";

type PageProps = { params: Promise<{ versionId: string }> };

// L3 song page — full waveform + timestamped comments + version
// switcher + approve button. Routed at /dashboard/music/<versionId>
// so the L1 list deep-links straight here.
//
// Resolves data via the new producer.music.detail tRPC procedure.
// NOT_FOUND surfaces as Next's notFound() — same convention the artist
// /artist/music/[projectId]/page.tsx already uses. We don't differentiate
// "doesn't exist" from "not yours" so we don't leak the existence of
// other producers' track-versions.
export default async function ProducerSongPage({ params }: PageProps) {
  const { versionId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Validate uuid shape early — keeps the tRPC layer's Zod from
  // emitting a generic BAD_REQUEST that we'd then bridge to a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) {
    notFound();
  }

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.producer.music.detail({ versionId });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") {
      notFound();
    }
    throw e;
  }

  // Cross the RSC → client boundary as plain JSON (Date → ISO).
  const wire: SongPageData = {
    track: data.track,
    versions: data.versions.map((v) => ({
      id: v.id,
      label: v.label,
      audioUrl: v.audioUrl,
      durationMs: v.durationMs,
      uploadedAtIso: v.uploadedAt.toISOString(),
      approvedAtIso: v.approvedAt ? v.approvedAt.toISOString() : null,
      // Server-pre-computed peaks ride down with the page payload so
      // Waveform50 renders the real envelope on first frame instead
      // of a client-side decodeAudioData round-trip. Null for legacy
      // rows pre-backfill — Waveform50 falls back to the existing
      // /api/download client decode path.
      peaks: v.peaks,
    })),
    comments: data.comments.map((c) => ({
      id: c.id,
      versionId: c.versionId,
      timeMs: c.timeMs,
      body: c.body,
      fromProducer: c.fromProducer,
      authorName: c.authorName,
      createdAtIso: c.createdAt.toISOString(),
      resolvedAtIso: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    })),
    selectedVersionId: data.selectedVersionId,
  };

  return <SongPage data={wire} />;
}
