/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  fmtDuration,
  gradFor,
  initialsOf,
  relTime,
} from "../_design-test/data-mapping";
import { DesignShell } from "../_design-test/design-shell";
import {
  MusicLibraryTab,
  type LibraryProject,
  type LibraryTrack,
} from "../_design-test/music-library-tab";
import { buildPaletteData } from "../_design-test/palette-data";
import type { Producer } from "../_design-test/shell";

// gili/design-test branch — Music Library tab. Maps
// `library.list()` rows into the mockup's track shape. Custom
// playlists rail uses the mockup's hardcoded list (no playlists table
// yet); favorites is local component state until a favorites column
// lands. The mockup's BPM/MKey columns surface as null because we
// don't tag tracks with that metadata yet — the table renders cleanly
// with those fields blank.

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
  const [me, libRows, projectsList, paletteData] = await Promise.all([
    caller.producer.me(),
    caller.library.list(),
    caller.project.list(),
    buildPaletteData(caller),
  ]);

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

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

  return (
    <DesignShell producer={producer} paletteData={paletteData}>
      <MusicLibraryTab data={{ tracks, projects }} />
    </DesignShell>
  );
}
