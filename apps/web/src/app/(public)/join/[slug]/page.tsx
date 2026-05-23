import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";

import { createDb, eq, portfolioTracks } from "@skitza/db";
import { appRouter } from "~/server/trpc/routers/_app";
import { JoinNav } from "~/components/join/join-nav";
import { JoinBento } from "~/components/join/join-bento";
import { JoinMiniPlayer } from "~/components/join/join-mini-player";

// SK-25: compacted to a single-viewport layout. The old hero +
// meta-strip + samples-section + dark-CTA scroll-stack was replaced by
// a single <JoinBento> — left column identity, right column portrait +
// compact samples rail. On mobile the portrait drops and the rail
// collapses to one expanded waveform + N compact rows.
//
// Booking is still gated on signup (Layer 1, 2026-05-06): every CTA
// links to /sign-up/join/<slug>. No inline booking modal.
//
// English-only, LTR-only per CLAUDE.md i18n scope — public route.

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
  // `forJoin` tRPC contract to keep that payload minimal + stable.
  // Render-only, no persistence or client-state.
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
    <div className="relative flex min-h-dvh flex-col">
      <JoinNav />

      <main className="relative z-0 flex flex-1 flex-col">
        {/* SR-only page title — the visible H1 is "Recent work"-adjacent
            inside the bento; this label gives the document a clean
            landmark for screen readers. */}
        <h1 className="sr-only">
          Join {data.producer.displayName ?? "this producer"}&apos;s studio on Skitza
        </h1>

        <JoinBento
          producer={data.producer}
          slug={slug}
          externalLinks={data.externalLinks}
          meta={data.meta}
          samples={data.publicSamples}
          lockedCount={lockedCount}
        />

        {/* Floating mini player — appears at the bottom only when the
            visitor clicks a sample row. Reuses the same `skitza:player:*`
            event bus as the dashboard's <PersistentPlayer />. Passing
            samples + producerName so the dock can resolve prev/next
            from the playlist context and apply the producer-name
            subtitle fallback when a sample lacks an artist. */}
        <JoinMiniPlayer
          samples={data.publicSamples}
          producerName={data.producer.displayName ?? ""}
        />
      </main>
    </div>
  );
}
