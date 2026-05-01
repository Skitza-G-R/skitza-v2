/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  fmtDuration,
  gradFor,
  initialsOf,
  relTime,
} from "../../_design-test/data-mapping";
import { DesignShell } from "../../_design-test/design-shell";
import {
  rawCommentToVisible,
  type RawComment,
  type VisibleComment,
} from "../../_design-test/song-comments";
import { SongPage, type SongPageData } from "../../_design-test/song-page";
import type { Producer } from "../../_design-test/shell";

// /dashboard/music/[trackId] — Song Page route. Wires real Skitza data
// into the SongPage component. The URL param is the versionId in the
// DB (matching library.detail's contract — version → track → project).

type PageProps = { params: Promise<{ trackId: string }> };

export default async function SongPageRoute({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { trackId } = await params;

  const caller = appRouter.createCaller({ userId });
  const me = await caller.producer.me();

  let detail;
  try {
    detail = await caller.library.detail({ versionId: trackId });
  } catch {
    notFound();
  }

  let allVersions: { id: string; trackId: string; label: string | null }[] = [];
  try {
    const projectDetail = await caller.project.detail({
      id: detail.track.projectId,
    });
    allVersions = projectDetail.versions.filter(
      (v) => v.trackId === detail.track.id,
    );
  } catch {
    allVersions = [
      {
        id: detail.version.id,
        trackId: detail.track.id,
        label: detail.version.label,
      },
    ];
  }

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  const versionLabels = allVersions
    .map((v) => v.label ?? "v1")
    .reduce<string[]>((acc, label) => {
      if (!acc.includes(label)) acc.push(label);
      return acc;
    }, []);
  const activeVersion = detail.version.label ?? "v1";

  const producerName = me.displayName ?? "Producer";
  const visibleComments: VisibleComment[] = detail.comments.map((c) => {
    const raw: RawComment = {
      id: c.id,
      versionId: c.versionId,
      timestampMs: c.timestampMs,
      body: c.body,
      fromProducer: c.fromProducer,
      authorEmail:
        "authorEmail" in c && typeof c.authorEmail === "string"
          ? c.authorEmail
          : null,
      createdAt: c.createdAt,
    };
    return rawCommentToVisible(raw, { producerName });
  });

  const gradSeed = parseInt(detail.track.projectId.slice(0, 8), 16) || 0;

  const data: SongPageData = {
    track: {
      id: detail.version.id,
      trackId: detail.track.id,
      projectId: detail.track.projectId,
      title: detail.track.title,
      project: detail.project.title,
      client: detail.project.artistName ?? detail.project.title,
      duration: fmtDuration(detail.version.durationMs),
      durationSec: Math.round((detail.version.durationMs ?? 0) / 1000) || 240,
      uploaded: relTime(detail.version.uploadedAt),
      grad: gradFor(gradSeed),
      versions: versionLabels,
      activeVersion,
    },
    comments: visibleComments,
  };

  return (
    <DesignShell producer={producer}>
      <SongPage data={data} />
    </DesignShell>
  );
}
