"use client";

import { useEffect, useRef } from "react";
import { useArtistAudio } from "./artist-audio-context";

// Singleton <audio> element. Renders nothing visual when no track is
// loaded. Otherwise: artwork + title + producer name + play/pause +
// progress bar. The actual <audio> stays mounted forever (lives in
// the layout) so tab navigation never interrupts playback.
export function PersistentMiniPlayer() {
  const { state, togglePlay, setPosition, setDuration } = useArtistAudio();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync DOM <audio>.play() / pause() with React state
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (state.isPlaying && el.paused) void el.play().catch(() => {});
    else if (!state.isPlaying && !el.paused) el.pause();
  }, [state.isPlaying, state.currentTrack?.id]);

  // Reload src when track changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !state.currentTrack) return;
    if (el.src !== state.currentTrack.url) {
      el.src = state.currentTrack.url;
      void el.play().catch(() => {});
    }
  }, [state.currentTrack?.url]);

  if (!state.currentTrack) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-2xl items-center gap-3 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 shadow-[0_-4px_20px_-8px_rgb(0_0_0_/_0.4)]">
      {state.currentTrack.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.currentTrack.artworkUrl}
          alt=""
          className="h-10 w-10 rounded-sm object-cover"
        />
      ) : (
        <div className="h-10 w-10 rounded-sm bg-[rgb(var(--bg-sunken))]" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{state.currentTrack.title}</p>
        <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
          {state.currentTrack.producerName}
        </p>
      </div>
      <button
        type="button"
        onClick={togglePlay}
        aria-label={state.isPlaying ? "Pause" : "Play"}
        className="rounded-full bg-[rgb(var(--brand-primary))] p-2 text-[rgb(var(--bg-base))]"
      >
        {state.isPlaying ? "⏸" : "▶"}
      </button>
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
  );
}
