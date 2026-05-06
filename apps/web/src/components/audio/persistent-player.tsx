"use client";

import { useEffect, useRef, useState } from "react";

// Public read-only state for "what's currently playing" — populated by
// PersistentPlayer on every set / toggle / ended event so callers can
// flag the active row in any list (e.g. EqBars on the playing track).
//
// Implemented as a module-level variable + a small pub-sub so listeners
// re-render when state changes without coupling them to PersistentPlayer's
// internal React state.
let nowPlayingState: { trackId: string | null; playing: boolean } = {
  trackId: null,
  playing: false,
};
const nowPlayingListeners = new Set<() => void>();
function setNowPlayingState(next: { trackId: string | null; playing: boolean }) {
  nowPlayingState = next;
  nowPlayingListeners.forEach((fn) => {
    fn();
  });
}

/** Subscribe to currently-playing track changes. Returns an unsubscribe fn. */
function subscribeNowPlaying(cb: () => void): () => void {
  nowPlayingListeners.add(cb);
  return () => {
    nowPlayingListeners.delete(cb);
  };
}

/**
 * Read the currently-playing track ID + play state from any client
 * component. Re-renders the consumer whenever the player state changes.
 * SSR-safe: returns the static initial state on the server, hydrates
 * with the live state once mounted.
 */
export function useNowPlaying(): { trackId: string | null; playing: boolean } {
  const [state, setState] = useState(nowPlayingState);
  useEffect(() => {
    // Sync once on mount in case the player toggled before this consumer mounted.
    setState(nowPlayingState);
    return subscribeNowPlaying(() => {
      setState(nowPlayingState);
    });
  }, []);
  return state;
}

// Persistent Spotify-style bottom-dock audio player. Mounted once in
// AppShell so it survives client-side navigation and keeps playing
// while the producer clicks around the dashboard.
//
// Communication with the rest of the app happens over a tiny custom-
// event bus on `window`, four events total:
//
//   skitza:player:set    CustomEvent<PlayerTrack> — load + play a track
//   skitza:player:toggle CustomEvent<void>         — pause/resume current
//   skitza:player:seek   CustomEvent<number>       — jump to ms offset
//   skitza:player:time   CustomEvent<number>       — BROADCAST: current ms
//
// The first three are inputs (library rows / side panels dispatch them).
// The fourth is an output — side panels that render a waveform or a
// "currently at 1:23" marker listen for it. Using events instead of a
// React context means any component in any subtree can participate
// without prop-drilling through the server/client boundary.

export type PlayerTrack = {
  id: string;
  audioUrl: string | null;
  title: string;
  subtitle: string;
  durationMs: number | null;
};

type PlayerState = { track: PlayerTrack | null; playing: boolean };

const EVT_SET = "skitza:player:set";
const EVT_TOGGLE = "skitza:player:toggle";
const EVT_SEEK = "skitza:player:seek";
const EVT_TIME = "skitza:player:time";

// Imperative helpers so callers don't have to hand-craft CustomEvents.
export function playerPlay(track: PlayerTrack): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_SET, { detail: track }));
}

export function playerToggle(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_TOGGLE));
}

export function playerSeek(ms: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_SEEK, { detail: ms }));
}

// Event name exports so listeners stay in sync with dispatchers.
export const PLAYER_EVENTS = {
  set: EVT_SET,
  toggle: EVT_TOGGLE,
  seek: EVT_SEEK,
  time: EVT_TIME,
} as const;

export function PersistentPlayer() {
  const [state, setState] = useState<PlayerState>({ track: null, playing: false });
  const [currentMs, setCurrentMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Wire incoming events once per mount. Downstream dispatchers fire
  // these from anywhere — library rows, side panels, mobile modals.
  useEffect(() => {
    function onSet(e: Event) {
      const track = (e as CustomEvent<PlayerTrack>).detail;
      setState({ track, playing: true });
      setCurrentMs(0);
      setNowPlayingState({ trackId: track.id, playing: true });
    }
    function onToggle() {
      setState((s) => {
        const next = { ...s, playing: !s.playing };
        setNowPlayingState({
          trackId: next.track?.id ?? null,
          playing: next.playing,
        });
        return next;
      });
    }
    function onSeek(e: Event) {
      const ms = (e as CustomEvent<number>).detail;
      const el = audioRef.current;
      if (el) el.currentTime = Math.max(0, ms) / 1000;
      setCurrentMs(Math.max(0, ms));
    }
    window.addEventListener(EVT_SET, onSet as EventListener);
    window.addEventListener(EVT_TOGGLE, onToggle as EventListener);
    window.addEventListener(EVT_SEEK, onSeek as EventListener);
    return () => {
      window.removeEventListener(EVT_SET, onSet as EventListener);
      window.removeEventListener(EVT_TOGGLE, onToggle as EventListener);
      window.removeEventListener(EVT_SEEK, onSeek as EventListener);
    };
  }, []);

  // Drive the <audio> element imperatively from state. Split out so
  // setting a new track (id changes) resets the element before play
  // kicks in.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (state.playing) {
      void el.play().catch(() => {
        setState((s) => ({ ...s, playing: false }));
      });
    } else {
      el.pause();
    }
  }, [state.playing, state.track?.id]);

  // Broadcast time updates so side-panel waveforms stay in sync with
  // the single source of truth (this element).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const ms = Math.floor(el.currentTime * 1000);
      setCurrentMs(ms);
      window.dispatchEvent(new CustomEvent(EVT_TIME, { detail: ms }));
    };
    const onEnded = () => {
      setState((s) => {
        setNowPlayingState({ trackId: s.track?.id ?? null, playing: false });
        return { ...s, playing: false };
      });
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, [state.track?.id]);

  if (!state.track) return null;

  const progressPct =
    state.track.durationMs && state.track.durationMs > 0
      ? Math.min(100, Math.max(0, (currentMs / state.track.durationMs) * 100))
      : 0;

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const pct = Number(e.target.value);
    const dur = state.track?.durationMs ?? 0;
    const ms = Math.floor((pct / 100) * dur);
    const el = audioRef.current;
    if (el) el.currentTime = ms / 1000;
    setCurrentMs(ms);
  }

  return (
    <div
      role="region"
      aria-label="Audio player"
      // `sk-safe-bottom` pads the iOS home-indicator inset so the
      // play button doesn't overlap the gesture strip when the app
      // is installed as a PWA. Inset resolves to 0 in a standard
      // browser, so no change elsewhere.
      // Stack the dock ABOVE the producer bottom nav on mobile.
      // The bottom nav (z-30, `fixed bottom-0`) measures ~62px
      // tab row + iOS safe-area inset; the `.persistent-player-dock`
      // class in globals.css layers that offset on <lg, then drops
      // back to `bottom: 0` + safe-area-padding on lg+ where the
      // desktop sidebar replaces the bottom nav.
      className="persistent-player-dock fixed inset-x-0 z-40 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 shadow-lg md:px-6"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <button
          type="button"
          aria-label={state.playing ? "Pause" : "Play"}
          onClick={() => {
            setState((s) => ({ ...s, playing: !s.playing }));
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] transition-[transform,filter] hover:brightness-110 active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
        >
          {state.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
            {state.track.title}
          </p>
          <p className="truncate font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            {state.track.subtitle}
          </p>
          <div className="mt-1 hidden md:block">
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progressPct}
              onChange={onScrub}
              aria-label="Seek"
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[rgb(var(--bg-overlay))] accent-[rgb(var(--brand-primary))]"
            />
          </div>
        </div>
        <span className="hidden font-mono text-[11px] tabular-nums text-[rgb(var(--fg-muted))] md:inline">
          {fmtTime(currentMs)} / {fmtTime(state.track.durationMs ?? 0)}
        </span>
      </div>
      {/* Hidden audio element — sr-only keeps assistive tech from
          picking it up as a second player (the visible controls above
          already announce play/pause state). */}
      <audio
        ref={audioRef}
        src={state.track.audioUrl ?? undefined}
        preload="auto"
        className="sr-only"
      />
    </div>
  );
}

// Exported for unit tests so we can validate m:ss formatting without
// booting the full player (jsdom-free env).
export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" width={14} height={14} fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" width={14} height={14} fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="2" height="7" rx="0.5" />
      <rect x="7" y="2.5" width="2" height="7" rx="0.5" />
    </svg>
  );
}
