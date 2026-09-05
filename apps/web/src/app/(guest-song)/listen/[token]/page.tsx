import { auth } from "~/server/auth/clerk-identity";
import { createDb } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SongPage, type SongPageData } from "~/components/music/song-page";
import { Wordmark } from "~/components/nav/wordmark";
import { PublicConnectivityNotice } from "~/components/public/public-connectivity";
import { songPublicationSecret } from "~/server/domain/song-publication/config";
import {
  readPublicSong,
  readSongLinkDownloadEntitlements,
  SongPublicReadError,
} from "~/server/domain/song-publication/public-read";
import { SongPublicTokenError } from "~/server/domain/song-publication/tokens";
import { appRouter } from "~/server/trpc/routers/_app";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Listen on Skitza",
  description: "A private-by-URL listening page shared from Skitza.",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

function isExpectedOwnershipMiss(error: unknown): boolean {
  return (
    error instanceof TRPCError &&
    (error.code === "NOT_FOUND" ||
      error.code === "FORBIDDEN" ||
      error.code === "UNAUTHORIZED" ||
      error.code === "PRECONDITION_FAILED")
  );
}

async function ownerDestination(userId: string, versionId: string): Promise<string | null> {
  const caller = appRouter.createCaller({ userId });
  try {
    await caller.producer.music.detail({ versionId });
    return `/dashboard/music/${versionId}`;
  } catch (error) {
    if (!isExpectedOwnershipMiss(error)) throw error;
  }

  try {
    await caller.artist.music.detail({ versionId });
    return `/artist/music/song/${versionId}`;
  } catch (error) {
    if (!isExpectedOwnershipMiss(error)) throw error;
  }

  return null;
}

export default async function GuestSongPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");

  const db = createDb(databaseUrl);
  const secret = songPublicationSecret();
  let data;
  let entitlements;
  try {
    [data, entitlements] = await Promise.all([
      readPublicSong(db, { secret, token }),
      readSongLinkDownloadEntitlements(db, { secret, token }),
    ]);
  } catch (error) {
    if (error instanceof SongPublicReadError || error instanceof SongPublicTokenError) {
      notFound();
    }
    throw error;
  }

  const selectedVersionId = data.versions[0]?.id;
  if (!selectedVersionId) notFound();

  const { userId } = await auth();
  if (userId) {
    const destination = await ownerDestination(userId, selectedVersionId);
    if (destination) redirect(destination);
  }

  const entitlementByVersion = new Map(
    entitlements.map((entitlement) => [entitlement.versionId, entitlement]),
  );
  const wire: SongPageData = {
    track: {
      id: data.song.id,
      title: data.song.title,
      artist: data.song.artist,
      projectId: data.song.projectId,
      projectTitle: data.song.projectTitle,
      clientName: data.producer.displayName,
      artworkUrl: null,
      archivedAtIso: null,
      releasedAtIso: null,
      workflowStage: data.song.workflowStage,
      projectLifecycleStatus: "active",
      artistApprovalLocked: false,
      // SK-305. Never sent to a public listener. Lyrics are unreleased words,
      // and a share link reaches anyone the link reaches. Hardcoded null here
      // rather than read-and-drop so no future edit to the guest read model can
      // start leaking them by accident.
      lyrics: null,
      lyricsUpdatedAtIso: null,
      lyricsUpdatedBy: null,
    },
    versions: data.versions.map((version) => {
      const entitlement = entitlementByVersion.get(version.id);
      return {
        id: version.id,
        label: version.label,
        audioUrl: version.audioUrl,
        downloadUrl: entitlement?.downloadUrl ?? null,
        audioDeletedAtIso: null,
        durationMs: version.durationMs,
        uploadedAtIso: version.uploadedAt.toISOString(),
        producerMarkedFinalAtIso: version.producerMarkedFinalAt?.toISOString() ?? null,
        artistApprovedAtIso: null,
        previouslyArtistApprovedAtIso: null,
        peaks: version.peaks,
        delivery: {
          purchaseId: data.song.id,
          permission: entitlement?.canDownload ? "version_override" : "payment_required",
          fullyPaid: false,
          remainingCents: 0,
          currency: "USD",
          overdue: false,
          totalCents: 0,
        },
      };
    }),
    comments: [],
    selectedVersionId,
  };
  const songPath = `/listen/${encodeURIComponent(token)}`;
  const loginHref = `/sign-in?${new URLSearchParams({ redirect_url: songPath }).toString()}`;

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]">
      <PublicConnectivityNotice />
      <header className="border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.96)]">
        <div className="mx-auto flex min-h-20 max-w-[1120px] items-center justify-between px-4 sm:min-h-24 sm:px-6">
          <span className="inline-flex min-h-11 items-center">
            <Wordmark size={30} lowercase />
          </span>
          <Link
            href={userId ? "/auth/resolve" : loginHref}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 text-[15px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--fg-default)/0.05)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none motion-reduce:transition-none"
          >
            {userId ? "Open app" : "Log in"}
          </Link>
        </div>
      </header>
      <div id="main-content">
        <SongPage data={wire} role="guest" actions={{}} />
      </div>
    </div>
  );
}
