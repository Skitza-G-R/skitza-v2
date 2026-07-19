import { auth } from "@clerk/nextjs/server";

import {
  MusicLibraryScreen,
  type MusicLibraryProjectRow,
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
  const data = await caller.library.music.artistList();

  const rows: MusicLibraryRow[] = data.projects.flatMap((project) => [
    ...project.songs.map(
      (song): MusicLibraryRow => ({
        kind: "track",
        id: song.id,
        trackId: song.trackId,
        trackTitle: song.title,
        trackArtist: song.artist,
        archivedAtIso: song.archivedAt?.toISOString() ?? null,
        releasedAtIso: song.releasedAt?.toISOString() ?? null,
        audioDeletedAtIso:
          song.latestVersion === null
            ? (song.latestHistoryVersion?.audioDeletedAt?.toISOString() ?? null)
            : null,
        label: song.latestVersion?.label ?? song.latestHistoryVersion?.label ?? null,
        latestVersionId: song.latestVersion?.id ?? song.latestHistoryVersion?.id ?? null,
        projectId: project.id,
        projectTitle: project.title,
        projectLifecycleStatus: project.lifecycleStatus,
        clientName: project.partnerName,
        uploadedAtIso:
          (
            song.latestVersion?.uploadedAt ?? song.latestHistoryVersion?.uploadedAt
          )?.toISOString() ?? null,
        audioUrl: song.latestVersion?.audioUrl ?? null,
        durationMs: song.latestVersion?.durationMs ?? null,
        unreadComments: song.unreadComments,
        plays: song.plays,
      }),
    ),
    ...project.emptySlots.map(
      (slot): MusicLibraryRow => ({
        kind: "empty-slot",
        id: slot.id,
        purchaseId: slot.purchaseId,
        slotIndex: slot.slotNumber,
        trackTitle: slot.title,
        projectId: project.id,
        projectTitle: project.title,
        projectLifecycleStatus: project.lifecycleStatus,
        clientName: project.partnerName,
      }),
    ),
  ]);

  const projectRows: MusicLibraryProjectRow[] = data.projects.map((project) => ({
    id: project.id,
    title: project.title,
    artistLabel: project.partnerName ?? "Producer",
    visibleSpaceCount: project.visibleCount,
    playableTrackCount: project.songs.filter((song) => song.latestVersion?.audioUrl).length,
    projectLifecycleStatus: project.lifecycleStatus,
    latestTrackUploadedAtIso:
      project.songs
        .map(
          (song) => song.latestVersion?.uploadedAt ?? song.latestHistoryVersion?.uploadedAt ?? null,
        )
        .filter((value): value is Date => value !== null)
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString() ?? null,
  }));

  // Negative margins break the page out of the artist shell's
  // `px-4 pt-6 lg:px-10 lg:pt-10` padding so the amber wash spans
  // edge-to-edge and starts flush at the top. Without this, the
  // shell padding leaves cream strips on the sides + above the wash.
  // Same trick we use on the L2 ProjectPage route — both want the
  // backdrop to read as a full-width canvas, not an inset card.
  //
  // SK-31 update: the artist now has a desktop topbar (lg+). That
  // topbar already provides ~40px of chrome above the heading, so on
  // lg+ we drop the inner `mt-10` to keep the heading flush with the
  // topbar's bottom — matches the producer side, where the shell's
  // `-mt-[40px]` cancels the inner `mt-10` for the same visual. On
  // mobile (no new topbar) we keep the mt-10 so the heading still
  // has breathing room above the amber wash.
  return (
    <div className="relative isolate -mx-4 -mt-6 lg:-mx-10 lg:-mt-10">
      {/* Soft warm-amber wash behind the header.

          Producer side terminates the gradient with `via-bg-background`
          + `to-bg-background`; on producer the DashboardTopBar's
          backdrop-blur sits over the first 40px so any opacity
          discontinuity at the via-stop is masked. The artist shell
          has its own desktop topbar (SK-31) that does the same job on
          lg+, and on mobile there's no topbar covering the wash, so
          we fade straight to `transparent` here instead — a
          continuous 0.10 → 0 alpha across the full 360px, with the
          parent's cream showing through cleanly throughout. No band. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] to-transparent"
      />
      <div className="mx-auto mt-10 max-w-[1180px] px-4 pt-6 pb-24 sm:px-7 sm:pt-8 lg:mt-0">
        <MusicLibraryScreen tracks={rows} projectRows={projectRows} role="artist" />
      </div>
    </div>
  );
}
