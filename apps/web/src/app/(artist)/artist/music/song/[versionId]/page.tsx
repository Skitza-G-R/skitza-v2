import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { SongPage, type SongPageData } from "~/components/music/song-page";
import { appRouter } from "~/server/trpc/routers/_app";

import { l3AddComment, l3ResolveComment } from "./actions";

type PageProps = { params: Promise<{ versionId: string }> };

// L3 song page — full waveform + timestamped comments + version
// switcher. Routed at /artist/music/song/<versionId> so we can carry
// the producer's URL convention without colliding with the existing
// /artist/music/<projectId> L2 route. L1 song cards + L2 tracklist
// rows on the artist side deep-link here once SK-30 ships.
//
// Resolves data via `artist.music.detail` (mirror of the producer's
// `producer.music.detail`, scoped via client_contacts). NOT_FOUND
// surfaces as Next's notFound() — same convention the L2 page uses,
// so we don't differentiate "doesn't exist" from "not yours".
//
// The shared SongPage component renders identically to producer in
// `role="artist"` mode, with two pieces hidden:
//   - Approve button (artists don't approve mixes)
//   - "Open in project room" pill (no clients-projects surface on
//     the artist app).
//
// Server actions for add / resolve comment come from `./actions`
// (NOT from the shared component) so each route's `revalidatePath`
// target stays scoped to its own surface.
export default async function ArtistSongPage({ params }: PageProps) {
  const { versionId } = await params;
  const { userId } = await auth();
  if (!userId) return null;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      versionId,
    )
  ) {
    notFound();
  }

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.artist.music.detail({ versionId });
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

  // Same negative-margin breakout pattern PR2 uses for L2 — the
  // shared SongPage hero is full-bleed by design and the artist
  // shell's `px-4 pt-6 lg:px-10 lg:pt-10` would otherwise leave a
  // cream strip on every edge. Cancel that padding here so the hero
  // spans edge-to-edge and starts flush at the top.
  return (
    <div className="-mx-4 -mt-6 lg:-mx-10 lg:-mt-10">
      <SongPage
        data={wire}
        role="artist"
        actions={{
          addComment: l3AddComment,
          resolveComment: l3ResolveComment,
          // approveVersion intentionally omitted — artists can't
          // approve, and the L3Actions.approveVersion prop is
          // optional.
        }}
      />
    </div>
  );
}
