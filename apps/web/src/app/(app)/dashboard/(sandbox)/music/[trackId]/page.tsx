/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  fmtDuration,
  gradFor,
  relTime,
} from "../../../_design-test/data-mapping";
import {
  rawCommentToVisible,
  type RawComment,
  type VisibleComment,
} from "../../../_design-test/song-comments";
import { SongPage, type SongPageData } from "../../../_design-test/song-page";

// /dashboard/music/[trackId] — Song Page route. Shell lives in
// (sandbox)/layout.tsx; this page fetches the version + project +
// comments detail and returns the inner SongPage component.

type PageProps = { params: Promise<{ trackId: string }> };

export default async function SongPageRoute({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { trackId } = await params;
  const caller = appRouter.createCaller({ userId });

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

  const versionLabels = allVersions
    .map((v) => v.label ?? "v1")
    .reduce<string[]>((acc, label) => {
      if (!acc.includes(label)) acc.push(label);
      return acc;
    }, []);
  const activeVersion = detail.version.label ?? "v1";

  // Producer name needed for comment author derivation. Avoid a full
  // producer.me() refetch by using the email-stripped fallback "Producer".
  const me = await caller.producer.me();
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

  return <SongPage data={data} />;
}
