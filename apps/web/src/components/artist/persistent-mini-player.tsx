"use client";

import { useEffect, useRef, useState } from "react";
import { useArtistAudio } from "./artist-audio-context";

// Singleton <audio> element. Renders nothing visual when no track is
// loaded. Otherwise: artwork + title + producer name + play/pause +
// progress bar. The actual <audio> stays mounted forever (lives in
// the layout) so tab navigation never interrupts playback.
//
// 2026-04-22 — Phase 2+3 audit fix: on desktop this strip was
// overlapping the new ArtistSidebar (`inset-x-0` spans the full
// viewport) and had a dead 64px gap below it (`bottom-16` assumed a
// BottomNav that's now `md:hidden`). Fixed by:
//   - Reading the sidebar-collapsed state from localStorage +
//     listening for the `skitza:toggle-sidebar` event, so the
//     player knows whether the sidebar is 14rem or 60rem wide.
//   - On `md+`: start position = sidebar width; bottom = 0 (no
//     BottomNav); max-width caps visual density inside the content
//     area so it doesn't stretch to full width on ultrawide monitors.
// Mobile (< md) layout is unchanged — still stacks above BottomNav.

const ARTIST_SIDEBAR_STORAGE_KEY = "skitza-artist-sidebar-collapsed";

export function PersistentMiniPlayer() {
  const { state, togglePlay, setPosition, setDuration } = useArtistAudio();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Track the sidebar's collapsed state so the player can position
  // itself flush against the sidebar's RIGHT edge on desktop. Starts
  // as false to match SSR (sidebar renders expanded on initial paint)
  // and updates in the mount effect.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(ARTIST_SIDEBAR_STORAGE_KEY) === "true") {
        setSidebarCollapsed(true);
      }
    } catch {
      // localStorage can throw in private mode — fall back to expanded default.
    }
    const onToggle = () => {
      setSidebarCollapsed((c) => !c);
    };
    window.addEventListener("skitza:toggle-sidebar", onToggle);
    return () => {
      window.removeEventListener("skitza:toggle-sidebar", onToggle);
    };
  }, []);

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

  // Desktop positioning — start from the sidebar's trailing edge
  // (14rem collapsed / 60rem expanded) and run to the viewport end.
  // Uses logical `start` (RTL-aware) so the strip flips correctly in
  // Hebrew. On mobile the inset-x-0 + max-w-2xl centering is kept
  // since there's no sidebar.
  const desktopStartClass = sidebarCollapsed ? "md:start-14" : "md:start-60";

  return (
    // Mobile: `inset-x-0 bottom-16 mx-auto max-w-2xl` — centered strip
    // above the 56px BottomNav. `sk-safe-bottom` on BottomNav handles
    // the home-indicator inset.
    //
    // Desktop (md+): override with `md:inset-x-auto md:end-0 md:bottom-0
    // md:mx-auto md:max-w-3xl` so the strip anchors to the sidebar's
    // trailing edge + viewport's end, caps width to match the content
    // area's max-w-3xl, and hugs the bottom (no BottomNav gap).
    <div
      className={`fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-2xl items-center gap-3 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 shadow-[0_-4px_20px_-8px_rgb(0_0_0_/_0.4)] md:inset-x-auto md:bottom-0 md:end-0 md:max-w-3xl md:mx-auto ${desktopStartClass}`}
    >
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
        // h-11 w-11 (44px) meets the tap-target minimum. focus-visible
        // ring over-under keeps the keyboard outline readable on both
        // bg-elevated (rest) and the amber button fill.
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-base))] transition-[transform,filter] hover:brightness-110 active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]"
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
