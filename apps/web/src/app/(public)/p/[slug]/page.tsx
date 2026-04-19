import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { TrackPlayer } from "~/components/audio/track-player";
import { resolveBrandStyle } from "~/lib/branding/theme-resolver";
import { parseEmbedUrl } from "~/lib/portfolio/embed-url";
import { loadProducerPortfolio } from "./load-portfolio";
import { DwellBeacon } from "./dwell-beacon";

// Next 15: route params + searchParams arrive as Promises.
type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Basic UUID v4 validator — we don't want the beacon fired with a
// client-controlled garbage `via` value. If the format is wrong we
// silently drop it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  // Loader is wrapped in React.cache, so this and the page render share
  // one round-trip per request.
  const data = await loadProducerPortfolio(slug);
  if (!data) return { title: "Not found" };

  const { producer } = data;
  const title = `${producer.displayName} — Portfolio`;
  const logoUrl = producer.brand?.logoUrl;
  const openGraph: NonNullable<Metadata["openGraph"]> = {
    title,
    type: "profile",
    ...(logoUrl ? { images: [logoUrl] } : {}),
  };
  return {
    title,
    description: `Music portfolio by ${producer.displayName}.`,
    openGraph,
  };
}

// This is the signature surface of the app — the page that makes a cold
// lead say "this is who I want to work with". Deliberately editorial: big
// display type set in Fraunces at max optical size, an atmospheric hero
// gradient tuned to the producer's brand hue, and the tracks as a numbered
// magazine-style list rather than a grid.
export default async function PublicPortfolioPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { via } = await searchParams;
  const viewId = typeof via === "string" && UUID_RE.test(via) ? via : null;
  const data = await loadProducerPortfolio(slug);
  if (!data) notFound();

  const { producer, tracks } = data;
  const brandStyle = resolveBrandStyle({
    ...(producer.brand?.primary !== undefined ? { primary: producer.brand.primary } : {}),
    ...(producer.brand?.accent !== undefined ? { accent: producer.brand.accent } : {}),
  });

  const initials = producer.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div style={brandStyle} className="relative min-h-dvh overflow-hidden">
      {viewId ? <DwellBeacon viewId={viewId} /> : null}
      {/* Atmospheric hero backdrop — brand hues bloom behind the title. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-[-8rem] h-[40rem] w-[40rem] rounded-full bg-[rgb(var(--brand-primary)/0.14)] blur-[140px]" />
        <div className="absolute right-[-18rem] top-[28rem] h-[32rem] w-[32rem] rounded-full bg-[rgb(var(--brand-accent)/0.12)] blur-[140px]" />
      </div>

      <main className="relative z-10 mx-auto max-w-4xl px-6 pb-24 pt-14 sm:px-10 sm:pt-20">
        {/* Hero */}
        <header className="reveal-up">
          <div className="flex items-center gap-4">
            {producer.brand?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={producer.brand.logoUrl}
                alt=""
                className="h-12 w-12 rounded-full border border-[rgb(var(--border-subtle))] object-cover"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-gradient-to-br from-[rgb(var(--brand-primary)/0.6)] to-[rgb(var(--brand-accent)/0.5)] font-display text-sm text-[rgb(var(--fg-inverse))]"
              >
                {initials || "S"}
              </div>
            )}
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
              Portfolio · {tracks.length} track{tracks.length === 1 ? "" : "s"}
            </p>
          </div>

          <h1
            className="mt-8 font-display text-[clamp(3rem,11vw,7rem)] leading-[0.94] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            {producer.displayName}
          </h1>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href={`/p/${slug}/book`}
              className="pulse-glow inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-5 py-3 text-sm font-semibold text-[#0C0A07] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.35)] transition-transform hover:scale-[1.03] active:translate-y-[1px]"
            >
              Book a session →
            </Link>
            <div className="h-px flex-1 bg-[rgb(var(--brand-primary))] sm:flex-none sm:w-16" />
          </div>
        </header>

        {/* Tracks — editorial numbered list, not a grid. */}
        <section className="mt-14 reveal-up-delay-1">
          {tracks.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-8 text-center">
              <p className="font-mono text-sm text-[rgb(var(--fg-muted))]">
                The tracklist is on its way. Book a session — the work will land here.
              </p>
              <Link
                href={`/p/${slug}/book`}
                className="mt-4 inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[#0C0A07] hover:brightness-110"
              >
                Book a session
              </Link>
            </div>
          ) : (
            <ol className="flex flex-col divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
              {tracks.map((track, idx) => (
                <li
                  key={track.id}
                  className="group py-6 transition-colors hover:bg-[rgb(var(--bg-elevated)/0.6)]"
                >
                  <div className="flex items-start gap-5 sm:gap-8">
                    {/* Track number — display face, large. */}
                    <span
                      className="font-display text-4xl leading-none text-[rgb(var(--fg-muted))] transition-colors group-hover:text-[rgb(var(--brand-primary))] sm:text-5xl"
                      style={{ fontVariationSettings: '"opsz" 144' }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>

                    {/* Artwork — square, prominent. Scales on row hover
                        for a subtle "lift" cue. Falls back to gradient. */}
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] transition-transform duration-200 ease-out group-hover:scale-[1.03] group-hover:shadow-[var(--shadow-md)] sm:h-28 sm:w-28">
                      {track.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={track.artworkUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading={idx < 3 ? undefined : "lazy"}
                        />
                      ) : (
                        <div
                          aria-hidden
                          className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[rgb(var(--brand-primary)/0.5)] to-[rgb(var(--brand-accent)/0.4)] font-display text-2xl text-[rgb(var(--fg-inverse))]"
                        >
                          ♪
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2
                        className="font-display text-2xl leading-tight tracking-tight sm:text-3xl"
                        style={{ fontVariationSettings: '"opsz" 96' }}
                      >
                        {track.title}
                      </h2>
                      {track.artist ? (
                        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
                          {track.artist}
                        </p>
                      ) : null}
                      {/*
                        TrackPlayer uses a hidden <audio preload="none"> under the hood
                        (no N tracks hammering R2/CDN on first paint) and lays our own
                        brand-tinted transport on top of it. Wavesurfer lands in
                        weeks 6-8 as a drop-in replacement on this same interface.
                      */}
                      <div className="mt-4 max-w-md">
                        <PortfolioAudio
                          audioUrl={track.audioUrl}
                          title={track.title}
                        />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="mt-16 flex items-center justify-between text-xs reveal-up-delay-2">
          <p className="font-mono text-[rgb(var(--fg-muted))]">
            {producer.displayName} · presented by{" "}
            <Link
              href="/"
              className="underline-offset-4 hover:text-[rgb(var(--fg-primary))] hover:underline"
            >
              Skitza
            </Link>
          </p>
          <Link
            href="/sign-up"
            className="font-mono text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--brand-primary))]"
          >
            Make yours →
          </Link>
        </footer>
      </main>
    </div>
  );
}

// Renders the right player for a portfolio track:
//   - recognized streaming URL (Spotify/SoundCloud/YouTube/Apple)
//     → platform's official embed iframe
//   - direct audio URL (R2 or elsewhere) → our native TrackPlayer
//   - null (still processing an upload) → "Processing" chip
//
// YouTube and Apple are video-ish; they need a taller frame (352px
// is the canonical size for both). Spotify/SoundCloud are audio-only
// and look best at the compact 152px widget height.
function PortfolioAudio({
  audioUrl,
  title,
}: {
  audioUrl: string | null;
  title: string;
}) {
  if (!audioUrl) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2.5 py-1 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        Processing
      </span>
    );
  }
  const embed = parseEmbedUrl(audioUrl);
  if (embed) {
    const tall = embed.source === "youtube" || embed.source === "apple";
    return (
      <iframe
        src={embed.embedUrl}
        title={`${title} — ${embed.source} player`}
        width="100%"
        height={tall ? 352 : 152}
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
        loading="lazy"
        className="w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]"
      />
    );
  }
  return <TrackPlayer src={audioUrl} label={title} />;
}
