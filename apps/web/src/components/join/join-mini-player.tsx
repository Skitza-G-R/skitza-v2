// SK-25: floating mini player for the public /join/<slug> page.
//
// Mounted by page.tsx. Listens on the SAME `skitza:player:*` event bus
// the dashboard's <PersistentPlayer /> uses, so any code that calls
// `playerPlay({ ... })` works on both surfaces. The dashboard dock is
// too heavy to mount here (depends on sidebar offsets + producer-only
// "expand to song page" routes), but the contract is identical:
//
//   - row clicks dispatch `playerPlay(track)` → dock appears + plays
//   - `playerToggle()` pauses/resumes
//   - `playerClose()` unloads + hides
//   - the active row reads state via `useNowPlaying()` (same hook)
//
// Visually: dark sidebar-tinted bottom pill, centered horizontally,
// minimal chrome — play button + title/artist + thin progress bar +
// close X. No skip-back/skip-forward (single-track context), no
// expand-to-song-page button (no song page for anonymous visitors).

"use client";

import { useEffect, useRef, useState } from "react";

import {
  PLAYER_EVENTS,
  pickDurationMs,
  playerPlay,
  playerToggle,
  playerClose,
  publishNowPlaying,
  type PlayerTrack,
} from "~/components/audio/persistent-player";

type PlayerState = { track: PlayerTrack | null; playing: boolean };

// Subset of the page's PublicSample so the mini player can compute
// prev/next without importing the bento's full type surface.
interface MiniPlaylistTrack {
  id: string;
  title: string;
  artist: string | null;
  audioUrl: string | null;
  durationMs: number | null;
}

interface JoinMiniPlayerProps {
  /**
   * Playlist context. The mini player uses this to resolve the active
   * track's index and dispatch the prev/next track via `playerPlay()`.
   * Optional — when empty / missing, the prev/next buttons render as
   * disabled (single-track context).
   */
  samples?: ReadonlyArray<MiniPlaylistTrack>;
  /**
   * Fallback subtitle when a sample has no `artist` — usually the
   * producer's display name. Passed through to dispatched tracks so
   * the dock copy stays consistent with the row.
   */
  producerName?: string;
}

const EASE_LINEAR = "cubic-bezier(0.32,0.72,0,1)";

export function JoinMiniPlayer({ samples, producerName }: JoinMiniPlayerProps) {
  const [state, setState] = useState<PlayerState>({ track: null, playing: false });
  const [currentMs, setCurrentMs] = useState(0);
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ─── Event-bus wiring ───────────────────────────────────────────
  // Mirrors PersistentPlayer's listener set so we react to the exact
  // same dispatches.
  useEffect(() => {
    function onSet(e: Event) {
      const track = (e as CustomEvent<PlayerTrack>).detail;
      setState({ track, playing: true });
      setCurrentMs(0);
      setAudioDurationSec(null);
      publishNowPlaying({ trackId: track.id, playing: true });
    }
    function onToggle() {
      setState((s) => {
        const next = { ...s, playing: !s.playing };
        publishNowPlaying({
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
    function onClose() {
      setState({ track: null, playing: false });
      setCurrentMs(0);
      setAudioDurationSec(null);
      publishNowPlaying({ trackId: null, playing: false });
    }
    window.addEventListener(PLAYER_EVENTS.set, onSet as EventListener);
    window.addEventListener(PLAYER_EVENTS.toggle, onToggle as EventListener);
    window.addEventListener(PLAYER_EVENTS.seek, onSeek as EventListener);
    window.addEventListener(PLAYER_EVENTS.close, onClose as EventListener);
    return () => {
      window.removeEventListener(PLAYER_EVENTS.set, onSet as EventListener);
      window.removeEventListener(PLAYER_EVENTS.toggle, onToggle as EventListener);
      window.removeEventListener(PLAYER_EVENTS.seek, onSeek as EventListener);
      window.removeEventListener(PLAYER_EVENTS.close, onClose as EventListener);
    };
  }, []);

  // ─── body data attribute → CSS scopes extra bottom padding ──────
  // Mirror the dashboard's <PersistentPlayer /> contract: when a track
  // is loaded, set body[data-skitza-dock="1"] so the page can reserve
  // room for the floating dock and not bury the last sample row or
  // meta line behind it on short viewports.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (state.track) {
      document.body.dataset.skitzaDock = "1";
    } else {
      delete document.body.dataset.skitzaDock;
    }
    return () => {
      delete document.body.dataset.skitzaDock;
    };
  }, [state.track]);

  // ─── Drive the <audio> element from state ───────────────────────
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

  // ─── Time + ended listeners ─────────────────────────────────────
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const ms = Math.floor(el.currentTime * 1000);
      setCurrentMs(ms);
      window.dispatchEvent(new CustomEvent(PLAYER_EVENTS.time, { detail: ms }));
    };
    const onEnded = () => {
      setState((s) => {
        publishNowPlaying({
          trackId: s.track?.id ?? null,
          playing: false,
        });
        return { ...s, playing: false };
      });
    };
    const onLoadedMetadata = () => {
      setAudioDurationSec(el.duration);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [state.track?.id]);

  if (!state.track) return null;

  const effectiveDurationMs = pickDurationMs(
    state.track.durationMs,
    audioDurationSec,
  );
  const progressPct =
    effectiveDurationMs && effectiveDurationMs > 0
      ? Math.min(100, Math.max(0, (currentMs / effectiveDurationMs) * 100))
      : 0;

  // Resolve prev/next from the playlist context. Both fall back to
  // null when the active track isn't in the list (defensive — shouldn't
  // happen in practice but keeps the buttons disabled instead of
  // crashing if a stale track id stays in state).
  const activeId = state.track.id;
  const idx = samples?.findIndex((s) => s.id === activeId) ?? -1;
  const prevTrack =
    samples && idx > 0 ? samples[idx - 1] ?? null : null;
  const nextTrack =
    samples && idx >= 0 && idx < samples.length - 1
      ? samples[idx + 1] ?? null
      : null;

  function dispatchTrack(t: MiniPlaylistTrack) {
    if (!t.audioUrl) return;
    playerPlay({
      id: t.id,
      audioUrl: t.audioUrl,
      title: t.title,
      subtitle: t.artist ?? producerName ?? "",
      durationMs: t.durationMs,
    });
  }

  function onScrub(e: React.MouseEvent<HTMLButtonElement>) {
    if (!effectiveDurationMs) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const ms = Math.floor((pct / 100) * effectiveDurationMs);
    const el = audioRef.current;
    if (el) el.currentTime = ms / 1000;
    setCurrentMs(ms);
  }

  return (
    <>
      <div
        role="region"
        aria-label="Audio player"
        // SK-25 polish: z-50 (was z-40 — same tier as the nav, smell).
        // bottom uses max(1rem, env(safe-area-inset-bottom) + 0.5rem)
        // so the dock pill clears the iPhone home indicator in portrait
        // and landscape without crowding non-notched viewports.
        className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none"
        style={{
          bottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))",
        }}
      >
        <div
          className="pointer-events-auto grid w-full max-w-[560px] grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[18px] border border-[rgb(var(--fg-primary)/0.12)] bg-[rgb(var(--fg-primary))] px-3 py-2.5 text-[rgb(var(--bg-base))] shadow-[0_18px_48px_rgba(0,0,0,0.28),_0_4px_12px_rgba(0,0,0,0.14)] backdrop-blur-md"
          style={{
            transform: "translateY(0)",
            opacity: 1,
            animation: "skitza-mini-rise 320ms cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          {/* Transport — prev / play-pause / next. */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (prevTrack) dispatchTrack(prevTrack);
              }}
              disabled={!prevTrack}
              aria-label="Previous track"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--bg-base)/0.8)] transition-colors duration-300 hover:bg-[rgb(var(--bg-base)/0.1)] hover:text-[rgb(var(--bg-base))] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[rgb(var(--bg-base)/0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--fg-primary))]"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden fill="currentColor">
                <polygon points="18,5 7,12 18,19" />
                <rect x="4" y="5" width="2" height="14" rx="0.5" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => {
                playerToggle();
              }}
              aria-label={state.playing ? "Pause" : "Play"}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))] transition-transform duration-300 hover:scale-105 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--fg-primary))]"
              style={{ transitionTimingFunction: EASE_LINEAR }}
            >
              {state.playing ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4 translate-x-[1px]" aria-hidden fill="currentColor">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (nextTrack) dispatchTrack(nextTrack);
              }}
              disabled={!nextTrack}
              aria-label="Next track"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--bg-base)/0.8)] transition-colors duration-300 hover:bg-[rgb(var(--bg-base)/0.1)] hover:text-[rgb(var(--bg-base))] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[rgb(var(--bg-base)/0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--fg-primary))]"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden fill="currentColor">
                <polygon points="6,5 17,12 6,19" />
                <rect x="18" y="5" width="2" height="14" rx="0.5" />
              </svg>
            </button>
          </div>

          {/* Title + artist + thin scrubbable progress bar + timestamps. */}
          <div className="min-w-0 flex flex-col gap-1.5">
            <div className="min-w-0 flex items-baseline gap-2">
              <p className="truncate text-sm font-bold">
                {state.track.title}
              </p>
              {state.track.subtitle ? (
                <p className="truncate text-xs text-[rgb(var(--bg-base)/0.7)]">
                  {state.track.subtitle}
                </p>
              ) : null}
            </div>
            {/* WCAG 2.5.5: touch target ≥ 24px. Visual bar stays at
                1.5px but the click region grows to ~28px via vertical
                padding + negative margin (a "bleeder" — touch area
                expands without displacing surrounding layout). The
                visible bar is rendered as an inner span so the
                surrounding hit region is invisible. */}
            <button
              type="button"
              onClick={onScrub}
              aria-label="Seek"
              className="group relative -my-3 block w-full py-3 focus-visible:outline-none"
            >
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--bg-base)/0.18)] group-focus-visible:ring-2 group-focus-visible:ring-[rgb(var(--brand-primary))] group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-[rgb(var(--fg-primary))]">
                <span
                  className="block h-full bg-[rgb(var(--brand-primary))]"
                  style={{
                    width: "100%",
                    transform: `scaleX(${(progressPct / 100).toFixed(3)})`,
                    transformOrigin: "left",
                    transition: `transform 120ms ${EASE_LINEAR}`,
                  }}
                />
              </span>
            </button>
            <div className="flex items-baseline justify-between font-mono text-[0.62rem] tabular-nums text-[rgb(var(--bg-base)/0.6)]">
              <span aria-label="Current time">{formatClockMs(currentMs)}</span>
              <span aria-label="Total duration">
                {effectiveDurationMs !== null
                  ? formatClockMs(effectiveDurationMs)
                  : "—"}
              </span>
            </div>
          </div>

          {/* Close X. */}
          <button
            type="button"
            onClick={() => {
              playerClose();
            }}
            aria-label="Close player"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--bg-base)/0.7)] transition-colors duration-300 hover:bg-[rgb(var(--bg-base)/0.1)] hover:text-[rgb(var(--bg-base))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--fg-primary))]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Audio element drives playback — sr-only since the buttons above
          announce play/pause state to AT. */}
      <audio
        ref={audioRef}
        src={state.track.audioUrl ?? undefined}
        preload="auto"
        className="sr-only"
      />

      {/* Inline keyframes + dock-aware body padding rule. Self-contained
          here so the mini-player can be reused without a globals.css
          edit. The body[data-skitza-dock] selector matches the same
          attribute the dashboard's <PersistentPlayer /> sets; we scope
          the public-page rule to [data-join-bento] so it doesn't fight
          the dashboard's heavier padding values on shared surfaces.
          Rise animation gates on prefers-reduced-motion: no-preference
          so vestibular-sensitive visitors get an instant fade-in
          instead of the slide. */}
      <style>{`
        @keyframes skitza-mini-rise-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes skitza-mini-rise {
            from { transform: translateY(120%) scale(0.98); opacity: 0; }
            to   { transform: translateY(0)   scale(1);    opacity: 1; }
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes skitza-mini-rise {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        }
        body[data-skitza-dock="1"] [data-join-bento] {
          padding-bottom: 6.5rem;
        }
        @media (min-width: 640px) {
          body[data-skitza-dock="1"] [data-join-bento] {
            padding-bottom: 7.5rem;
          }
        }
      `}</style>
    </>
  );
}

// Format a millisecond offset as M:SS. Used for both the live playhead
// and the total-duration label in the dock. Falls back to 0:00 for
// any non-finite or negative input — defensive because the
// timeupdate event can fire with NaN briefly while metadata loads.
function formatClockMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}
