import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import {
  ProjectPage,
  type ProjectPageData,
} from "~/components/music/project-page";
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
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId,
    )
  ) {
    notFound();
  }

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.artist.music.project({ projectId });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  // Cross the RSC → client boundary as ISO strings. `clientName` is
  // already overloaded with the producer's display name server-side
  // (see procedure header on artist.music.project).
  const wire: ProjectPageData = {
    project: {
      id: data.project.id,
      title: data.project.title,
      clientName: data.project.clientName,
      createdAtIso: data.project.createdAt.toISOString(),
    },
    tracks: data.tracks.map((t) => ({
      id: t.id,
      trackId: t.trackId,
      title: t.title,
      artist: t.artist,
      versionLabel: t.versionLabel,
      audioUrl: t.audioUrl,
      durationMs: t.durationMs,
      uploadedAtIso: t.uploadedAt.toISOString(),
      unreadComments: t.unreadComments,
      plays: t.plays,
    })),
  };

  // Sessions on the artist L2 — same data the prior NowPlaying screen
  // surfaced. Dates flip to ISO so the SessionsPanel client component
  // can render them with the device locale.
  const sessions: SessionRow[] = data.sessions.map((s) => ({
    id: s.id,
    startsAtIso: s.startsAt.toISOString(),
    durationMin: s.durationMin,
    status: s.status,
    packageName: s.packageName,
  }));

  return (
    <ProjectPage
      data={wire}
      role="artist"
      extraBelow={sessions.length > 0 ? <SessionsPanel sessions={sessions} /> : null}
    />
  );
}
