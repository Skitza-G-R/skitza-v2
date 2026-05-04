// Editorial hero for the `/join/<slug>` teaser page.
//
// Visual vocabulary follows the landing hero (`components/landing/hero.tsx`):
// amber + copper ambient gradient, display-face name at clamp(), mono-
// uppercase eyebrow above. Lives at the top of the join page and sets
// tone for the rest of the scroll — samples, teaser, CTA. (Succeeds the
// retired `/p/<slug>` portfolio page, which was deleted in Story 03 per
// PRD §6.6.)
//
// Server component (no interactive state) — the whole page is SSR and
// the producer payload is stable per-request. If we later add a logo
// upload interaction we'll split the avatar into its own client comp.

interface JoinHeroProps {
  producer: {
    displayName: string | null;
    bio: string | null;
    logoUrl: string | null;
  };
  externalLinks?: Array<{ platform: string; url: string; title: string | null }>;
}

const PLATFORM_LABELS: Record<string, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  instagram_reels: "Instagram",
};

export function JoinHero({ producer, externalLinks }: JoinHeroProps) {
  // Fall back to the word "Producer" if displayName is null — can only
  // happen in tests or mid-onboarding before the producer sets a name.
  const name = producer.displayName ?? "Producer";

  // Initials as avatar fallback when logoUrl is null. Two chars max,
  // uppercase, split on whitespace — same rule the public portfolio
  // uses so the visual feels consistent.
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="relative overflow-hidden pb-14 pt-16 sm:pb-20 sm:pt-24">
      {/* Ambient amber + copper drift blobs — copied directly from the
          landing hero so the public `/join` surface feels like the same
          brand world. Pointer-events-none because they're purely visual. */}
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

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center sm:px-10">
        {/* Avatar + eyebrow on the same baseline — mobile-first stack
            that folds to a horizontal pair on ≥sm screens. */}
        <div className="reveal-up flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          {producer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={producer.logoUrl}
              alt=""
              className="h-16 w-16 rounded-full border border-[rgb(var(--border-subtle))] object-cover shadow-[var(--shadow-md)]"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-16 w-16 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-gradient-to-br from-[rgb(var(--brand-primary)/0.7)] to-[rgb(var(--brand-accent)/0.5)] font-display text-xl text-[rgb(var(--fg-inverse))] shadow-[var(--shadow-md)]"
            >
              {initials || "S"}
            </div>
          )}
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.2em] text-[rgb(var(--brand-primary))]">
            Join the studio
          </p>
        </div>

        <h1
          className="reveal-up-delay-1 mt-8 font-display text-[clamp(2.5rem,9vw,5rem)] leading-[0.96] tracking-tight"
          style={{ fontWeight: 800 }}
        >
          {name}
        </h1>

        {producer.bio ? (
          <p className="reveal-up-delay-2 mx-auto mt-6 max-w-xl text-base leading-relaxed text-[rgb(var(--fg-secondary))] sm:text-lg">
            {producer.bio}
          </p>
        ) : null}

        {externalLinks && externalLinks.filter((l) => l.url).length > 0 ? (
          <div className="reveal-up-delay-3 mt-6 flex justify-center gap-4">
            {externalLinks
              .filter((l) => l.url)
              .map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs uppercase tracking-[0.15em] text-[rgb(var(--brand-primary))] hover:underline"
                >
                  {PLATFORM_LABELS[link.platform] ?? link.platform}
                </a>
              ))}
          </div>
        ) : null}

        {/* A tiny divider before the samples section below — keeps the
            hero feeling deliberate, with a narrow brand-primary rule. */}
        <div
          aria-hidden
          className="reveal-up-delay-3 mx-auto mt-10 h-px w-16 bg-[rgb(var(--brand-primary))]"
        />
      </div>
    </header>
  );
}
