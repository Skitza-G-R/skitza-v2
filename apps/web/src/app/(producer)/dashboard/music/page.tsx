import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  MusicLibrary,
  type MusicRow,
} from "~/components/dashboard/music/music-library";
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

  // Header counts mirror the design's "X uploads · all caught up"
  // subtitle. We don't have an `unreadComments` per-row aggregate at
  // this top-level (producer.music.list returns the projection
  // without comment counts) — so we surface upload count + relative
  // date of the latest upload as a Phase 4 stand-in. Full
  // unread-comments-on-Library is deferred (handoff doc).
  const lastUploadIso = rows[0]?.uploadedAtIso ?? null;
  const subtitleCounts =
    rows.length === 0
      ? "No uploads yet"
      : lastUploadIso
        ? `${String(rows.length)} uploads · latest ${formatRelativeDate(new Date(lastUploadIso))}`
        : `${String(rows.length)} uploads`;

  return (
    <>
      {/* Phase 4 — Library page chrome migrated to the locked design. */}
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
          <header className="mb-5">
            <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[34px]">
              Library
              <span className="text-[rgb(var(--brand-primary))]">.</span>
            </h1>
            <p className="mt-1.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
              {subtitleCounts}
            </p>
          </header>
          <MusicLibrary tracks={rows} />
        </div>
      </div>
    </>
  );
}

function formatRelativeDate(d: Date): string {
  const diff = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${String(Math.floor(diff / day))} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
