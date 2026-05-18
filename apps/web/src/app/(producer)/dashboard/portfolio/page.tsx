// page.tsx
//
// Producer Portfolio — desktop-only showcase canvas. Two-column layout
// (social links left, featured tracks right). One screen at 1440×900,
// no scroll. See docs/plans/active/2026-05-17-portfolio-redesign-design.md.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  PortfolioPanel,
  type ExternalLinkRow,
  type LibraryPickRow,
  type PortfolioTrackRow,
} from "./portfolio-panel";

export default async function PortfolioPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [me, tracks, links, library] = await Promise.all([
    caller.producer.me(),
    caller.portfolio.list(),
    caller.producerExternalLinks.list(),
    caller.library.list(),
  ]);

  const portfolioTracks: PortfolioTrackRow[] = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    isPublicSample: t.isPublicSample,
    audioUrl: t.audioUrl,
    durationMs: t.durationMs,
    peaks: t.peaks,
  }));
  const addedAudioUrls = tracks
    .map((t) => t.audioUrl)
    .filter((u): u is string => Boolean(u));
  const externalLinks: ExternalLinkRow[] = links.map((l) => ({
    id: l.id,
    platform: l.platform,
    url: l.url,
  }));
  const libraryRows: LibraryPickRow[] = library.map((r) => ({
    versionId: r.versionId,
    trackTitle: r.trackTitle,
    projectTitle: r.projectTitle,
    artistName: r.projectArtistName,
    audioUrl: r.audioUrl,
    uploadedAt: r.uploadedAt.toISOString(),
  }));

  const publicProfileUrl = `/join/${me.slug}`;

  return (
    <div className="sk-page-enter mx-auto max-w-[1180px] px-6 pb-24 pt-8">
      <header className="mb-10 flex items-end justify-between gap-6">
        <div>
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            PORTFOLIO
          </p>
          <h1
            className="mt-2 font-display font-extrabold leading-[0.96] tracking-[-0.035em] text-[rgb(var(--fg-default))]"
            style={{ fontSize: "clamp(48px, 7.5vw, 88px)" }}
          >
            Portfolio
            <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
          </h1>
        </div>
        <a
          href={publicProfileUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="group/view-public inline-flex shrink-0 items-center gap-2 rounded-full bg-[rgb(var(--brand-primary))] px-5 py-2.5 text-sm text-[rgb(var(--fg-inverse))] transition-all duration-200 ease-out hover:bg-[rgb(var(--brand-primary)/0.92)] active:scale-[0.97]"
          style={{ fontWeight: 500 }}
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* eye glyph — semantically "view" */}
            <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
            <circle cx="8" cy="8" r="2" />
          </svg>
          <span>View public page</span>
        </a>
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
