import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { SongPage, type SongPageData } from "~/components/music/song-page";
import type { SongPublicSharingView } from "~/components/music/song-public-link-controls";
import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";
import { classifySongUploadPublicExposure } from "~/server/domain/song-publication/upload-exposure";
import { appRouter } from "~/server/trpc/routers/_app";

import {
  deleteMusicSong,
  deleteMusicVersion,
  deleteMusicVersionAudio,
  editMusicSongArtist,
  markMusicSongReleased,
  renameMusicSong,
  renameMusicVersion,
  saveMusicSongLyrics,
  setMusicSongArchived,
} from "../actions";
import {
  l3AddComment,
  completeArtwork,
  l3MarkVersionReady,
  prepareArtwork,
  l3ReopenApprovedSong,
  l3ResolveComment,
  l3SetDownloadOverride,
} from "./actions";
import { loadProducerSongSupplements } from "./song-detail-supplements";
import { canUploadProducerSongVersion, producerProjectOriginHref } from "./project-origin";
import {
  disablePublicSongLink,
  publishPublicSongLink,
  resetPublicSongLink,
  setSongPortfolioPublic,
} from "../public-link-actions";

type PageProps = {
  params: Promise<{ versionId: string }>;
  searchParams?: Promise<{ from?: string }>;
};

// L3 song page — full waveform + timestamped comments + version
// switcher + producer-ready/reopen controls. Routed at /dashboard/music/<versionId>
// so the L1 list deep-links straight here.
//
// Resolves data via the new producer.music.detail tRPC procedure.
// NOT_FOUND surfaces as Next's notFound() — same convention the artist
// /artist/music/[projectId]/page.tsx already uses. We don't differentiate
// "doesn't exist" from "not yours" so we don't leak the existence of
// other producers' track-versions.
export default async function ProducerSongPage({ params, searchParams }: PageProps) {
  const { versionId } = await params;
  const query = (await searchParams) ?? {};
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Validate uuid shape early — keeps the tRPC layer's Zod from
  // emitting a generic BAD_REQUEST that we'd then bridge to a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) {
    notFound();
  }

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.producer.music.detail({ versionId });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") {
      notFound();
    }
    throw e;
  }
  const { sharing, overrideByVersion } = await loadProducerSongSupplements(caller, data);
  const publicSharing: SongPublicSharingView = {
    trackId: sharing.trackId,
    linkEnabled: sharing.linkEnabled,
    portfolioPublished: sharing.portfolioPublished,
    remainingAudioCount: sharing.remainingAudioCount,
    tokenVersion: sharing.tokenVersion,
    publicUrl: sharing.publicUrl ? `${PUBLIC_BRAND_ORIGIN}${sharing.publicUrl}` : null,
  };
  const producerProjectHref = producerProjectOriginHref(data.track.projectId, query.from);
  const uploadPurchase = data.versions[0];
  const versionUpload =
    uploadPurchase &&
    canUploadProducerSongVersion({
      projectLifecycleStatus: data.track.projectLifecycleStatus,
      purchaseLifecycleStatus: uploadPurchase.purchaseLifecycleStatus,
      trackArchived: data.track.archivedAt !== null,
      artistApprovalLocked: data.track.artistApprovalLocked,
    })
      ? {
          projectId: data.track.projectId,
          trackId: data.track.id,
          defaultLabel: `V${String(data.versions.length + 1)}`,
          versionCount: data.versions.length,
          publicExposure: classifySongUploadPublicExposure(sharing),
        }
      : undefined;

  // Cross the RSC → client boundary as plain JSON (Date → ISO).
  const wire: SongPageData = {
    track: {
      id: data.track.id,
      title: data.track.title,
      artist: data.track.artist,
      projectId: data.track.projectId,
      projectTitle: data.track.projectTitle,
      clientName: data.track.clientName,
      artworkUrl: data.track.artworkUrl,
      lyrics: data.track.lyrics,
      lyricsUpdatedAtIso: data.track.lyricsUpdatedAt?.toISOString() ?? null,
      lyricsUpdatedBy: data.track.lyricsUpdatedBy,
      archivedAtIso: data.track.archivedAt?.toISOString() ?? null,
      releasedAtIso: data.track.releasedAt?.toISOString() ?? null,
      workflowStage: data.track.workflowStage,
      projectLifecycleStatus: data.track.projectLifecycleStatus,
      artistApprovalLocked: data.track.artistApprovalLocked,
    },
    versions: data.versions.map((v) => ({
      id: v.id,
      label: v.label,
      audioUrl: v.audioUrl,
      audioDeletedAtIso: v.audioDeletedAt?.toISOString() ?? null,
      durationMs: v.durationMs,
      uploadedAtIso: v.uploadedAt.toISOString(),
      producerMarkedFinalAtIso: v.producerMarkedFinalAt?.toISOString() ?? null,
      artistApprovedAtIso: v.artistApprovedAt?.toISOString() ?? null,
      previouslyArtistApprovedAtIso: v.previouslyArtistApprovedAt?.toISOString() ?? null,
      // Server-pre-computed peaks ride down with the page payload so
      // Waveform50 renders the real envelope on first frame instead
      // of a client-side decodeAudioData round-trip. Null for legacy
      // rows pre-backfill — Waveform50 falls back to the existing
      // /api/download client decode path.
      peaks: v.peaks,
      delivery: (() => {
        const state = overrideByVersion.get(v.id);
        if (!state) throw new Error("Missing producer override state");
        return {
          purchaseId: state.purchaseId,
          permission:
            v.audioDeletedAt !== null
              ? ("audio_deleted" as const)
              : state.fullyPaid
                ? ("purchase_fully_paid" as const)
                : state.enabled
                  ? ("version_override" as const)
                  : ("payment_required" as const),
          fullyPaid: state.fullyPaid,
          remainingCents: state.unpaidAmountCents,
          currency: state.currency,
          overdue: state.overdue,
          totalCents: v.purchaseTotalCents,
        };
      })(),
    })),
    comments: data.comments.map((c) => ({
      id: c.id,
      versionId: c.versionId,
      timeMs: c.timeMs,
      body: c.body,
      fromProducer: c.fromProducer,
      authorName: c.authorName,
      createdAtIso: c.createdAt.toISOString(),
      resolvedAtIso: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    })),
    selectedVersionId: data.selectedVersionId,
  };

  return (
    <SongPage
      data={wire}
      role="producer"
      producerProjectHref={producerProjectHref}
      versionUpload={versionUpload}
      publicSharing={publicSharing}
      publicSharingActions={{
        publish: publishPublicSongLink,
        reset: resetPublicSongLink,
        disable: disablePublicSongLink,
        setPortfolioPublic: setSongPortfolioPublic,
      }}
      actions={{
        addComment: l3AddComment,
        resolveComment: l3ResolveComment,
        markVersionReady: l3MarkVersionReady,
        reopenSong: l3ReopenApprovedSong,
        setDownloadOverride: l3SetDownloadOverride,
        prepareArtwork,
        completeArtwork,
        renameSong: renameMusicSong,
        setSongLyrics: saveMusicSongLyrics,
        editArtist: editMusicSongArtist,
        setArchived: setMusicSongArchived,
        markReleased: markMusicSongReleased,
        renameVersion: renameMusicVersion,
        deleteVersion: deleteMusicVersion,
        deleteSong: deleteMusicSong,
        deleteVersionAudio: deleteMusicVersionAudio,
      }}
    />
  );
}
