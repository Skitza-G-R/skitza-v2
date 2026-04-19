"use client";

import Link from "next/link";

import { useArtistAudio } from "../artist-audio-context";

// Client component — needs the audio context hook to start playback.
// The card itself is mostly chrome + a single button that pushes the
// track into the persistent mini-player. If audioUrl is null (still
// uploading), the play button is disabled.

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
  const { playTrack } = useArtistAudio();

  if (!mix) {
    return (
      <section
        aria-labelledby="latest-mix-heading"
        className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <h2
          id="latest-mix-heading"
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
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
  const onPlay = () => {
    if (!mix.audioUrl) return;
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
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="latest-mix-heading"
        className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Latest mix
      </h2>
      <div className="mt-2 flex items-center gap-4">
        <button
          type="button"
          onClick={onPlay}
          disabled={!ready}
          aria-label={ready ? `Play ${mix.trackTitle} ${mix.label}` : "Audio still uploading"}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-base))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ▶
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg text-[rgb(var(--fg-primary))]">
            {mix.trackTitle}
          </p>
          <p className="truncate text-sm text-[rgb(var(--fg-secondary))]">
            {mix.label} · {mix.producerName} · {formatRelative(mix.uploadedAt)}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Link
          href={`/artist/music/${mix.projectId}`}
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))]"
        >
          Open project →
        </Link>
      </div>
    </section>
  );
}

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
