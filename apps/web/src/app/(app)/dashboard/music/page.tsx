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
      {/* Batch C — Music library matches the Today full-bleed canvas. */}
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="mx-auto max-w-[1920px] px-4 pt-8 pb-12 sm:px-8 lg:px-12 lg:pt-12">
          <header className="mb-4">
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
              Library
            </p>
            <h1 className="mt-2 font-display text-4xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-5xl">
              Music
            </h1>
            <p className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-[rgb(var(--fg-secondary))]">
              Every track you&apos;ve uploaded, newest first. Tap a cover to open its Project Room.
            </p>
          </header>
          <MusicLibrary tracks={rows} />
        </div>
      </div>
    </AppShell>
  );
}
