// page.tsx
//
// Producer Portfolio. Tracks + external links. Lifted from the
// /dashboard/profile?tab=portfolio composition; content unchanged.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import type { PortfolioTrackRow } from "~/components/dashboard/setup/portfolio-section";
import { appRouter } from "~/server/trpc/routers/_app";

import {
  PortfolioPanel,
  type ExternalLinkRow,
  type LibraryPickRow,
} from "./portfolio-panel";

export default async function PortfolioPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [tracks, links, library] = await Promise.all([
    caller.portfolio.list(),
    caller.producerExternalLinks.list(),
    caller.library.list(),
  ]);

  const portfolioTracks: PortfolioTrackRow[] = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    isPublicSample: t.isPublicSample,
  }));
  const addedAudioUrls = tracks
    .map((t) => t.audioUrl)
    .filter((u): u is string => Boolean(u));
  const externalLinks: ExternalLinkRow[] = links.map((l) => ({
    id: l.id,
    platform: l.platform,
    url: l.url,
    title: l.title,
  }));
  const libraryRows: LibraryPickRow[] = library.map((r) => ({
    versionId: r.versionId,
    trackTitle: r.trackTitle,
    projectTitle: r.projectTitle,
    artistName: r.projectArtistName,
    audioUrl: r.audioUrl,
    uploadedAt: r.uploadedAt.toISOString(),
  }));

  return (
    <div className="sk-page-enter mx-auto max-w-[1100px] px-4 pt-6 pb-24 sm:px-6 sm:pt-10">
      <header className="mb-6">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          PORTFOLIO
        </p>
        <h1
          className="mt-2 font-display font-extrabold leading-[0.96] tracking-[-0.035em] text-[rgb(var(--fg-default))]"
          style={{ fontSize: "clamp(48px, 11vw, 96px)" }}
        >
          Portfolio<span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
        </h1>
      </header>
      <PortfolioPanel
        tracks={portfolioTracks}
        links={externalLinks}
        library={libraryRows}
        addedAudioUrls={addedAudioUrls}
      />
    </div>
  );
}
