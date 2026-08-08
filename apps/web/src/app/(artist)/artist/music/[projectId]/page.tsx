import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { ProjectPage, type ProjectPageData } from "~/components/music/project-page";
import { appRouter } from "~/server/trpc/routers/_app";

import { SessionsPanel, type SessionRow } from "./sessions-panel";

type PageProps = { params: Promise<{ projectId: string }> };

// L2 project page — sits between the artist Library (L1) and the
// per-song detail (L3, not yet wired on the artist side).
//
// Renders the same `ProjectPage` component the producer side uses
// (hero band + tracklist + footer), in `role="artist"` mode. The
// artist-specific Sessions panel renders below the tracklist via
// the `extraBelow` slot — that's the one piece the producer L2 does
// NOT show. Everything else (hero gradient + cover + meta line +
// action rail + tracklist columns) matches pixel-for-pixel.
//
// Auth gate: `artist.music.project` resolves ownership via
// client_contacts and NOT_FOUNDs on miss. We bridge that into
// Next's notFound() so the artist sees a 404 page rather than a
// stack trace, and so we don't differentiate "doesn't exist" from
// "not yours" — same convention as the producer L2.
export default async function ArtistProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  const { userId } = await auth();
  if (!userId) return null;

  // Validate UUID shape early — same trick the producer route uses to
  // keep the tRPC Zod layer from emitting a generic BAD_REQUEST that
  // we'd then bridge to a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    notFound();
  }

  const caller = appRouter.createCaller({ userId });
  let data;
  let sessionData;
  try {
    [data, sessionData] = await Promise.all([
      caller.library.music.artistProject({ projectId }),
      caller.artist.music.project({ projectId }),
    ]);
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  // Cross the RSC → client boundary as ISO strings. `clientName` is
  // already overloaded with the producer's display name server-side
  // (see procedure header on artist.music.project).
  const wire: ProjectPageData = {
    project: {
      id: data.id,
      title: data.title,
      clientName: data.partnerName,
      createdAtIso: data.createdAt.toISOString(),
      lifecycleStatus: data.lifecycleStatus,
    },
    tracks: [
      ...data.songs.map((song) => ({
        kind: "track" as const,
        id: song.id,
        trackId: song.trackId,
        title: song.title,
        artist: song.artist,
        archivedAtIso: song.archivedAt?.toISOString() ?? null,
        releasedAtIso: song.releasedAt?.toISOString() ?? null,
        audioDeletedAtIso:
          song.latestVersion === null
            ? (song.latestHistoryVersion?.audioDeletedAt?.toISOString() ?? null)
            : null,
        versionLabel: song.latestVersion?.label ?? song.latestHistoryVersion?.label ?? null,
        latestVersionId: song.latestVersion?.id ?? song.latestHistoryVersion?.id ?? null,
        audioUrl: song.latestVersion?.audioUrl ?? null,
        durationMs: song.latestVersion?.durationMs ?? null,
        uploadedAtIso:
          (
            song.latestVersion?.uploadedAt ?? song.latestHistoryVersion?.uploadedAt
          )?.toISOString() ?? null,
        unreadComments: song.unreadComments,
        plays: song.plays,
      })),
      ...data.emptySlots.map((slot) => ({
        kind: "empty-slot" as const,
        id: slot.id,
        purchaseId: slot.purchaseId,
        slotIndex: slot.slotNumber,
        title: slot.title,
      })),
    ],
  };

  // Sessions on the artist L2 — same data the prior NowPlaying screen
  // surfaced. Dates flip to ISO so the SessionsPanel client component
  // can render them in the Artist's configured timezone.
  const sessions: SessionRow[] = sessionData.sessions.map((s) => ({
    id: s.id,
    startsAtIso: s.startsAt.toISOString(),
    artistTimezone: sessionData.project.artistTimezone,
    producerTimezone: sessionData.project.producerTimezone,
    durationMin: s.durationMin,
    status: s.status,
    packageName: s.packageName,
  }));

  // The shared ProjectPage hero is full-bleed by design (the
  // atmospheric overlay fades to `rgb(var(--bg-background))` at the
  // bottom so it melts into the page canvas). The producer dashboard's
  // <main> has no horizontal/top padding around children, so producer
  // gets that full-bleed for free. The artist <main>, however, wraps
  // children in `px-4 pt-6 lg:px-10 lg:pt-10` — that leaves cream
  // strips above and beside the hero and pushes the page down. We
  // negate that exact padding at this route's root so the hero spans
  // edge-to-edge and starts flush at the top, matching producer. The
  // ProjectPage's own inner <section> re-pads the tracklist + footer
  // back to normal, so only the hero goes full-bleed.
  return (
    <div className="-mx-4 -mt-6 lg:-mx-10 lg:-mt-10">
      <ProjectPage
        data={wire}
        role="artist"
        artistStudioId={data.producerId}
        extraBelow={sessions.length > 0 ? <SessionsPanel sessions={sessions} /> : null}
      />
    </div>
  );
}
