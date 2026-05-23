import { auth } from "@clerk/nextjs/server";

import {
  MusicLibraryScreen,
  type MusicLibraryRow,
} from "~/components/music/library-screen";
import { appRouter } from "~/server/trpc/routers/_app";

// Music library — Library view (L1).
//
// Renders the same component the producer side uses (MusicLibraryScreen)
// in artist mode. The shared component owns all the chrome and four
// views (Projects/Songs × Grid/Table); role="artist" hides the
// producer-only Upload CTA and the artist filter pill, and switches
// internal Links to /artist/music/* URLs.
//
// One row per TRACK across every project this artist is part of,
// sorted by the newest version's upload time (newest first). Dates
// cross the RSC → client boundary as ISO strings.
export default async function MusicPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const data = await caller.artist.music.list();

  const rows: MusicLibraryRow[] = data.tracks.map((t) => ({
    id: t.id,
    trackId: t.trackId,
    trackTitle: t.trackTitle,
    trackArtist: t.trackArtist,
    label: t.label,
    projectId: t.projectId,
    projectTitle: t.projectTitle,
    // On the wire from artist.music.list, `clientName` is overloaded
    // with the producer's display name (see the procedure header in
    // routers/artist.ts) so this shared component renders identically.
    clientName: t.clientName,
    uploadedAtIso: t.uploadedAt.toISOString(),
    audioUrl: t.audioUrl,
    durationMs: t.durationMs,
    unreadComments: t.unreadComments,
    plays: t.plays,
  }));

  return (
    <div className="relative isolate">
      {/* Soft warm-amber wash behind the header.

          Producer side terminates the gradient with `via-bg-background`
          + `to-bg-background`; on producer the DashboardTopBar's
          backdrop-blur sits over the first 40px so any opacity
          discontinuity at the via-stop is masked. The artist shell has
          no topbar on desktop (the mobile topbar is `lg:hidden`), so
          the same gradient there exposes a faint horizontal band where
          the amber tint stops decaying. We fade straight to
          `transparent` here instead — a continuous 0.10 → 0 alpha
          across the full 360px, with the parent's cream showing
          through cleanly throughout. No band. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] to-transparent"
      />
      <div className="mx-auto mt-10 max-w-[1180px] px-4 pt-6 pb-24 sm:px-7 sm:pt-8">
        <MusicLibraryScreen tracks={rows} role="artist" />
      </div>
    </div>
  );
}
