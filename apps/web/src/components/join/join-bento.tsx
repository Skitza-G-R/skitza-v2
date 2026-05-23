// SK-25 (v3 — Spotify track-list + mini player): centered single-column
// stack with a tiny portrait, sign-up-disclosure CTA, and a Spotify-
// style track table. Clicking any row dispatches `playerPlay()` on the
// shared `skitza:player:*` event bus — <JoinMiniPlayer /> (mounted by
// page.tsx) catches it and renders the bottom dock.
//
// Two key changes from v2:
//   1. Portrait shrunk drastically (96px mobile / 112px desktop) so the
//      full page fits a 900px viewport without scroll. v2 used 192px
//      which alone consumed ~22% of the viewport.
//   2. Samples card no longer has a featured-waveform + compact-rows
//      split. Every track is a uniform tight row (track number /
//      title+artist / duration). Clicking a row's title or the row
//      itself starts playback in the floating dock — the same UX as
//      the dashboard's `<PersistentPlayer />` ecosystem.

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  pickDurationMs,
  playerPlay,
  playerToggle,
  useNowPlaying,
  type PlayerTrack,
} from "~/components/audio/persistent-player";

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
      className="relative mx-auto flex w-full max-w-2xl flex-col items-center px-4 pb-24 pt-3 text-center sm:px-6 sm:pt-4"
    >
      <Portrait name={name} initials={initials} logoUrl={producer.logoUrl} />

      <span
        className={[
          "reveal-up-delay-1 mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1",
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
          "reveal-up-delay-1 mt-2 font-extrabold leading-[0.94] tracking-[-0.03em]",
          "text-[clamp(1.85rem,6.5vw,2.5rem)] sm:text-[clamp(2rem,4vw,2.75rem)]",
        ].join(" ")}
        style={{ fontFamily: "var(--font-head), var(--font-display)" }}
      >
        {name}
      </h2>

      <p
        className={[
          "reveal-up-delay-2 mt-2 max-w-md text-sm leading-[1.5]",
          producer.bio
            ? "text-[rgb(var(--fg-secondary))]"
            : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        {producer.bio ?? "A studio for artists who care about the take, not just the sound."}
      </p>

      {visibleLinks.length > 0 ? (
        <ul className="reveal-up-delay-2 mt-4 flex flex-wrap items-center justify-center gap-2">
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

      <div className="reveal-up-delay-3 mt-5 flex flex-col items-center gap-2">
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

      <div className="reveal-up-delay-3 mt-5 w-full">
        <SamplesCard
          producerName={name}
          samples={samples}
          lockedCount={lockedCount}
          slug={slug}
        />
      </div>

      {metaChips.length > 0 ? (
        <p className="reveal-up-delay-4 mt-4 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          {metaChips.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

// ─── Portrait (small square, top of stack) ─────────────────────────

interface PortraitProps {
  name: string;
  initials: string;
  logoUrl: string | null;
}

function Portrait({ name, initials, logoUrl }: PortraitProps) {
  return (
    <div
      className={[
        "reveal-up rounded-[var(--radius-lg)] p-1 ring-1 ring-[rgb(var(--fg-primary)/0.05)]",
        "bg-[rgb(var(--fg-primary)/0.025)]",
      ].join(" ")}
    >
      <div
        aria-hidden={!logoUrl}
        className="relative h-24 w-24 overflow-hidden sm:h-28 sm:w-28"
        style={{
          borderRadius: "calc(var(--radius-lg) - 4px)",
          background:
            "radial-gradient(120% 100% at 30% 25%, rgb(var(--brand-primary)) 0%, rgb(var(--brand-accent)) 55%, rgb(var(--fg-primary)) 100%)",
          boxShadow:
            "inset 0 1px 1px rgb(255 255 255 / 0.18), inset 0 -18px 36px -18px rgb(0 0 0 / 0.4)",
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
                className="font-extrabold leading-none tracking-tight text-[rgb(var(--fg-inverse))]/85 text-[clamp(1.75rem,5vw,2.25rem)]"
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

// ─── Samples card — Spotify-style click-to-play track list ─────────

interface SamplesCardProps {
  producerName: string;
  samples: ReadonlyArray<PublicSample>;
  lockedCount: number;
  slug: string;
}

function SamplesCard({
  producerName,
  samples,
  lockedCount,
  slug,
}: SamplesCardProps) {
  if (samples.length === 0) {
    return (
      <div
        id="samples"
        className={[
          "rounded-[1.5rem] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.08)]",
          "bg-[rgb(var(--bg-base))]",
        ].join(" ")}
      >
        <div
          className="flex items-center justify-center px-6 py-8"
          style={{
            borderRadius: "calc(1.5rem - 0.375rem)",
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

  return (
    <div
      id="samples"
      className={[
        "rounded-[1.5rem] p-1.5 ring-1 ring-[rgb(var(--fg-primary)/0.08)]",
        "bg-[rgb(var(--bg-base))]",
      ].join(" ")}
    >
      <div
        className="p-3 text-left sm:p-4"
        style={{
          borderRadius: "calc(1.5rem - 0.375rem)",
          background: "rgb(var(--brand-primary) / 0.04)",
        }}
      >
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Recent work
          </p>
          <p
            aria-hidden
            className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
          >
            {String(samples.length).padStart(2, "0")} tracks
          </p>
        </div>

        <ul className="flex flex-col">
          {samples.map((sample, idx) => (
            <TrackRow
              key={sample.id}
              sample={sample}
              index={idx}
              producerName={producerName}
            />
          ))}

          {lockedCount > 0 ? (
            <li className="mt-1 border-t border-[rgb(var(--fg-primary)/0.08)] pt-2">
              <Link
                href={`/sign-up/join/${encodeURIComponent(slug)}`}
                className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-left transition-colors duration-200 hover:bg-[rgb(var(--fg-primary)/0.04)]"
              >
                <span aria-hidden className="w-6 shrink-0 text-center text-sm">
                  🔒
                </span>
                <span className="flex-1 truncate text-sm font-semibold text-[rgb(var(--fg-muted))]">
                  {lockedCount} more track{lockedCount === 1 ? "" : "s"} — sign up to unlock
                </span>
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

// ─── Individual track row (Spotify-style) ──────────────────────────

interface TrackRowProps {
  sample: PublicSample;
  index: number;
  producerName: string;
}

function TrackRow({ sample, index, producerName }: TrackRowProps) {
  const now = useNowPlaying();
  const isActive = now.trackId === sample.id;
  const isPlaying = isActive && now.playing;
  // Resolve real duration via a metadata-only audio probe when the DB
  // column is null. This is what backfills the row from "—" to "2:43"
  // a beat after first paint on older tracks that never had their
  // duration backfilled at upload time.
  const resolvedDurationMs = useAudioDuration(sample.audioUrl, sample.durationMs);

  function onClick() {
    if (!sample.audioUrl) return;
    if (isActive) {
      // Same row clicked again — toggle pause/resume on the mini player.
      playerToggle();
      return;
    }
    const track: PlayerTrack = {
      id: sample.id,
      audioUrl: sample.audioUrl,
      title: sample.title,
      subtitle: sample.artist ?? producerName,
      // Prefer the resolved value so the mini player's progress bar
      // initialises with the right denominator immediately.
      durationMs: resolvedDurationMs ?? sample.durationMs,
    };
    playerPlay(track);
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!sample.audioUrl}
        aria-label={
          isPlaying
            ? `Pause ${sample.title}`
            : isActive
              ? `Resume ${sample.title}`
              : `Play ${sample.title}`
        }
        className={[
          "group flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-left",
          "transition-colors duration-200",
          isActive
            ? "bg-[rgb(var(--brand-primary)/0.1)]"
            : "hover:bg-[rgb(var(--fg-primary)/0.04)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
        ].join(" ")}
      >
        {/* Index OR play/pause/eq indicator depending on row state. */}
        <span
          aria-hidden
          className={[
            "relative flex h-6 w-6 shrink-0 items-center justify-center font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em]",
            isActive
              ? "text-[rgb(var(--brand-primary))]"
              : "text-[rgb(var(--fg-muted))]",
          ].join(" ")}
        >
          {isPlaying ? (
            <EqBars />
          ) : isActive ? (
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden>
              <polygon points="6,4 20,12 6,20" />
            </svg>
          ) : (
            <>
              <span className="block group-hover:hidden">
                {String(index + 1).padStart(2, "0")}
              </span>
              <svg
                viewBox="0 0 24 24"
                className="hidden h-3 w-3 text-[rgb(var(--fg-primary))] group-hover:block"
                fill="currentColor"
                aria-hidden
              >
                <polygon points="6,4 20,12 6,20" />
              </svg>
            </>
          )}
        </span>

        {/* Title + artist. Capped width on sm+ so the waveform actually
            gets room to stretch in the right half of the row. */}
        <span className="min-w-0 flex-1 sm:flex-none sm:w-[38%]">
          <span
            className={[
              "block truncate text-sm font-bold",
              isActive
                ? "text-[rgb(var(--brand-primary))]"
                : "text-[rgb(var(--fg-primary))]",
            ].join(" ")}
          >
            {sample.title}
          </span>
          {sample.artist ? (
            <span className="block truncate text-xs text-[rgb(var(--fg-muted))]">
              {sample.artist}
            </span>
          ) : null}
        </span>

        {/* Decorative mini waveform — desktop only; stretches across the
            right half of the row, from after the title to right before
            the duration. Fingerprint deterministic from track ID. */}
        <MiniWaveform
          seedKey={sample.id}
          className={[
            "hidden sm:block flex-1 min-w-0 h-5",
            isActive
              ? "text-[rgb(var(--brand-primary))]"
              : "text-[rgb(var(--fg-primary)/0.35)]",
          ].join(" ")}
        />

        {/* Duration — falls back to the metadata-resolved value when
            the DB column is null. */}
        <span className="shrink-0 font-mono text-[0.7rem] tabular-nums text-[rgb(var(--fg-muted))]">
          {formatDuration(resolvedDurationMs)}
        </span>
      </button>
    </li>
  );
}

// ─── MiniWaveform (decorative, deterministic from track ID) ────────
//
// We don't decode audio per row — that would be 3 wavesurfer instances
// + 3 audio fetches on first paint. Instead, derive a stable bar
// pattern from the track's UUID via fnv1a + mulberry32. Each track gets
// its own "fingerprint" that loads with the HTML.
//
// Premium look (v2): 96 bars at 1px width / 1.5px stride. Heights come
// from a 2-octave noise mix — a slow envelope swell (low-frequency
// random walk) plus per-bar detail. Real audio waveforms have musical
// dynamics, not flat random noise; mixing scales gives the same
// "phrasing" feel without an audio decode.
//
// Real audio-decoded waveform fires when the visitor clicks play —
// the mini player owns that surface.

function fnv1aHash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WAVEFORM_BAR_COUNT = 96;
const WAVEFORM_BAR_STRIDE = 1.5;
const WAVEFORM_BAR_WIDTH = 1;
const WAVEFORM_VB_HEIGHT = 20;
// Envelope nodes — coarse anchors interpolated across the bar array
// to give the waveform musical phrasing rather than flat random noise.
const WAVEFORM_ENVELOPE_NODES = 8;

function buildWaveformAmplitudes(seed: number): number[] {
  const rand = mulberry32(seed);

  // Slow envelope (low-frequency random walk through the song).
  const nodes: number[] = [];
  for (let i = 0; i < WAVEFORM_ENVELOPE_NODES; i++) {
    nodes.push(0.35 + rand() * 0.55);
  }

  const out: number[] = [];
  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    // Interpolate between adjacent envelope nodes.
    const t = (i / (WAVEFORM_BAR_COUNT - 1)) * (WAVEFORM_ENVELOPE_NODES - 1);
    const lo = Math.floor(t);
    const hi = Math.min(WAVEFORM_ENVELOPE_NODES - 1, lo + 1);
    const frac = t - lo;
    const a = nodes[lo] ?? 0.5;
    const b = nodes[hi] ?? 0.5;
    // Cosine ease so the envelope feels musical, not piecewise-linear.
    const smooth = 0.5 - 0.5 * Math.cos(frac * Math.PI);
    const env = a * (1 - smooth) + b * smooth;

    // Per-bar detail layered on top — narrow random jitter so adjacent
    // bars don't pop wildly but still have texture.
    const jitter = (rand() - 0.5) * 0.45;
    // Clamp into [0.12, 1.0] — never invisible, never clipping the
    // viewBox.
    const amp = Math.max(0.12, Math.min(1.0, env + jitter));
    out.push(amp);
  }
  return out;
}

function MiniWaveform({
  seedKey,
  className,
}: {
  seedKey: string;
  className?: string;
}) {
  const bars = buildWaveformAmplitudes(fnv1aHash(seedKey));
  const vbWidth = WAVEFORM_BAR_COUNT * WAVEFORM_BAR_STRIDE;
  return (
    <svg
      viewBox={`0 0 ${String(vbWidth)} ${String(WAVEFORM_VB_HEIGHT)}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      {bars.map((amp, i) => {
        const h = amp * (WAVEFORM_VB_HEIGHT - 2);
        const y = (WAVEFORM_VB_HEIGHT - h) / 2;
        const x = i * WAVEFORM_BAR_STRIDE;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={WAVEFORM_BAR_WIDTH}
            height={h}
            rx={0.5}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

// 3-bar SVG EQ — used as the "currently playing" indicator. Tiny
// inline animations; cheap to render in every active row.
function EqBars() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
      <rect x="2" y="4" width="2.4" height="8" fill="currentColor">
        <animate
          attributeName="height"
          values="3;9;5;8;3"
          dur="900ms"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y"
          values="6.5;3.5;5.5;4;6.5"
          dur="900ms"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="6.8" y="2" width="2.4" height="12" fill="currentColor">
        <animate
          attributeName="height"
          values="6;3;10;4;6"
          dur="900ms"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y"
          values="5;6.5;3;6;5"
          dur="900ms"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="11.6" y="5" width="2.4" height="6" fill="currentColor">
        <animate
          attributeName="height"
          values="4;8;5;9;4"
          dur="900ms"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y"
          values="6;4;5.5;3.5;6"
          dur="900ms"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

/**
 * Resolve a track's real duration. Prefers the DB column when set;
 * otherwise mounts a hidden <audio preload="metadata"> for the URL and
 * reads `audio.duration` from the loadedmetadata event. The browser
 * fetches only the container header (~few KB), not the whole audio.
 *
 * Returns null while loading or if the probe fails — caller decides
 * what placeholder to render in that window (we show "—" via
 * formatDuration).
 */
function useAudioDuration(
  url: string | null,
  dbMs: number | null,
): number | null {
  const [probedSec, setProbedSec] = useState<number | null>(null);
  const probedRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Skip the probe when the DB already gave us a usable value or
    // when there's no audio URL to probe.
    if (dbMs !== null && Number.isFinite(dbMs) && dbMs > 0) return;
    if (!url) return;

    const el = document.createElement("audio");
    el.preload = "metadata";
    // No crossOrigin set on purpose. Reading audio.duration only needs
    // the container header (which the <audio> element fetches via the
    // standard media stream), not pixel-data or PCM samples. Setting
    // crossOrigin="anonymous" makes the browser require a CORS preflight
    // and a matching Access-Control-Allow-Origin header on R2 — older
    // tracks in this catalog don't have that header, so the load
    // silently fails and the row stays "—". Dropping it lets the
    // metadata probe succeed against any same-protocol audio host.
    el.src = url;
    probedRef.current = el;

    function onLoaded() {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setProbedSec(d);
    }
    function onError() {
      // Silently leave probedSec null — the row keeps showing "—".
      // Not a UX regression vs. the prior behaviour.
    }
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("error", onError);
      // Hint the browser to release the connection; the next render
      // can re-probe if url changes.
      el.src = "";
      probedRef.current = null;
    };
  }, [url, dbMs]);

  return pickDurationMs(dbMs, probedSec);
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
