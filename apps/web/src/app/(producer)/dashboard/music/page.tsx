import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  MusicLibraryScreen,
  type MusicLibraryRow,
} from "~/components/dashboard/music/library-screen";
import { appRouter } from "~/server/trpc/routers/_app";

// Music library — Library → Project → Song flow.
//
// One row per TRACK across every project the producer owns, sorted by
// the newest version's upload time (newest first). The screen owns the
// page chrome (header + toolbar + 4 views: Projects/Songs × Grid/Table)
// so it can compute filtered/raw header counts in a single render pass.
export default async function MusicPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const data = await caller.producer.music.list();

  // Dates cross the RSC → client boundary as ISO strings.
  const rows: MusicLibraryRow[] = data.tracks.map((t) => ({
    id: t.id,
    trackId: t.trackId,
    trackTitle: t.trackTitle,
    trackArtist: t.trackArtist,
    label: t.label,
    projectId: t.projectId,
    projectTitle: t.projectTitle,
    clientName: t.clientName,
    uploadedAtIso: t.uploadedAt.toISOString(),
    audioUrl: t.audioUrl,
    durationMs: t.durationMs,
    unreadComments: t.unreadComments,
    plays: t.plays,
  }));

  return (
    <div className="relative isolate">
      {/* Soft warm-amber wash behind the header — matches the rest of
          the producer dashboard. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-background))] to-[rgb(var(--bg-background))]"
      />
      <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-7 sm:pt-8">
        <MusicLibraryScreen tracks={rows} />
      </div>
    </div>
  );
}
