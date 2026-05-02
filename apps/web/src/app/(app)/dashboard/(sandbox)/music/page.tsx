/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { fmtDuration, gradFor, relTime } from "../../_design-test/data-mapping";
import {
  MusicLibraryTab,
  type LibraryProject,
  type LibraryTrack,
} from "../../_design-test/music-library-tab";

// Music Library tab. Shell lives in (sandbox)/layout.tsx; this page
// fetches its own track + project list and returns the inner tab.

function uploadedRel(date: Date): "today" | "yesterday" | "this week" | "older" {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "this week";
  return "older";
}

export default async function MusicPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [libRows, projectsList] = await Promise.all([
    caller.library.list(),
    caller.project.list(),
  ]);

  const tracks: LibraryTrack[] = libRows.map((r, i) => ({
    id: r.versionId,
    title: r.trackTitle ?? r.versionLabel ?? "Untitled",
    project: r.projectTitle,
    projectId: r.projectId,
    client: r.projectClientName ?? r.projectArtistName ?? "Client",
    version: r.versionLabel ?? "v1",
    comments: 0,
    plays: 0,
    duration: fmtDuration(r.durationMs),
    durationSec: r.durationMs ? Math.round(r.durationMs / 1000) : 240,
    bpm: null,
    mkey: null,
    grad: gradFor(i),
    uploaded: relTime(r.uploadedAt),
    uploadedRel: uploadedRel(r.uploadedAt),
    favorite: false,
  }));

  const projects: LibraryProject[] = projectsList.map((p) => ({
    id: p.id,
    name: p.title,
  }));

  return <MusicLibraryTab data={{ tracks, projects }} />;
}
