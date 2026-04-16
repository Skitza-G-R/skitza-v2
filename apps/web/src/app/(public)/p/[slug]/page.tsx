import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { resolveBrandStyle } from "~/lib/branding/theme-resolver";
import { loadProducerPortfolio } from "./load-portfolio";

// Next 15: route params arrive as a Promise.
type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  // Next dedupes within a single request, so the loader runs once per
  // /p/[slug] hit even though both generateMetadata and the page invoke it.
  const data = await loadProducerPortfolio(slug);
  if (!data) return { title: "Not found" };

  const { producer } = data;
  const title = `${producer.displayName ?? producer.slug} — Portfolio`;
  const logoUrl = producer.brand?.logoUrl;
  const openGraph: NonNullable<Metadata["openGraph"]> = {
    title,
    type: "profile",
    ...(logoUrl ? { images: [logoUrl] } : {}),
  };
  return {
    title,
    description: `Music portfolio by ${producer.displayName ?? producer.slug}.`,
    openGraph,
  };
}

export default async function PublicPortfolioPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await loadProducerPortfolio(slug);
  if (!data) notFound();

  const { producer, tracks } = data;
  const brandStyle = resolveBrandStyle({
    ...(producer.brand?.primary !== undefined ? { primary: producer.brand.primary } : {}),
    ...(producer.brand?.accent !== undefined ? { accent: producer.brand.accent } : {}),
  });
  // displayName is non-null here (loader filters out incomplete profiles)
  // but the schema type still allows null — narrow once for the JSX.
  const displayName = producer.displayName ?? producer.slug;

  return (
    <main style={brandStyle} className="p-8 max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-[rgb(var(--brand-accent))]">
          {displayName}
        </h1>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">Portfolio</p>
      </header>

      {tracks.length === 0 ? (
        <p className="text-[rgb(var(--fg-secondary))]">
          No tracks yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {tracks.map((track) => (
            <li
              key={track.id}
              className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
            >
              <h2 className="font-medium text-[rgb(var(--fg-primary))]">
                {track.title}
              </h2>
              {track.artist && (
                <p className="text-sm text-[rgb(var(--fg-secondary))]">
                  {track.artist}
                </p>
              )}
              {/*
                preload="none" — we don't want N tracks all hitting R2 on page
                load just so the player can show its duration. Waveform UI
                lands in weeks 6-8 (wavesurfer.js) and will replace this
                native <audio> element entirely.
              */}
              <audio
                controls
                preload="none"
                src={track.audioUrl}
                className="mt-3 w-full"
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
