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
  const [me, songs, links] = await Promise.all([
    caller.producer.me(),
    caller.songPublication.producerPortfolioChoices(),
    caller.producerExternalLinks.list(),
  ]);

  const portfolioTracks: PortfolioTrackRow[] = songs
    .filter((song) => song.portfolioPublishedAt !== null)
    .map((song) => ({
      id: song.trackId,
      versionId: song.latestVersion.id,
      title: song.title,
      artist: song.artist ?? song.projectArtistName,
      portfolioPublished: true,
      audioUrl: song.latestVersion.audioUrl,
      durationMs: song.latestVersion.durationMs,
      peaks: song.latestVersion.peaks,
      versionLabel: song.latestVersion.label,
    }));
  const publishedTrackIds = portfolioTracks.map((track) => track.id);
  const externalLinks: ExternalLinkRow[] = links.map((l) => ({
    id: l.id,
    platform: l.platform,
    url: l.url,
  }));
  const libraryRows: LibraryPickRow[] = songs.map((song) => ({
    trackId: song.trackId,
    trackTitle: song.title,
    projectTitle: song.projectTitle,
    artistName: song.artist ?? song.projectArtistName,
    audioUrl: song.latestVersion.audioUrl,
    uploadedAt: song.latestVersion.uploadedAt.toISOString(),
  }));

  const publicProfileUrl = `/join/${me.slug}`;

  return (
    <div className="sk-page-enter mx-auto max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
      {/* Mobile: title stacks above the CTA. Desktop: original side-by-side row. */}
      <header className="mb-8 flex flex-col items-start gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <p className="font-mono text-[10.5px] font-bold tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
            PORTFOLIO
          </p>
          <h1
            className="font-display mt-2 leading-[0.96] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]"
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
          className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 py-2.5 text-sm font-semibold text-[rgb(var(--fg-primary))] transition-all duration-200 ease-out hover:-translate-y-px hover:bg-[rgb(var(--brand-primary)/0.94)] hover:shadow-[0_10px_28px_-8px_rgb(var(--brand-primary)/0.6),0_4px_10px_-2px_rgb(17_16_9_/_0.14)] active:translate-y-0 active:scale-[0.97] sm:min-h-0"
          style={{
            boxShadow:
              "0 6px 18px -6px rgb(var(--brand-primary) / 0.45), 0 2px 6px -1px rgb(17 16 9 / 0.10)",
          }}
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
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
        publishedTrackIds={publishedTrackIds}
      />
    </div>
  );
}
