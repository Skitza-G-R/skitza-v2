"use client";

import Link from "next/link";

import { producerGradient } from "~/lib/artist/producer-color";

import { useArtistAudio } from "../artist-audio-context";

import { DecorativeWaveform } from "./decorative-waveform";

// Latest-mix card — locked design system (Phase 5).
//
// Top row:   amber NEW + version → bold title → producer + comment count
// Play btn:  44px gradient circle (per-producer hue) with dark ring
// Bottom:    decorative 36px mini-waveform across the full card width
//
// Tap on the card body opens the project room. Tap on the play button
// loads the track into the persistent mini-player (audio context).

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
        className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <p
          id="latest-mix-heading"
          className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Latest mix
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">
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
  const gradient = producerGradient(mix.producerName);

  return (
    <section
      aria-labelledby="latest-mix-heading"
      className="sk-lift overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-center gap-3 px-5 pb-3 pt-5">
        <button
          type="button"
          onClick={onPlay}
          disabled={!ready}
          aria-label={
            ready
              ? `Play ${mix.trackTitle} ${mix.label}`
              : "Audio still uploading"
          }
          className="sk-press relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] text-white shadow-[0_4px_12px_rgb(17_16_9_/_0.18)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: gradient }}
        >
          <span aria-hidden className="absolute inset-0 bg-black/30" />
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="currentColor"
            className="relative"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>

        <Link
          href={`/artist/music/${mix.projectId}`}
          className="min-w-0 flex-1"
          id="latest-mix-heading"
          aria-label={`${mix.trackTitle} ${mix.label} — open project`}
        >
          <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest">
            <span className="text-[rgb(var(--brand-primary))]">
              New · {mix.label}
            </span>
          </p>
          <p className="mt-0.5 truncate text-[15px] font-bold leading-tight text-[rgb(var(--fg-default))]">
            {mix.trackTitle}
          </p>
          <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
            {mix.producerName} · {formatRelative(mix.uploadedAt)}
          </p>
        </Link>
      </div>

      <div className="px-5 pb-4">
        <DecorativeWaveform seed={mix.id} height={36} highlight={0.32} />
      </div>
    </section>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${String(days)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
