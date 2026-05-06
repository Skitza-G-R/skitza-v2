"use client";

import { useEffect, useRef } from "react";

import { producerGradient } from "~/lib/artist/producer-color";

import { useArtistAudio } from "./artist-audio-context";

// Persistent mini-player — locked design system (Phase 5).
//
// IN-PLACE re-skin per Strategic Lead coordination: the audio
// provider, the `<audio>` element wiring, and the singleton lifecycle
// stay byte-identical. Only the visible chrome changes.
//
// Layout — mobile: full-width dark dock above the 56px bottom nav.
// Desktop (lg+): floats bottom-right of the main column, sitting
// clear of the 248px artist desktop sidebar. Both variants share a
// thin amber progress bar pinned to the bottom edge.
//
// Hidden when no track is loaded (returns null).
export function PersistentMiniPlayer() {
  const { state, togglePlay, setPosition, setDuration } = useArtistAudio();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync DOM <audio>.play() / pause() with React state. Identical to
  // the prior implementation — preserved per Strategic Lead.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (state.isPlaying && el.paused) void el.play().catch(() => {});
    else if (!state.isPlaying && !el.paused) el.pause();
  }, [state.isPlaying, state.currentTrack?.id]);

  // Reload src when track changes — preserved.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !state.currentTrack) return;
    if (el.src !== state.currentTrack.url) {
      el.src = state.currentTrack.url;
      void el.play().catch(() => {});
    }
  }, [state.currentTrack?.url]);

  if (!state.currentTrack) return null;

  const pct =
    state.duration > 0
      ? Math.max(0, Math.min(100, (state.position / state.duration) * 100))
      : 0;
  const gradient = producerGradient(state.currentTrack.producerName);

  return (
    <div
      className={[
        // MOBILE (default): full-width dock above the bottom nav.
        // bottom-16 (64px) clears the 56px BottomNav + safe-area
        // buffer the nav already carries.
        "fixed inset-x-0 bottom-16 z-20 mx-auto max-w-3xl px-3",
        // DESKTOP (lg+): float bottom-right of the main column,
        // clear of the 248px sidebar.
        "lg:bottom-4 lg:right-4 lg:left-[calc(248px+1rem)] lg:max-w-3xl lg:px-0",
      ].join(" ")}
      role="region"
      aria-label="Now playing"
    >
      <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))] shadow-[0_-8px_32px_rgb(17_16_9_/_0.35)]">
        {/* Header row */}
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
          {state.currentTrack.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.currentTrack.artworkUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-display text-[11px] font-extrabold tracking-tight text-white"
              style={{ background: gradient, letterSpacing: "-0.02em" }}
            >
              {monogram(state.currentTrack.producerName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-bold leading-tight">
              {state.currentTrack.title}
            </p>
            <p className="mt-0.5 flex items-center gap-2 truncate font-mono text-[10.5px] uppercase tracking-widest text-[rgb(var(--fg-inverse)/0.55)]">
              <span className="truncate">
                {state.currentTrack.producerName}
              </span>
              {state.isPlaying ? <EqBars /> : null}
            </p>
          </div>

          <button
            type="button"
            onClick={togglePlay}
            aria-label={state.isPlaying ? "Pause" : "Play"}
            className="sk-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-sidebar))]"
          >
            {state.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>

        {/* Progress bar — amber fill on dark track, pinned bottom. */}
        <div
          aria-hidden
          className="h-[3px] w-full bg-[rgb(var(--fg-inverse)/0.12)]"
        >
          <div
            className="h-full bg-[rgb(var(--brand-primary))] transition-[width] duration-150 ease-linear"
            style={{ width: `${String(pct)}%` }}
          />
        </div>

        <audio
          ref={audioRef}
          onTimeUpdate={(e) => {
            setPosition(e.currentTarget.currentTime);
          }}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
          }}
          preload="metadata"
        />
      </div>
    </div>
  );
}

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function EqBars() {
  return (
    <span
      aria-hidden
      className="ml-1 flex h-3 items-end gap-[2px]"
      // The .eq-bar utility (globals.css) ramps height between 22% and
      // 100% on the skitza-eq keyframe. Three offset bars give the
      // perceived "bouncing meter" without per-bar JS.
    >
      {[0, 0.18, 0.36].map((delay, i) => (
        <span
          key={i}
          className="eq-bar w-[2px] rounded-[1px] bg-[rgb(var(--brand-primary))]"
          style={{ height: "30%", animationDelay: `${String(delay)}s` }}
        />
      ))}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </svg>
  );
}
