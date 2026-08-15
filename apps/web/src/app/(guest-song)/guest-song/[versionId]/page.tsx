import { createDb } from "@skitza/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SongPage, type SongPageData } from "~/components/music/song-page";
import { Wordmark } from "~/components/nav/wordmark";
import { PublicConnectivityNotice } from "~/components/public/public-connectivity";
import { songPublicationSecret } from "~/server/domain/song-publication/config";
import {
  readAddressSharedSong,
  readAddressSongDownloadEntitlements,
  SongPublicReadError,
} from "~/server/domain/song-publication/public-read";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGINAL_SONG_PATH_HEADER = "x-skitza-original-song-path";

function isExpectedOriginalPath(pathname: string | null, versionId: string): pathname is string {
  if (!pathname) return false;
  return (
    pathname === `/dashboard/music/${versionId}` || pathname === `/artist/music/song/${versionId}`
  );
}

export default async function AddressGuestSongPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  if (!UUID.test(versionId)) notFound();

  const requestHeaders = await headers();
  const originalPath = requestHeaders.get(ORIGINAL_SONG_PATH_HEADER);
  if (!isExpectedOriginalPath(originalPath, versionId)) notFound();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  const db = createDb(databaseUrl);
  const secret = songPublicationSecret();

  let data;
  let entitlements;
  try {
    [data, entitlements] = await Promise.all([
      readAddressSharedSong(db, { secret, pageVersionId: versionId }),
      readAddressSongDownloadEntitlements(db, { secret, pageVersionId: versionId }),
    ]);
  } catch (error) {
    if (error instanceof SongPublicReadError) notFound();
    throw error;
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
          purchaseId: entitlement?.purchaseId ?? data.song.id,
          permission: entitlement?.permission ?? "payment_required",
          fullyPaid: entitlement?.fullyPaid ?? false,
          remainingCents: entitlement?.remainingCents ?? 0,
          currency: entitlement?.currency ?? "USD",
          overdue: entitlement?.overdue ?? false,
          totalCents: 0,
        },
      };
    }),
    comments: [],
    selectedVersionId: data.selectedVersionId,
  };
  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]">
      <PublicConnectivityNotice />
      <header className="border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.96)]">
        <div className="mx-auto flex min-h-20 max-w-[1120px] items-center justify-between px-4 sm:min-h-24 sm:px-6">
          <span className="inline-flex min-h-11 items-center">
            <Wordmark size={30} lowercase />
          </span>
          <Link
            href="/"
            className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary-dark)/0.16)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-primary))] shadow-[0_8px_20px_-12px_rgb(var(--brand-primary-dark)/0.75)] transition-[transform,filter,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_12px_24px_-12px_rgb(var(--brand-primary-dark)/0.9)] hover:brightness-[1.03] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary-dark))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))] focus-visible:outline-none active:translate-y-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-12 sm:px-6 sm:text-[15px]"
          >
            Join now!
          </Link>
        </div>
      </header>
      <div id="main-content">
        <SongPage data={wire} role="guest" actions={{}} />
      </div>
    </div>
  );
}
