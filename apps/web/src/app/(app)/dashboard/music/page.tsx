import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  MusicLibrary,
  type MusicRow,
} from "~/components/dashboard/music/music-library";
import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

// Task 10: Music top-level — Samply-style cross-project library. One
// row per track version across every project the producer owns, sorted
// newest-first. Tapping a row deep-links into the Project Room's Music
// sub-tab with the version preselected. Replaces the Task 1 stub.
export default async function MusicPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const data = await caller.producer.music.list();

  // Dates cross the RSC → client boundary as ISO strings. Project
  // down to the minimal row shape — we don't need to ship audio R2
  // keys or peaks URLs to the list view.
  const rows: MusicRow[] = data.tracks.map((t) => ({
    id: t.id,
    trackTitle: t.trackTitle,
    label: t.label,
    projectId: t.projectId,
    projectTitle: t.projectTitle,
    clientName: t.clientName,
    uploadedAtIso: t.uploadedAt.toISOString(),
    audioUrl: t.audioUrl,
  }));

  return (
    <AppShell active="music">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <header>
          <h1 className="font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))]">
            Music
          </h1>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            Every track you've uploaded, newest first.
          </p>
        </header>
        <MusicLibrary tracks={rows} />
      </div>
    </AppShell>
  );
}
