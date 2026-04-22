import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";

import { createDb, eq, portfolioTracks } from "@skitza/db";
import { appRouter } from "~/server/trpc/routers/_app";
import { ExternalLinksSection } from "~/components/join/external-links-section";
import { JoinHero } from "~/components/join/join-hero";
import { PublicSamplesPlayer } from "~/components/join/public-samples-player";
import { SignupCta } from "~/components/join/signup-cta";

// Story 02 of the /join flow (PRD §6.1-6.2). The URL every producer
// pastes into their IG bio — `skitza.app/join/<slug>` — lands here for
// unsigned-in visitors. Public teaser: hero + up to 3 sample tracks +
// signup CTA. No auth; no AppShell; its own dark-themed landing layout.
//
// Wave 1 scope: no external streaming links, no locked-track
// placeholders, no engagement approval. Just enough surface area that
// a cold visitor can hear samples and sign up.

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const caller = appRouter.createCaller({ userId: null });
  try {
    const data = await caller.publicProfile.forJoin({ slug });
    const name = data.producer.displayName ?? "Producer";
    return {
      title: `Join ${name}'s studio · Skitza`,
      description: `Hear samples from ${name} and book a session on Skitza.`,
      openGraph: {
        title: `Join ${name}'s studio on Skitza`,
        type: "profile",
        ...(data.producer.logoUrl ? { images: [data.producer.logoUrl] } : {}),
      },
    };
  } catch {
    return { title: "Not found" };
  }
}

export default async function JoinPage({ params }: PageProps) {
  const { slug } = await params;
  const caller = appRouter.createCaller({ userId: null });

  let data;
  try {
    data = await caller.publicProfile.forJoin({ slug });
  } catch (err) {
    // The tRPC surface throws NOT_FOUND for unknown slugs. Anything
    // else (DB down, missing env) bubbles up so the error boundary can
    // log it — we don't want to mask a 500 as a 404.
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
  }

  // Separate count query for the locked-tracks teaser. Kept OUT of the
  // `forJoin` tRPC contract to keep that payload minimal + stable —
  // adding a field is cheap but means versioning the contract. This
  // count is render-only, no persistence or client-state.
  //
  // Runs in parallel-shape but we already awaited forJoin above; the
  // cost of a second round-trip is small (~ms) and only happens once
  // per request (no React Suspense retry). If this becomes a hot path
  // we can merge it back into `forJoin` behind an opt-in flag.
  const dbUrl = process.env.DATABASE_URL;
  let totalCount = 0;
  if (dbUrl) {
    const db = createDb(dbUrl);
    const rows = await db
      .select({ id: portfolioTracks.id })
      .from(portfolioTracks)
      .where(eq(portfolioTracks.producerId, data.producer.id));
    totalCount = rows.length;
  }
  const lockedCount = Math.max(0, totalCount - data.publicSamples.length);

  return (
    <div className="relative min-h-dvh">
      {/* Page-level container — no AppShell. Public routes don't need
          the producer sidebar / command palette. The (public) route
          group's PublicLayout has already set data-theme="chrome-dark"
          on a wrapper, so the background + text tokens are bound. */}
      <main className="relative z-10 flex min-h-dvh flex-col pb-20">
        {/* Accessible page title — the visible display font is h1, but
            we also want a plain-text, screen-reader-friendly label that
            ends with "· Skitza" so the document title + hero are
            consistent when an AT scrubs the landmark list. */}
        <h1 className="sr-only">
          Join {data.producer.displayName ?? "this producer"}&apos;s studio on Skitza
        </h1>

        <JoinHero producer={data.producer} />

        <PublicSamplesPlayer samples={data.publicSamples} />

        {/* Wave 2 Section B — external streaming links. Hidden when the
            producer hasn't added any. Renders inline embeds where we can
            parse a URL; falls back to "Listen on <Platform>" buttons for
            Bandcamp or malformed URLs. See PRD §6.2. */}
        <div className="mx-auto w-full max-w-3xl px-6 sm:px-10">
          <ExternalLinksSection links={data.externalLinks} />
        </div>

        {/* Locked-tracks teaser — just a text line for Wave 1. Only
            renders when there are actually more tracks the producer
            hasn't opted in; skipping the visual noise when the catalog
            is empty or fully-public keeps the page honest. The lock
            emoji is decorative; the copy conveys the meaning on its own
            for screen readers. */}
        {lockedCount > 0 ? (
          <p
            aria-label={`${String(lockedCount)} more tracks available after sign up`}
            className="mx-auto mt-6 max-w-3xl px-6 text-center font-mono text-xs uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))] sm:px-10"
          >
            <span aria-hidden className="mr-2">
              🔒
            </span>
            {lockedCount} more track{lockedCount === 1 ? "" : "s"} — sign up to unlock
          </p>
        ) : null}

        <SignupCta slug={slug} />

        <footer className="mt-auto pb-10 pt-16 text-center">
          <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            Powered by Skitza
          </p>
        </footer>
      </main>
    </div>
  );
}
