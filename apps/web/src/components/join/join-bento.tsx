// SK-25: Asymmetrical bento for /join/<slug>.
//
// Replaces the old (hero + meta-strip + samples-section + dark CTA)
// scroll-stack with a single-viewport layout. On desktop the page fits
// in one frame: left column = identity (eyebrow pill, name, bio, CTAs,
// socials, inline meta chips), right column = portrait card + compact
// samples rail. On mobile the portrait is dropped entirely — the H1 +
// amber accent carry the visual weight while the samples rail collapses
// to one expanded waveform + two compact rows.
//
// The samples rail intentionally lives INSIDE this component (not in
// public-samples-player.tsx anymore) so the compact variant doesn't
// leak its dense styling into the future authenticated player.

"use client";

import Link from "next/link";

import { WaveformPlayer } from "~/components/audio/waveform-player";
import {
  formatGenres,
  formatResponseHours,
} from "./join-meta-strip";
import type { JoinMeta } from "./join-meta-types";

interface PublicSample {
  id: string;
  title: string;
  artist: string | null;
  audioUrl: string | null;
  durationMs: number | null;
  peaksR2Key: string | null;
}

interface JoinBentoProps {
  producer: {
    displayName: string | null;
    bio: string | null;
    logoUrl: string | null;
  };
  slug: string;
  externalLinks?: ReadonlyArray<{
    platform: string;
    url: string;
    title: string | null;
  }>;
  meta?: JoinMeta | null;
  samples: ReadonlyArray<PublicSample>;
  lockedCount: number;
}

// Inline fractal noise — same recipe as the old join-hero so the
// portrait card keeps its tactile grain.
const GRAIN_NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")";

const PLATFORM_LABELS: Record<string, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  instagram: "Instagram",
  instagram_reels: "Instagram",
  soundcloud: "SoundCloud",
  apple_music: "Apple Music",
  bandcamp: "Bandcamp",
  tiktok: "TikTok",
};

// Linear's signature ease — slightly underdamped spring feel.
const EASE_LINEAR = "cubic-bezier(0.32,0.72,0,1)";

export function JoinBento({
  producer,
  slug,
  externalLinks,
  meta,
  samples,
  lockedCount,
}: JoinBentoProps) {
  const name = producer.displayName ?? "Producer";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const visibleLinks =
    externalLinks?.filter((l) => l.url && l.url.trim().length > 0) ?? [];

  const metaChips: Array<{ key: string; value: string }> = [];
  const genres = formatGenres(meta?.genres ?? null);
  const response = formatResponseHours(meta?.responseHours ?? null);
  const streams = meta?.streamsSummary?.trim() || null;
  if (genres) metaChips.push({ key: "genres", value: genres });
  if (response) metaChips.push({ key: "response", value: response });
  if (streams) metaChips.push({ key: "streams", value: streams });

  return (
    <section
      aria-label="Producer profile"
      className="relative mx-auto w-full max-w-6xl px-4 pb-8 pt-6 sm:px-8 sm:pt-8 lg:px-10"
    >
      {/* Grid: stacks on mobile, splits 1.35fr / 1fr on lg+. */}
      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:gap-10">
        <IdentityColumn
          name={name}
          bio={producer.bio}
          slug={slug}
          visibleLinks={visibleLinks}
          metaChips={metaChips}
        />

        <MediaColumn
          name={name}
          initials={initials}
          logoUrl={producer.logoUrl}
          samples={samples}
          lockedCount={lockedCount}
          slug={slug}
        />
      </div>
    </section>
  );
}

// ─── Identity column ───────────────────────────────────────────────

interface IdentityColumnProps {
  name: string;
  bio: string | null;
  slug: string;
  visibleLinks: ReadonlyArray<{
    platform: string;
    url: string;
    title: string | null;
  }>;
  metaChips: ReadonlyArray<{ key: string; value: string }>;
}

function IdentityColumn({
  name,
  bio,
  slug,
  visibleLinks,
  metaChips,
}: IdentityColumnProps) {
  return (
    <div className="flex flex-col justify-between gap-6">
      <div>
        {/* Eyebrow tag — replaces the plain mono line. Uses --radius-sm
            (8px) per design system: text rectangles never go full pill. */}
        <span
          className={[
            "reveal-up inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1",
            "ring-1 ring-[rgb(var(--fg-primary)/0.12)]",
            "font-mono text-[0.62rem] font-medium uppercase tracking-[0.22em]",
            "text-[rgb(var(--brand-primary))]",
          ].join(" ")}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]"
          />
          Music Producer · Now Booking
        </span>

        <h2
          className={[
            "reveal-up mt-4 font-extrabold leading-[0.94] tracking-[-0.03em]",
            // Tighter clamps than the old hero so 2-line names stay in viewport.
            "text-[clamp(2.4rem,9vw,3.2rem)] sm:text-[clamp(2.6rem,5.5vw,4.25rem)]",
          ].join(" ")}
          style={{ fontFamily: "var(--font-head), var(--font-display)" }}
        >
          {name}
        </h2>

        <p
          className={[
            "reveal-up-delay-1 mt-4 max-w-xl text-[0.95rem] leading-[1.55]",
            bio
              ? "text-[rgb(var(--fg-secondary))]"
              : "text-[rgb(var(--fg-muted))]",
            "sm:text-base",
          ].join(" ")}
        >
          {bio ?? "A studio for artists who care about the take, not just the sound."}
        </p>

        {/* CTAs — primary uses button-in-button (nested arrow circle).
            Radius follows the locked design system: rounded-[var(--radius-lg)]
            (16px) for h-11+ text buttons. The nested circle is square so
            it keeps rounded-full. */}
        <div className="reveal-up-delay-2 mt-6 flex flex-wrap items-center gap-3">
          <Link
            href={`/sign-up/join/${encodeURIComponent(slug)}`}
            className="group inline-flex min-h-11 items-center gap-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-primary))] py-1.5 pl-5 pr-1.5 text-sm font-bold text-[rgb(var(--bg-base))] transition-transform duration-500 hover:-translate-y-[1px] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
            style={{ transitionTimingFunction: EASE_LINEAR }}
          >
            Book a session
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--bg-base)/0.12)] transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-[1px]"
              style={{ transitionTimingFunction: EASE_LINEAR }}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          <a
            href="#samples"
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-primary)/0.14)] px-5 py-2 text-sm font-semibold text-[rgb(var(--fg-primary))] transition-colors duration-300 hover:border-[rgb(var(--fg-primary)/0.32)] hover:bg-[rgb(var(--fg-primary)/0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
          >
            <HeadphonesIcon className="h-3.5 w-3.5" />
            Listen first
          </a>
        </div>

        {/* Social links — inline mono row. */}
        {visibleLinks.length > 0 ? (
          <div className="reveal-up-delay-2 mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {visibleLinks.map((link) => (
              <a
                key={link.platform}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))] transition-colors duration-300 hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline"
              >
                {PLATFORM_LABELS[link.platform] ?? link.platform}
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {/* Inline meta chips — bottom of left column on desktop. */}
      {metaChips.length > 0 ? (
        <dl className="reveal-up-delay-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[rgb(var(--fg-primary)/0.06)] pt-4">
          {metaChips.map((chip, idx) => (
            <div key={chip.key} className="flex items-center gap-3">
              {idx > 0 ? (
                <span
                  aria-hidden
                  className="h-1 w-1 rounded-full bg-[rgb(var(--fg-muted)/0.5)]"
                />
              ) : null}
              <dd className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--fg-secondary))]">
                {chip.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

// ─── Media column (portrait + samples rail) ────────────────────────

interface MediaColumnProps {
  name: string;
  initials: string;
  logoUrl: string | null;
  samples: ReadonlyArray<PublicSample>;
  lockedCount: number;
  slug: string;
}

function MediaColumn({
  name,
  initials,
  logoUrl,
  samples,
  lockedCount,
  slug,
}: MediaColumnProps) {
  // Portrait card hidden on mobile — identity is carried by the H1.
  // The samples rail sits flush below it on desktop / stands alone on mobile.
  return (
    <div className="flex flex-col gap-4">
      {/* Portrait — desktop only. Double-bezel: outer shell + inner core. */}
      <div className="reveal-up-delay-1 hidden lg:block">
        <div
          className={[
            "rounded-[1.75rem] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.05)]",
            "bg-[rgb(var(--fg-primary)/0.025)]",
          ].join(" ")}
        >
          <div
            aria-hidden={!logoUrl}
            className="relative aspect-[16/10] w-full overflow-hidden"
            style={{
              borderRadius: "calc(1.75rem - 0.375rem)",
              background:
                "radial-gradient(120% 100% at 25% 20%, rgb(var(--brand-primary)) 0%, rgb(var(--brand-accent)) 55%, rgb(var(--fg-primary)) 100%)",
              boxShadow:
                "inset 0 1px 1px rgb(255 255 255 / 0.15), inset 0 -40px 80px -40px rgb(0 0 0 / 0.35)",
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`Portrait of ${name}`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <>
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-50 mix-blend-overlay"
                  style={{ backgroundImage: GRAIN_NOISE_URL }}
                />
                <div
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span
                    className="font-extrabold leading-none tracking-tight text-[rgb(var(--fg-inverse))]/85 text-[clamp(4rem,10vw,7.5rem)]"
                    style={{
                      fontFamily: "var(--font-head), var(--font-display)",
                    }}
                  >
                    {initials || "S"}
                  </span>
                </div>
              </>
            )}
            <p className="absolute bottom-3 left-4 right-4 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-inverse))]/80">
              Currently in studio · listening loud
            </p>
          </div>
        </div>
      </div>

      <SamplesRail
        samples={samples}
        lockedCount={lockedCount}
        slug={slug}
      />
    </div>
  );
}

// ─── Compact samples rail (1 expanded + N compact + locked teaser) ──

interface SamplesRailProps {
  samples: ReadonlyArray<PublicSample>;
  lockedCount: number;
  slug: string;
}

function SamplesRail({ samples, lockedCount, slug }: SamplesRailProps) {
  // Empty state — short, on-brand, no big dashed card.
  if (samples.length === 0) {
    return (
      <div
        id="samples"
        className={[
          "rounded-[1.75rem] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.05)]",
          "bg-[rgb(var(--fg-primary)/0.025)]",
        ].join(" ")}
      >
        <div
          className="flex items-center justify-center px-6 py-8 text-center"
          style={{ borderRadius: "calc(1.75rem - 0.375rem)" }}
        >
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Samples coming soon
          </p>
        </div>
      </div>
    );
  }

  const [feature, ...rest] = samples;
  // Feature is non-null because samples.length > 0 (typescript narrows
  // off the literal array destructure rather than the runtime check).
  if (!feature) return null;

  return (
    <div
      id="samples"
      className={[
        "rounded-[1.75rem] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.05)]",
        "bg-[rgb(var(--fg-primary)/0.025)]",
      ].join(" ")}
    >
      <div
        className="bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
        style={{ borderRadius: "calc(1.75rem - 0.375rem)" }}
      >
        {/* Section label — small, mono, no big H2. */}
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Recent work
          </p>
          <p
            aria-hidden
            className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
          >
            01 / {String(samples.length).padStart(2, "0")}
          </p>
        </div>

        {/* Featured (expanded) track. */}
        <div className="mb-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-base font-extrabold leading-tight tracking-[-0.015em] text-[rgb(var(--fg-primary))]"
                style={{ fontFamily: "var(--font-head), var(--font-display)" }}
              >
                {feature.title}
              </h3>
              {feature.artist ? (
                <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-secondary))]">
                  {feature.artist}
                </p>
              ) : null}
            </div>
          </div>
          {feature.audioUrl ? (
            <WaveformPlayer
              src={feature.audioUrl}
              label={`${feature.title}${feature.artist ? ` by ${feature.artist}` : ""}`}
              height={56}
            />
          ) : (
            <p className="font-mono text-xs uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              Processing audio…
            </p>
          )}
        </div>

        {/* Compact rows for tracks 2..N. */}
        {rest.length > 0 ? (
          <ul className="flex flex-col divide-y divide-[rgb(var(--fg-primary)/0.06)] border-t border-[rgb(var(--fg-primary)/0.06)]">
            {rest.map((sample, idx) => (
              <li
                key={sample.id}
                className="flex items-center gap-3 py-2.5"
              >
                <span
                  className="w-6 shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]"
                  aria-hidden
                >
                  {String(idx + 2).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[rgb(var(--fg-primary))]">
                    {sample.title}
                  </p>
                  {sample.artist ? (
                    <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
                      {sample.artist}
                    </p>
                  ) : null}
                </div>
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
                  {formatDuration(sample.durationMs)}
                </span>
              </li>
            ))}

            {lockedCount > 0 ? (
              <li className="flex items-center gap-3 py-2.5 text-[rgb(var(--fg-muted))]">
                <span aria-hidden className="w-6 shrink-0 text-center">
                  🔒
                </span>
                <Link
                  href={`/sign-up/join/${encodeURIComponent(slug)}`}
                  className="flex-1 truncate text-sm font-semibold hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline"
                >
                  {lockedCount} more track{lockedCount === 1 ? "" : "s"} — sign up to unlock
                </Link>
              </li>
            ) : null}
          </ul>
        ) : lockedCount > 0 ? (
          <p className="mt-2 border-t border-[rgb(var(--fg-primary)/0.06)] pt-3 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            <span aria-hidden className="mr-2">🔒</span>
            {lockedCount} more track{lockedCount === 1 ? "" : "s"} — sign up to unlock
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

// ─── Inline glyphs ────────────────────────────────────────────────

function ArrowUpRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
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
