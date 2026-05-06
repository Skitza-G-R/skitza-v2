"use client";

import Link from "next/link";

import { useArtistAudio } from "../artist-audio-context";

// Client component — needs the audio context hook to start playback.
// The card itself is mostly chrome + a single button that pushes the
// track into the persistent mini-player. If audioUrl is null (still
// uploading), the play button is disabled.
//
// Polished to mirror the locked design's "play button + meta + open
// project" three-row layout with a subtle waveform-ish progress bar
// (rendered as static dashed bars when the player isn't on this
// track).

export type LatestMix = {
  id: string;
  trackTitle: string;
  label: string;
  producerName: string;
  producerSlug: string;
  projectId: string;
  uploadedAt: Date;
  audioUrl: string | null;
};

export function LatestMixCard({ mix }: { mix: LatestMix | null }) {
  const { state, playTrack, togglePlay } = useArtistAudio();

  if (!mix) {
    return (
      <section
        aria-labelledby="latest-mix-heading"
        className="reveal-up rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <h2
          id="latest-mix-heading"
          className="font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Latest mix
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          New mixes from your producer will show up here — play them right in the app.
        </p>
      </section>
    );
  }

  const ready = !!mix.audioUrl;
  const isCurrent = state.currentTrack?.id === mix.id;
  const isPlaying = isCurrent && state.isPlaying;

  const onPlay = () => {
    if (!mix.audioUrl) return;
    if (isCurrent) {
      togglePlay();
      return;
    }
    playTrack({
      id: mix.id,
      url: mix.audioUrl,
      title: `${mix.trackTitle} — ${mix.label}`,
      producerName: mix.producerName,
      artworkUrl: null,
    });
  };

  return (
    <section
      aria-labelledby="latest-mix-heading"
      className="reveal-up overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-center gap-3 px-4 pb-2 pt-4">
        <button
          type="button"
          onClick={onPlay}
          disabled={!ready}
          aria-label={
            ready
              ? isPlaying
                ? `Pause ${mix.trackTitle}`
                : `Play ${mix.trackTitle} ${mix.label}`
              : "Audio still uploading"
          }
          className="sk-press flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-base font-bold text-[rgb(var(--fg-onsidebar))] disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: "rgb(var(--bg-sidebar))",
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="font-mono text-[0.6rem] font-bold uppercase tracking-wider"
              style={{ color: "rgb(var(--brand-primary))" }}
            >
              New · {mix.label}
            </span>
          </div>
          <h2
            id="latest-mix-heading"
            className="mt-0.5 truncate text-[15px] font-bold leading-tight text-[rgb(var(--fg-default))]"
          >
            {mix.trackTitle}
          </h2>
          <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
            {mix.producerName} · {formatRelative(mix.uploadedAt)}
          </p>
        </div>
      </div>

      {/* Static decorative waveform bars — placeholder for the locked
          design's audio-shape preview. Real waveform comes with the
          project detail page. */}
      <div
        aria-hidden
        className="flex h-8 items-end gap-[2px] px-4 pb-3"
        style={{ color: "rgb(var(--brand-primary))" }}
      >
        {WAVEFORM_HEIGHTS.map((h, i) => (
          <span
            key={i}
            className="block w-[3px] flex-1 rounded-full"
            style={{
              height: `${String(h)}%`,
              background: "currentColor",
              opacity: i < 9 ? 0.85 : 0.18,
            }}
          />
        ))}
      </div>

      <div
        className="border-t px-4 py-2.5"
        style={{ borderColor: "rgb(var(--border-subtle))" }}
      >
        <Link
          href={`/artist/music/${mix.projectId}`}
          className="font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-default))]"
        >
          Open project →
        </Link>
      </div>
    </section>
  );
}

// Stable pseudo-random heights for the decorative waveform bars. We
// keep this static at the module scope so SSR + client hydration stay
// in sync (Math.random in render would mismatch).
const WAVEFORM_HEIGHTS = [
  35, 55, 70, 50, 80, 65, 45, 90, 60, 70, 40, 30, 55, 65, 50, 35, 25, 30, 20,
  18, 22, 28, 24, 19, 26, 32, 23, 17, 21, 25, 30, 24,
];

// Cheap relative formatter — "today", "yesterday", or "Apr 17". Spec
// is intentionally loose: more important to be readable at a glance
// than precise.
function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${String(days)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
