// SK-25 (v2 — centered stack): /join/<slug> redesigned per Gili's
// review of the bento split-column. New shape is a single centered
// column: portrait (small square) → eyebrow → name → bio → social
// chips → primary CTA + sign-up disclosure → samples card. Same
// "fits-one-viewport" goal, but the visual rhythm now reads like a
// Linear contact page / Spotify artist landing rather than a
// two-column dashboard.
//
// Three notable fixes from v1:
//   1. The samples card is now a LIGHT surface (warm cream + tiny
//      amber wash). v1 used `--bg-elevated` which under the public
//      layout's `data-theme="chrome-dark"` resolves to a near-black
//      value — and `--fg-primary` stayed warm-dark, so titles became
//      dark-on-dark. We anchor explicitly to `--bg-base` here.
//   2. Social links are no longer plain mono text — they're chip
//      buttons with platform glyphs (spotify/youtube/instagram/etc),
//      so a visitor reads them as actionable links not labels.
//   3. CTA disclosure: a small mono line below the primary "Book a
//      session" pill reads "Sign in or sign up to continue · Free",
//      so the visitor knows the next step gates on auth rather than
//      surprising them after the tap.

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

// Linear's signature ease.
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

  // Meta chips — same 3 fields as v1, rendered as a mono line under
  // the samples card (small print, not a primary surface).
  const metaChips: string[] = [];
  const genres = formatGenres(meta?.genres ?? null);
  const response = formatResponseHours(meta?.responseHours ?? null);
  const streams = meta?.streamsSummary?.trim() || null;
  if (genres) metaChips.push(genres);
  if (response) metaChips.push(response);
  if (streams) metaChips.push(streams);

  return (
    <section
      aria-label="Producer profile"
      className="relative mx-auto flex w-full max-w-2xl flex-col items-center px-4 pb-8 pt-4 text-center sm:px-6 sm:pt-6"
    >
      <Portrait name={name} initials={initials} logoUrl={producer.logoUrl} />

      {/* Eyebrow pill. */}
      <span
        className={[
          "reveal-up-delay-1 mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1",
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

      {/* Name — smaller than v1 since the portrait now sits above it. */}
      <h2
        className={[
          "reveal-up-delay-1 mt-3 font-extrabold leading-[0.94] tracking-[-0.03em]",
          "text-[clamp(2rem,7vw,2.75rem)] sm:text-[clamp(2.25rem,4.5vw,3.25rem)]",
        ].join(" ")}
        style={{ fontFamily: "var(--font-head), var(--font-display)" }}
      >
        {name}
      </h2>

      {/* Bio — centered, narrow column for readability. */}
      <p
        className={[
          "reveal-up-delay-2 mt-3 max-w-md text-[0.95rem] leading-[1.55]",
          producer.bio
            ? "text-[rgb(var(--fg-secondary))]"
            : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        {producer.bio ?? "A studio for artists who care about the take, not just the sound."}
      </p>

      {/* Social chip buttons — icon + label. */}
      {visibleLinks.length > 0 ? (
        <ul className="reveal-up-delay-2 mt-5 flex flex-wrap items-center justify-center gap-2">
          {visibleLinks.map((link) => (
            <li key={link.platform}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={[
                  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5",
                  "ring-1 ring-[rgb(var(--fg-primary)/0.12)]",
                  "bg-[rgb(var(--fg-primary)/0.025)]",
                  "text-[0.72rem] font-semibold text-[rgb(var(--fg-primary))]",
                  "transition-colors duration-300",
                  "hover:bg-[rgb(var(--fg-primary)/0.06)] hover:ring-[rgb(var(--fg-primary)/0.24)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
                ].join(" ")}
              >
                <PlatformIcon
                  platform={link.platform}
                  className="h-3 w-3 text-[rgb(var(--brand-primary))]"
                />
                {PLATFORM_LABELS[link.platform] ?? link.platform}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Primary CTA + sign-up disclosure. */}
      <div className="reveal-up-delay-3 mt-6 flex flex-col items-center gap-2">
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
        <p className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Sign in or sign up to continue · Free
        </p>
      </div>

      {/* Samples card — LIGHT surface (cream + tiny amber wash). */}
      <div className="reveal-up-delay-3 mt-7 w-full">
        <SamplesCard
          samples={samples}
          lockedCount={lockedCount}
          slug={slug}
        />
      </div>

      {/* Meta line under the samples — small mono print. */}
      {metaChips.length > 0 ? (
        <p className="reveal-up-delay-4 mt-5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          {metaChips.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

// ─── Portrait (centered, smaller square) ───────────────────────────

interface PortraitProps {
  name: string;
  initials: string;
  logoUrl: string | null;
}

function Portrait({ name, initials, logoUrl }: PortraitProps) {
  return (
    <div
      className={[
        "reveal-up rounded-[var(--radius-xl)] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.05)]",
        "bg-[rgb(var(--fg-primary)/0.025)]",
      ].join(" ")}
    >
      <div
        aria-hidden={!logoUrl}
        className="relative h-40 w-40 overflow-hidden sm:h-48 sm:w-48"
        style={{
          // Inner radius = outer radius (--radius-xl: 20px) minus the
          // p-1.5 (6px) gap, so concentric curves stay parallel.
          borderRadius: "calc(var(--radius-xl) - 6px)",
          background:
            "radial-gradient(120% 100% at 30% 25%, rgb(var(--brand-primary)) 0%, rgb(var(--brand-accent)) 55%, rgb(var(--fg-primary)) 100%)",
          boxShadow:
            "inset 0 1px 1px rgb(255 255 255 / 0.15), inset 0 -32px 64px -32px rgb(0 0 0 / 0.4)",
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
                className="font-extrabold leading-none tracking-tight text-[rgb(var(--fg-inverse))]/85 text-[clamp(3rem,8vw,4.5rem)]"
                style={{
                  fontFamily: "var(--font-head), var(--font-display)",
                }}
              >
                {initials || "S"}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Samples card (light surface, brand-tinted) ────────────────────

interface SamplesCardProps {
  samples: ReadonlyArray<PublicSample>;
  lockedCount: number;
  slug: string;
}

function SamplesCard({ samples, lockedCount, slug }: SamplesCardProps) {
  if (samples.length === 0) {
    return (
      <div
        id="samples"
        className={[
          "rounded-[1.75rem] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.08)]",
          "bg-[rgb(var(--bg-base))]",
        ].join(" ")}
      >
        <div
          className="flex items-center justify-center px-6 py-8"
          style={{
            borderRadius: "calc(1.75rem - 0.375rem)",
            background: "rgb(var(--brand-primary) / 0.04)",
          }}
        >
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Samples coming soon
          </p>
        </div>
      </div>
    );
  }

  const [feature, ...rest] = samples;
  if (!feature) return null;

  return (
    <div
      id="samples"
      className={[
        "rounded-[1.75rem] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.08)]",
        "bg-[rgb(var(--bg-base))]",
      ].join(" ")}
    >
      <div
        className="p-4 text-left sm:p-5"
        style={{
          borderRadius: "calc(1.75rem - 0.375rem)",
          // Soft amber wash — gives the card a brand-lit feel against
          // the cream page bg without needing a heavy fill or shadow.
          background: "rgb(var(--brand-primary) / 0.04)",
        }}
      >
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

        {/* Featured track. */}
        <div className="mb-3">
          <div className="mb-2 min-w-0">
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
          <ul className="flex flex-col divide-y divide-[rgb(var(--fg-primary)/0.08)] border-t border-[rgb(var(--fg-primary)/0.08)]">
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
          <p className="mt-2 border-t border-[rgb(var(--fg-primary)/0.08)] pt-3 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
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

// Tiny platform glyphs. Same recipe as the old <JoinSocialLinks> so the
// chip vocabulary matches the rest of the marketing surface. Generic
// music-note for unknown platforms.
function PlatformIcon({
  platform,
  className,
}: {
  platform: string;
  className?: string;
}) {
  const stroke = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const wrap = (children: React.ReactNode) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
      {children}
    </svg>
  );
  switch (platform) {
    case "instagram":
    case "instagram_reels":
      return wrap(
        <>
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.5" y2="6.5" />
        </>,
      );
    case "youtube":
      return wrap(
        <>
          <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
          <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
        </>,
      );
    case "soundcloud":
      return wrap(
        <>
          <path d="M3 17v-4M6 17v-6M9 17v-8M12 17V8M15 17V7" />
          <path d="M16 11a4 4 0 1 1 4 6h-4z" />
        </>,
      );
    case "spotify":
    case "apple_music":
    case "bandcamp":
    case "tiktok":
    default:
      return wrap(
        <>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </>,
      );
  }
}
