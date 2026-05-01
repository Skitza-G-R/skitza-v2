/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  fmtDuration,
  gradFor,
  initialsOf,
  progressForStage,
  relTime,
  tagForStage,
} from "../../_design-test/data-mapping";
import { DesignShell } from "../../_design-test/design-shell";
import { buildPaletteData } from "../../_design-test/palette-data";
import {
  ProjectRoom,
  type ActivityEvent,
  type ProjectRoomProject,
  type ProjectRoomTrack,
} from "../../_design-test/project-room";
import type { Producer } from "../../_design-test/shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProjectRoomPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;

  const caller = appRouter.createCaller({ userId });
  const [me, paletteData] = await Promise.all([
    caller.producer.me(),
    buildPaletteData(caller),
  ]);

  // Fetch project detail + money + tracks in parallel. project.detail
  // throws NOT_FOUND if the project doesn't exist or belongs to a
  // different producer — surface as Next.js 404.
  let detail;
  let money;
  let tracksList;
  try {
    [detail, money, tracksList] = await Promise.all([
      caller.project.detail({ id }),
      caller.project.money({ projectId: id }),
      caller.library.list({ projectId: id }),
    ]);
  } catch {
    notFound();
  }

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  const stageTag = tagForStage(detail.project.stage);
  // money returns paidCents + outstandingCents (no totalCents — total is
  // their sum). The shape lives at apps/web/src/server/trpc/routers/
  // project.ts:money.
  const paid = Math.round(money.paidCents / 100);
  const total = paid + Math.round(money.outstandingCents / 100);
  const songCount = detail.tracks.length;

  // Deadline display + days. nextChargeAt is the closest signal we have
  // for a real-world due date. When absent, surface "—" + a high
  // deadlineDays so the StatTile renders neutral (not warning/danger).
  let deadline = "—";
  let deadlineDays = 9999;
  if (detail.project.nextChargeAt) {
    const dt = new Date(detail.project.nextChargeAt);
    const ms = dt.getTime() - Date.now();
    deadlineDays = Math.round(ms / (24 * 60 * 60 * 1000));
    deadline = dt.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
  }

  const project: ProjectRoomProject = {
    id: detail.project.id,
    name: detail.project.title,
    client:
      detail.project.clientName ?? detail.project.artistName ?? "Client",
    stage: detail.project.stage.replace(/_/g, " "),
    tag: stageTag.label,
    tagType: stageTag.type,
    grad: gradFor(parseInt(id.slice(0, 8), 16) || 0),
    progress: progressForStage(detail.project.stage),
    paid,
    total,
    songs: songCount,
    sessions: 0,
    deadline,
    deadlineDays,
  };

  // Tracks → mockup ProjectRoomTrack shape. Comments count comes from
  // the detail payload (per-track via versionIds → comment array).
  const versionsByTrack = new Map<string, typeof detail.versions>();
  for (const v of detail.versions) {
    const arr = versionsByTrack.get(v.trackId) ?? [];
    arr.push(v);
    versionsByTrack.set(v.trackId, arr);
  }
  const commentsByVersion = new Map<string, number>();
  for (const c of detail.comments) {
    commentsByVersion.set(
      c.versionId,
      (commentsByVersion.get(c.versionId) ?? 0) + 1,
    );
  }

  const tracks: ProjectRoomTrack[] = tracksList.map((row) => ({
    id: row.versionId,
    title: row.trackTitle ?? row.versionLabel ?? "Untitled",
    version: row.versionLabel ?? "v1",
    duration: fmtDuration(row.durationMs),
    durationSec: Math.round((row.durationMs ?? 0) / 1000) || 240,
    bpm: null,
    mkey: null,
    uploaded: relTime(row.uploadedAt),
    comments: commentsByVersion.get(row.versionId) ?? 0,
  }));

  // Synthesize an activity feed from real signals: most recent track
  // uploads + most recent comments. Empty state renders cleanly when
  // there's nothing to show. Replaces the mockup's hardcoded events.
  const uploadEvents: ActivityEvent[] = tracksList.slice(0, 3).map((row) => ({
    icon: "upload",
    text: `New version "${row.versionLabel ?? "v1"}" uploaded for ${row.trackTitle ?? "track"}`,
    when: relTime(row.uploadedAt),
    who: "You",
  }));
  const commentEvents: ActivityEvent[] = detail.comments
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 3)
    .map((c) => ({
      icon: "message-circle",
      text: c.body.length > 80 ? `${c.body.slice(0, 80)}…` : c.body,
      when: relTime(new Date(c.createdAt)),
      who: c.fromProducer ? "You" : (project.client || "Client"),
    }));
  const activity: ActivityEvent[] = [...uploadEvents, ...commentEvents].slice(
    0,
    8,
  );

  return (
    <DesignShell producer={producer} paletteData={paletteData}>
      <ProjectRoom data={{ project, tracks, activity }} />
    </DesignShell>
  );
}
