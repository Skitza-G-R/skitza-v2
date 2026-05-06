// Editorial hero for the `/join/<slug>` teaser page.
//
// Design alignment (post-restore, 2026-05-06): Two-column layout on
// desktop — bio + CTAs on the left, portrait card with grain texture +
// monogram glyph on the right. On mobile the columns stack and the
// portrait drops to half-height. Typography is Syne 800 at clamp(54px,
// 8vw, 92px) per the design context spec.
//
// The portrait card is a visual placeholder when no logoUrl is set:
// amber → copper gradient + a tactile grain noise overlay + the
// producer's monogram inset. By design — no real photo upload yet, but
// the surface still feels intentional and on-brand.
//
// Server component (no interactive state) — the whole page is SSR and
// the producer payload is stable per-request.
//
// English-only, LTR-only per CLAUDE.md i18n scope: this is the public
// route and translation strings would leak past the per-locale wave.

import { BookingFlowTrigger } from "./booking-flow-trigger";

interface JoinHeroProps {
  producer: {
    displayName: string | null;
    bio: string | null;
    logoUrl: string | null;
  };
  slug: string;
  externalLinks?: Array<{ platform: string; url: string; title: string | null }>;
}

// Inline SVG fractal-noise data URL — same recipe as landing.css's
// .noise-overlay, but lives here so we can apply it INSIDE the (public)
// layout without depending on `.landing-root` scoping.
const GRAIN_NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")";

// Display labels for the streaming chips — matches v3-clean's existing
// pattern. Lowercase platform keys ("spotify", "youtube",
// "instagram_reels") come straight from the `producer_external_links`
// table.
const PLATFORM_LABELS: Record<string, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  instagram_reels: "Instagram",
};

export function JoinHero({ producer, slug, externalLinks }: JoinHeroProps) {
  // Fall back to the word "Producer" if displayName is null — can only
  // happen in tests or mid-onboarding before the producer sets a name.
  const name = producer.displayName ?? "Producer";

  // Initials as portrait monogram fallback when logoUrl is null. Two
  // chars max, uppercase, split on whitespace.
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="relative overflow-hidden pb-12 pt-10 sm:pb-16 sm:pt-16">
      {/* Ambient amber + copper drift blobs — soft brand world. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <span
          className="absolute left-[-12%] top-[-8rem] h-[32rem] w-[32rem] rounded-full blur-[120px]"
          style={{
            background: "rgb(var(--brand-primary) / 0.14)",
            animation: "skitza-drift 25s ease-in-out infinite alternate",
          }}
        />
        <span
          className="absolute right-[-10%] top-[20%] h-[28rem] w-[28rem] rounded-full blur-[120px]"
          style={{
            background: "rgb(var(--brand-accent) / 0.12)",
            animation: "skitza-drift 30s ease-in-out -5s infinite alternate",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 sm:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:gap-12">
          {/* Left column: eyebrow → headline → bio → CTAs. */}
          <div className="reveal-up">
            <p className="mb-4 font-mono text-[0.66rem] uppercase tracking-[0.22em] text-[rgb(var(--brand-primary))] sm:mb-5 sm:text-[0.72rem]">
              Music Producer · Taking new projects
            </p>

            <h1
              className="font-[var(--font-head)] text-[clamp(3.4rem,8vw,5.75rem)] font-extrabold leading-[0.94] tracking-[-0.032em]"
              style={{ fontFamily: "var(--font-head), var(--font-display)" }}
            >
              {name}
            </h1>

            {producer.bio ? (
              <p className="reveal-up-delay-1 mt-6 max-w-xl text-base leading-[1.55] text-[rgb(var(--fg-secondary))] sm:text-lg">
                {producer.bio}
              </p>
            ) : (
              <p className="reveal-up-delay-1 mt-6 max-w-xl text-base leading-[1.55] text-[rgb(var(--fg-muted))] sm:text-lg">
                A studio for artists who care about the take, not just the sound.
              </p>
            )}

            {/* Streaming chips — Spotify / YouTube / Instagram. Driven
                by `producer_external_links` (v3-clean). Renders only
                when at least one link has a non-empty URL; otherwise
                stays out of the layout entirely. Chip styling matches
                the eyebrow above (mono, brand-primary, wide tracking)
                so the row reads like a continuation of the metadata
                rather than a standalone block. */}
            {externalLinks && externalLinks.filter((l) => l.url).length > 0 ? (
              <div className="reveal-up-delay-2 mt-6 flex flex-wrap gap-x-5 gap-y-2">
                {externalLinks
                  .filter((l) => l.url)
                  .map((link) => (
                    <a
                      key={link.platform}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs uppercase tracking-[0.15em] text-[rgb(var(--brand-primary))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
                    >
                      {PLATFORM_LABELS[link.platform] ?? link.platform}
                    </a>
                  ))}
              </div>
            ) : null}

            <div className="reveal-up-delay-2 mt-8 flex flex-wrap gap-3">
              <BookingFlowTrigger
                slug={slug}
                producerName={name}
                className={[
                  "sk-pop inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap",
                  "rounded-[var(--radius-md)] bg-[rgb(var(--fg-primary))] px-5 py-3",
                  "text-sm font-bold text-[rgb(var(--bg-base))]",
                  "transition-transform hover:-translate-y-[1px]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
                ].join(" ")}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Book a session
              </BookingFlowTrigger>

              <a
                href="#work"
                className={[
                  "sk-pop inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap",
                  "rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] px-5 py-3",
                  "text-sm font-bold text-[rgb(var(--fg-primary))]",
                  "transition-colors hover:bg-[rgb(var(--bg-elevated))]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
                ].join(" ")}
              >
                <HeadphonesIcon className="h-3.5 w-3.5" />
                Listen first
              </a>
            </div>
          </div>

          {/* Right column: portrait card. Real photo if logoUrl is set,
              otherwise gradient + grain + monogram inset. */}
          <div
            aria-hidden={!producer.logoUrl}
            className="reveal-up-delay-1 relative aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)]"
            style={{
              background:
                "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-accent)) 60%, rgb(var(--fg-primary)) 100%)",
            }}
          >
            {producer.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={producer.logoUrl}
                alt={`Portrait of ${name}`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <>
                {/* Grain texture overlay — subtle, tactile. */}
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-50 mix-blend-overlay"
                  style={{ backgroundImage: GRAIN_NOISE_URL }}
                />
                {/* Monogram inset — large, bottom-right. */}
                <div
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span
                    className="font-extrabold text-[rgb(var(--fg-inverse))]/80 text-[clamp(6rem,16vw,12rem)] leading-none tracking-tight"
                    style={{ fontFamily: "var(--font-head), var(--font-display)" }}
                  >
                    {initials || "S"}
                  </span>
                </div>
              </>
            )}

            {/* Studio caption — bottom-left mono microcopy. */}
            <div className="absolute bottom-4 left-4 right-4 z-10">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-inverse))]/80 sm:text-[0.7rem]">
                Currently in studio · listening loud
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

// Minimal inline icons — keeps the hero self-contained and avoids
// pulling in a new icon dep just for two glyphs.
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function HeadphonesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}
