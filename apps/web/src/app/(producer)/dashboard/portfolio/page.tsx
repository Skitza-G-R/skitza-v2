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
          className="group/view-public inline-flex shrink-0 items-center gap-2 rounded-full border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-5 py-2.5 text-sm text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--bg-overlay))]"
          style={{ fontWeight: 500 }}
        >
          <span>View public page</span>
          <span
            aria-hidden="true"
            className="grid h-5 w-5 place-items-center rounded-full border border-[rgb(var(--border-strong))] text-[11px] transition-transform group-hover/view-public:translate-x-[2px] group-hover/view-public:-translate-y-[1px]"
          >
            ↗
          </span>
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
