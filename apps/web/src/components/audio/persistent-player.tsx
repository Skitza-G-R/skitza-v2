"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import { resampleWaveformHeights } from "~/lib/audio/rms-peaks";
import { useAudioPeaks } from "~/lib/audio/use-audio-peaks";
import { shareNative } from "~/lib/native/share";
import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";
import { useToast } from "~/components/ui/toast";
import {
  PLAYER_EVENTS,
  clampSeekMs,
  nextLoopMode,
  playerClose,
  playerLoad,
  playerNext,
  playerPlay,
  playerPrevious,
  playerSeek,
  playerSetLoop,
  playerSetShuffle,
  playerSetVolume,
  playerToggle,
  publishNowPlaying,
  queueNeighbors,
  useNowPlaying,
  usePlaybackSnapshot,
  type LoopMode,
  type PlayerTrack,
} from "./playback-runtime";

export {
  PLAYER_EVENTS,
  clampSeekMs,
  nextLoopMode,
  playerClose,
  playerLoad,
  playerNext,
  playerPlay,
  playerPrevious,
  playerSeek,
  playerSetLoop,
  playerSetShuffle,
  playerSetVolume,
  playerToggle,
  publishNowPlaying,
  queueNeighbors,
  useNowPlaying,
  usePlaybackSnapshot,
};
export type { LoopMode, PlayerLoadOptions, PlayerTrack } from "./playback-runtime";

/**
 * Fixed seek step for the ±10 second transport buttons. Track skips are
 * a separate control now — the founder reported the old "next" arrow
 * jumping 15 seconds instead of moving to the next song.
 */
export const SEEK_STEP_MS = 10_000;

const UUID_PATH_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PRODUCER_SHARED_SONG_PATH = new RegExp(`^/dashboard/music/${UUID_PATH_SEGMENT}/?$`, "i");
const ARTIST_SHARED_SONG_PATH = new RegExp(`^/artist/music/song/${UUID_PATH_SEGMENT}/?$`, "i");

/** True only for the two routes that render the shared Music SongPage. */
export function isSharedSongPagePathname(pathname: string | null): boolean {
  if (!pathname) return false;
  return PRODUCER_SHARED_SONG_PATH.test(pathname) || ARTIST_SHARED_SONG_PATH.test(pathname);
}

// PersistentPlayer — the dark rounded floating dock. Mounted once in
// the dashboard layout (apps/web/src/components/shell/app-shell.tsx)
// so it survives client-side navigation between sibling routes.
//
// Communication with the rest of the app happens over a tiny custom-
// event bus on `window`:
//
//   skitza:player:set    CustomEvent<PlayerTrack | structured load>
//   skitza:player:toggle CustomEvent<void>          — pause / resume
//   skitza:player:seek   CustomEvent<number>        — jump to ms offset
//   skitza:player:volume CustomEvent<number>        — set volume from 0..1
//   skitza:player:close  CustomEvent<void>          — unload + hide dock
//   skitza:player:time   CustomEvent<number>        — BROADCAST: current ms
//
// The first five are inputs; the last is an output (side-panel
// waveforms subscribe to keep their playhead aligned with the dock).

// ─── Pure helpers (exported for direct unit-testing) ─────────────────

/**
 * Pick the best-available duration in milliseconds. The database
 * column can lag behind reality (peak generation hadn't run for old
 * track rows when this was first deployed), so we prefer the live
 * `<audio>.duration` once it loads.
 *
 *   - dbDurationMs is finite + > 0     → use it (preferred, no jitter
 *                                         while audio loads)
 *   - else if audioDurationSec is finite + > 0 → convert sec→ms,
 *                                                round to whole ms
 *   - else                              → null (caller renders a dash)
 *
 * NaN / Infinity are treated as missing (HLS streams report Infinity
 * for `duration` until manifest fully loads).
 */
export function pickDurationMs(
  dbDurationMs: number | null,
  audioDurationSec: number | null,
): number | null {
  if (dbDurationMs !== null && Number.isFinite(dbDurationMs) && dbDurationMs > 0) {
    return dbDurationMs;
  }
  if (audioDurationSec !== null && Number.isFinite(audioDurationSec) && audioDurationSec > 0) {
    return Math.round(audioDurationSec * 1000);
  }
  return null;
}

/**
 * URL the dock's expand button + title + cover link send the user to.
 * Always points at the L3 song page for the currently-playing track-
 * version, but the route prefix flips based on which side of the app
 * the user is currently on:
 *
 *   - /artist/*    →  /artist/music/song/<id>  (artist L3 route)
 *   - everywhere else (including /dashboard/*) → /dashboard/music/<id>
 *     (producer L3 route — historical default)
 *
 * Pathname-derived rather than role-prop so the dock works on every
 * surface that mounts it (producer dashboard, artist app, public
 * /join). Callers don't have to thread a role down.
 */
export function expandHrefForTrack(track: PlayerTrack, pathname: string | null): string {
  if (pathname && pathname.startsWith("/artist")) {
    return `/artist/music/song/${track.id}`;
  }
  return `/dashboard/music/${track.id}`;
}

/**
 * Brand-canonical address for the currently-playing track, so a shared
 * link always reads as skitza.app/... regardless of which deployment
 * the producer happens to be viewing from. Mirrors the Song page's own
 * share control (canonicalSongPageAddress).
 */
export function shareUrlForTrack(track: PlayerTrack, pathname: string | null): string {
  return `${PUBLIC_BRAND_ORIGIN}${expandHrefForTrack(track, pathname)}`;
}

/** Accessible name for the tri-state repeat button. */
export function loopButtonLabel(mode: LoopMode): string {
  if (mode === "all") return "Repeat all";
  if (mode === "one") return "Repeat this song";
  return "Repeat off";
}

/**
 * Only decode audio the browser can actually fetch: the same-origin
 * stream route carries the session cookie, while a raw R2 URL has no
 * CORS grant for our origins and would fail every time. Returns the URL
 * unchanged (not normalized) so the decode cache key matches the one
 * the Song page hero already uses for the same track.
 */
export function sameOriginPeaksUrl(
  audioUrl: string | null | undefined,
  origin: string | null,
): string | null {
  if (!audioUrl || !origin) return null;
  try {
    const base = new URL(origin);
    const url = new URL(audioUrl, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === base.origin ? audioUrl : null;
  } catch {
    return null;
  }
}

export function shouldCollapsePlayerDrag({
  offsetY,
  velocityY,
  viewportHeight,
}: {
  offsetY: number;
  velocityY: number;
  viewportHeight: number;
}): boolean {
  const safeHeight = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  const safeOffset = Number.isFinite(offsetY) ? Math.max(0, offsetY) : 0;
  const safeVelocity = Number.isFinite(velocityY) ? velocityY : 0;
  const distanceThreshold = Math.min(180, Math.max(96, safeHeight * 0.2));

  // Reversing upward before release should always let the sheet return
  // to its open position, even if it travelled past the distance gate.
  if (safeVelocity < -0.25) return false;
  return safeOffset >= distanceThreshold || (safeOffset >= 24 && safeVelocity >= 0.55);
}

/**
 * Exponentially-weighted pointer velocity in px/ms.
 *
 * Shared by the sheet's collapse drag and the artwork swipe so both
 * gestures settle with the same feel. A normal 16ms frame keeps the
 * historic 45/55 blend; a stationary hold decays the stale sample
 * toward zero; and a coordinate that arrives on a tied (or backwards)
 * timestamp is the only fresh direction sample, so it takes ownership.
 */
export function blendPointerVelocity({
  previousVelocity,
  delta,
  elapsedMs,
}: {
  previousVelocity: number;
  delta: number;
  elapsedMs: number;
}): number {
  const elapsed = Math.max(0, elapsedMs);
  const instantaneous = delta / Math.max(1, elapsed);
  const hasImmediateCoordinate = elapsedMs <= 0 && delta !== 0;
  const retention = hasImmediateCoordinate ? 0 : Math.pow(0.45, elapsed / 16);
  return previousVelocity * retention + instantaneous * (1 - retention);
}

// ─── Artwork swipe — song skips on the cover ─────────────────────────
//
// Spotify's gesture: drag the cover sideways to move through the queue.
// The thresholds are the ones useTabSwipe already uses for every other
// horizontal gesture in the app, so committing a swipe costs the same
// travel here as it does on a tab strip.

/** Deliberate travel that commits regardless of speed. */
export const ARTWORK_SWIPE_MIN_DISTANCE = 56;
/** Shorter travel a fast flick is allowed to commit on. */
export const ARTWORK_SWIPE_MIN_FLICK_DISTANCE = 24;
/** px/ms a flick has to reach at that shorter distance. */
export const ARTWORK_SWIPE_MIN_VELOCITY = 0.55;
/** How much more horizontal than vertical the gesture has to be. */
const ARTWORK_SWIPE_INTENT_RATIO = 1.25;
/** Travel before a drag claims a direction (and the pointer). */
const ARTWORK_SWIPE_INTENT_DISTANCE = 12;
/** Rubber band for a drag toward a song the queue does not have. */
const ARTWORK_SWIPE_BOUNDARY_RESISTANCE = 0.2;
const ARTWORK_SWIPE_MAX_BOUNDARY_OFFSET = 24;

export type ArtworkSwipeIntent = "next" | "previous";

/**
 * Which song a horizontal drag is reaching for. The queue reads with
 * the writing direction: in LTR, dragging the cover left pulls the next
 * song in from the right; under `dir="rtl"` — where the sheet already
 * mirrors its own transport row — that flips.
 */
export function artworkSwipeIntent(
  deltaX: number,
  direction: "ltr" | "rtl" = "ltr",
): ArtworkSwipeIntent {
  const towardsNext = direction === "rtl" ? deltaX > 0 : deltaX < 0;
  return towardsNext ? "next" : "previous";
}

/**
 * Resolves a released artwork drag to a song skip, or to nothing.
 *
 * A gesture commits on deliberate travel, or on a short flick whose
 * velocity agrees with where the finger actually ended up — a reversed
 * flick must not skip to a song the finger walked back from. "Previous"
 * stays live at the top of the queue: the runtime restarts the current
 * song there, exactly like the Previous button.
 */
export function resolveArtworkSwipe({
  deltaX,
  deltaY,
  velocityX,
  hasNext,
  direction = "ltr",
}: {
  deltaX: number;
  deltaY: number;
  velocityX: number;
  hasNext: boolean;
  direction?: "ltr" | "rtl";
}): ArtworkSwipeIntent | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || !Number.isFinite(velocityX)) {
    return null;
  }
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);
  if (deltaX === 0 || horizontal <= vertical * ARTWORK_SWIPE_INTENT_RATIO) return null;

  const flicked =
    horizontal >= ARTWORK_SWIPE_MIN_FLICK_DISTANCE &&
    Math.abs(velocityX) >= ARTWORK_SWIPE_MIN_VELOCITY &&
    Math.sign(velocityX) === Math.sign(deltaX);
  if (horizontal < ARTWORK_SWIPE_MIN_DISTANCE && !flicked) return null;

  const intent = artworkSwipeIntent(deltaX, direction);
  // End of the queue with repeat off — there is nothing to hand over to.
  if (intent === "next" && !hasNext) return null;
  return intent;
}

/**
 * How far the cover travels with the finger: one-to-one while there is
 * a song to reach, and a short resisted stretch when there is not, so
 * the end of the queue is felt rather than silently ignored.
 */
export function resolveArtworkDragOffset({
  deltaX,
  hasNext,
  direction = "ltr",
}: {
  deltaX: number;
  hasNext: boolean;
  direction?: "ltr" | "rtl";
}): number {
  if (!Number.isFinite(deltaX)) return 0;
  if (artworkSwipeIntent(deltaX, direction) === "next" && !hasNext) {
    const resisted = deltaX * ARTWORK_SWIPE_BOUNDARY_RESISTANCE;
    return Math.max(
      -ARTWORK_SWIPE_MAX_BOUNDARY_OFFSET,
      Math.min(ARTWORK_SWIPE_MAX_BOUNDARY_OFFSET, resisted),
    );
  }
  return deltaX;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Motion-sensitive users get the skip, never the travelling cover. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

// ─── Component ───────────────────────────────────────────────────────

export function PersistentPlayer() {
  const state = usePlaybackSnapshot();
  const currentMs = state.currentMs;
  const audioDurationSec = state.audioDurationSec;
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  // Reactive pathname — re-renders on navigation. Drives
  // expandHrefForTrack so the dock's title / cover / expand button
  // route to the right L3 (artist vs producer) without each caller
  // having to pass a role prop.
  const pathname = usePathname();
  // SongPage supplies its own full transport. Hide only the dock chrome
  // there; AppPlaybackRuntime remains mounted so playback continues.
  const dockHidden = isSharedSongPagePathname(pathname);

  // Toggle a body data attribute so globals.css can reserve
  // padding-bottom equal to the dock's height on every dashboard
  // page. Skip the reservation when the dock is hidden by route
  // (song page) — we don't want phantom space below the comments
  // for a dock that isn't visible.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (state.track && !dockHidden) {
      document.body.dataset.skitzaDock = "1";
    } else {
      delete document.body.dataset.skitzaDock;
    }
    return () => {
      delete document.body.dataset.skitzaDock;
    };
  }, [state.track, dockHidden]);

  if (!state.track) return null;

  const neighbors = queueNeighbors(state);
  const dbDurationMs = state.track.durationMs;
  const effectiveDurationMs = pickDurationMs(dbDurationMs, audioDurationSec);
  const progressPct =
    effectiveDurationMs && effectiveDurationMs > 0
      ? Math.min(100, Math.max(0, (currentMs / effectiveDurationMs) * 100))
      : 0;

  function onScrub(pct: number) {
    if (!effectiveDurationMs) return;
    const ms = Math.floor((pct / 100) * effectiveDurationMs);
    playerSeek(ms);
  }

  function onSkip(deltaMs: number) {
    playerSeek(clampSeekMs(currentMs, deltaMs, effectiveDurationMs));
  }

  function onTogglePlay() {
    playerToggle();
  }

  async function onShare() {
    const track = state.track;
    if (!track || sharing) return;
    setSharing(true);
    try {
      const url = shareUrlForTrack(track, pathname);
      const result = await shareNative({
        title: track.title,
        text: `Listen to ${track.title} on Skitza`,
        url,
        fallbackText: url,
      });
      if (result.status === "shared") toast("Song shared", "success");
      if (result.status === "copied") toast("Song link copied", "success");
      if (result.status === "unavailable") {
        toast("Could not share this song. Try again.", "error");
      }
    } catch {
      toast("Could not share this song. Try again.", "error");
    } finally {
      setSharing(false);
    }
  }

  const transport = {
    loop: state.loop,
    shuffle: state.shuffle,
    hasNext: neighbors.next !== null,
    onTogglePlay,
    onScrub,
    onSkip,
    onNext: () => {
      playerNext();
    },
    onPrevious: () => {
      playerPrevious();
    },
    onCycleLoop: () => {
      playerSetLoop(nextLoopMode(state.loop));
    },
    onToggleShuffle: () => {
      playerSetShuffle(!state.shuffle);
    },
    onShare: () => {
      void onShare();
    },
    sharing,
  };

  return (
    <>
      {/* Desktop dock — md+ */}
      <DesktopDock
        track={state.track}
        playing={state.playing}
        currentMs={currentMs}
        durationMs={effectiveDurationMs}
        progressPct={progressPct}
        hidden={dockHidden}
        pathname={pathname}
        {...transport}
      />
      {/* Mobile dock — <md, sits above the bottom nav. Tapping it
          expands into the full-screen player (SK-55), so it needs the
          full transport state, not just play/pause. */}
      <MobileDock
        track={state.track}
        playing={state.playing}
        currentMs={currentMs}
        durationMs={effectiveDurationMs}
        progressPct={progressPct}
        hidden={dockHidden}
        pathname={pathname}
        {...transport}
      />
    </>
  );
}

// ─── Shared transport contract ───────────────────────────────────────
//
// Every surface (desktop dock, mobile mini bar, full-screen player)
// drives the same runtime, so they share one prop bag rather than each
// re-deriving queue position and repeat state.

export interface PlayerTransport {
  loop: LoopMode;
  shuffle: boolean;
  /** False at the end of the queue with repeat off — the button disables. */
  hasNext: boolean;
  onTogglePlay: () => void;
  onScrub: (pct: number) => void;
  onSkip: (deltaMs: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onCycleLoop: () => void;
  onToggleShuffle: () => void;
  onShare: () => void;
  sharing: boolean;
}

// ─── Desktop dock ────────────────────────────────────────────────────

function DesktopDock({
  track,
  playing,
  currentMs,
  durationMs,
  progressPct,
  hidden = false,
  pathname,
  loop,
  shuffle,
  hasNext,
  onTogglePlay,
  onScrub,
  onSkip,
  onNext,
  onPrevious,
  onCycleLoop,
  onToggleShuffle,
  onShare,
  sharing,
}: {
  track: PlayerTrack;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  progressPct: number;
  hidden?: boolean;
  pathname: string | null;
} & PlayerTransport) {
  return (
    <div
      role="region"
      aria-label="Audio player"
      aria-hidden={hidden}
      inert={hidden}
      // Floats with margin from the sidebar (lg+) and from the right
      // edge — feels like a tactile dock, not a full-width bar. The
      // .persistent-player-dock class in globals.css contributes the
      // `bottom: <safe-area-inset>` offset; we layer the desktop
      // margins on top here.
      //
      // When `hidden` (route-driven, e.g. on the Song page where the
      // inline waveform is the playback UI), the dock slides off-screen
      // with a soft ease-out — audio keeps playing, only the chrome
      // hides. inert prevents focus from landing on it while hidden.
      className={[
        "persistent-player-dock fixed inset-x-0 z-40 hidden md:flex md:justify-center md:px-6 lg:ps-[calc(var(--sidebar-width,260px)+24px)] lg:pe-6",
        hidden ? "pointer-events-none" : "",
      ].join(" ")}
      style={{
        // Emil's "blur to mask imperfect transitions" + asymmetric
        // timing (slow exit, snappy entry). Exit is deliberate — the
        // dock is bowing out so the song page takes focus. Entry is
        // welcoming — snap back to seat when you're back in Library.
        // Opacity + transform + blur run together so the dock dissolves
        // away instead of just falling off-screen.
        transform: hidden ? "translateY(110%) scale(0.98)" : "translateY(0) scale(1)",
        opacity: hidden ? 0 : 1,
        filter: hidden ? "blur(6px)" : "blur(0px)",
        transition: hidden
          ? "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms cubic-bezier(0.16, 1, 0.3, 1), filter 380ms cubic-bezier(0.16, 1, 0.3, 1)"
          : "transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: "transform, opacity, filter",
      }}
    >
      <div
        className="grid w-full max-w-[820px] grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-[18px] border px-3 py-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.42),_0_4px_12px_rgba(0,0,0,0.18)] backdrop-blur-md"
        style={{
          background: "rgb(var(--bg-sidebar))",
          borderColor: "rgba(255,255,255,0.08)",
          color: "#fff",
        }}
      >
        {/* LEFT — track info. Sits in the first 1fr column. The grid
            template (1fr_auto_1fr) keeps the auto-width center column
            exactly in the middle of the dock regardless of left/right
            content imbalance — flexbox can't do this without per-side
            spacers. The whole block is a Link → song page (Apple Music
            "tap the mini-player to expand to Now Playing" pattern).
            sk-press gives the same tactile press feedback used elsewhere
            in the app so the whole row reads as one tappable surface. */}
        <Link
          href={expandHrefForTrack(track, pathname)}
          prefetch={false}
          aria-label={`Open ${track.title} song page`}
          title="Open song page"
          className="sk-press flex min-h-11 min-w-0 items-center gap-3 rounded-[14px] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          <Cover track={track} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold tracking-[-0.01em]">{track.title}</p>
            <p className="truncate text-[11px] font-semibold text-[rgb(var(--brand-primary))]">
              {track.subtitle}
            </p>
          </div>
        </Link>

        {/* CENTER — transport. Sits in the auto-width middle grid
            track. The inner stack carries `min-w-[360px]` so the
            auto column expands to give the time + waveform row room
            to render — without it the waveform collapses (regression
            the founder flagged: "no waveform bar on the floating
            player"). */}
        <div className="hidden min-w-[420px] flex-col items-center gap-1.5 lg:flex">
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              aria-label="Shuffle"
              aria-pressed={shuffle}
              title="Shuffle"
              onClick={onToggleShuffle}
              className={[
                "sk-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-lg)]",
                shuffle ? "text-[rgb(var(--brand-primary))]" : "text-white/55 hover:text-white",
              ].join(" ")}
            >
              <ShuffleIcon />
            </button>
            <button
              type="button"
              aria-label="Previous song"
              title="Previous song"
              onClick={onPrevious}
              className="sk-press inline-flex min-h-11 min-w-11 items-center justify-center text-white/55 hover:text-white"
            >
              <SkipBackIcon />
            </button>
            <button
              type="button"
              aria-label="Back 10 seconds"
              title="Back 10 seconds"
              onClick={() => {
                onSkip(-SEEK_STEP_MS);
              }}
              className="sk-press inline-flex min-h-11 min-w-11 items-center justify-center text-white/55 hover:text-white"
            >
              <Seek10Icon direction="back" />
            </button>
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={onTogglePlay}
              className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)] shadow-[0_2px_14px_rgba(255,255,255,0.18)]"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              aria-label="Forward 10 seconds"
              title="Forward 10 seconds"
              onClick={() => {
                onSkip(SEEK_STEP_MS);
              }}
              className="sk-press inline-flex min-h-11 min-w-11 items-center justify-center text-white/55 hover:text-white"
            >
              <Seek10Icon direction="forward" />
            </button>
            <button
              type="button"
              aria-label="Next song"
              title="Next song"
              onClick={onNext}
              disabled={!hasNext}
              className="sk-press inline-flex min-h-11 min-w-11 items-center justify-center text-white/55 hover:text-white disabled:cursor-not-allowed disabled:text-white/20 disabled:hover:text-white/20"
            >
              <SkipForwardIcon />
            </button>
            <button
              type="button"
              aria-label={loopButtonLabel(loop)}
              aria-pressed={loop !== "off"}
              title={loopButtonLabel(loop)}
              onClick={onCycleLoop}
              className={[
                "sk-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-lg)]",
                loop === "off" ? "text-white/55 hover:text-white" : "text-[rgb(var(--brand-primary))]",
              ].join(" ")}
            >
              <LoopIcon single={loop === "one"} />
            </button>
          </div>
          <div className="flex w-full items-center gap-2.5 font-mono text-[10px] text-white/40">
            <span className="w-8 text-right tabular-nums">{fmtTime(currentMs)}</span>
            <MiniWaveform track={track} progressPct={progressPct} onScrub={onScrub} />
            <span className="w-8 tabular-nums">
              {durationMs == null ? "—" : fmtTime(durationMs)}
            </span>
          </div>
        </div>

        {/* Compact play (md → lg) — when the center transport is
            hidden, this sits in the auto-width center grid track. */}
        <div className="flex items-center justify-center lg:hidden">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)] shadow-[0_2px_14px_rgba(255,255,255,0.18)]"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>

        {/* RIGHT — expand + close. Right-aligned within the third
            1fr column (justify-self-end + justify-end). The opposite
            1fr column on the left mirrors this so the center auto
            column stays at true geometric center. */}
        <div className="flex items-center justify-end gap-1 justify-self-end border-s border-white/10 ps-3">
          <button
            type="button"
            aria-label="Share song"
            title="Share song"
            aria-busy={sharing}
            disabled={sharing}
            onClick={onShare}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-white/55 hover:text-white disabled:opacity-50"
          >
            <ShareIcon />
          </button>
          <Link
            href={expandHrefForTrack(track, pathname)}
            prefetch={false}
            aria-label="Open song page"
            title="Open song page"
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-white/55 hover:text-white"
          >
            <ExpandIcon />
          </Link>
          <button
            type="button"
            aria-label="Close player"
            title="Close player"
            onClick={() => {
              playerClose();
            }}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-white/[0.06] text-white/70 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mobile dock ─────────────────────────────────────────────────────

export function MobileDock({
  track,
  playing,
  currentMs,
  durationMs,
  progressPct,
  hidden = false,
  pathname,
  ...transport
}: {
  track: PlayerTrack;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  progressPct: number;
  hidden?: boolean;
  pathname: string | null;
} & PlayerTransport) {
  const { onTogglePlay } = transport;
  // SK-55 — tapping the mini bar expands a full-screen player (the
  // Spotify/Apple-Music pattern). One state flag toggles the
  // `.expanded` class on the overlay; CSS transitions do the motion.
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const collapseBtnRef = useRef<HTMLButtonElement | null>(null);
  const fullPlayerExpanded = expanded && !hidden;
  const portalScope =
    mounted && typeof document !== "undefined"
      ? dockRef.current?.closest<HTMLElement>("[dir]")
      : null;

  // The full player is a true viewport modal, not part of the clipped app
  // shell. Defer the body portal until after hydration so SSR never touches
  // `document`.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Force-collapse if the dock is hidden externally (e.g. close event).
  useEffect(() => {
    if (hidden) setExpanded(false);
  }, [hidden]);

  // While expanded: lock body scroll, close on Escape, and move focus
  // to the collapse chevron so keyboard/VoiceOver users land inside
  // the dialog.
  useEffect(() => {
    if (!fullPlayerExpanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    collapseBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullPlayerExpanded]);

  return (
    <>
      <div
        ref={dockRef}
        role="region"
        aria-label="Audio player"
        aria-hidden={hidden}
        inert={hidden}
        // Sits above the producer Liquid Glass nav on <md.
        // .persistent-player-dock from globals.css already handles the
        // bottom-nav + safe-area offset; here we just ensure the dock
        // takes the dark pill aesthetic and only renders <md.
        className={[
          "persistent-player-dock fixed inset-x-2 z-40 flex md:hidden",
          hidden ? "pointer-events-none" : "",
        ].join(" ")}
        style={{
          // This wrapper must be *completely inert* while the dock is visible.
          //
          // An element that establishes a backdrop root hides the page from any
          // `backdrop-filter` beneath it — the pill would sample this wrapper,
          // which paints nothing, and blur nothing. `filter` does that, and so
          // do `transform` and `will-change: transform`, which is why all three
          // are conditional. Measured with a hard colour edge behind the bar:
          // with an identity `transform` still set, the edge came through at
          // 0.0px spread — no blur at all, even though the computed style read
          // `blur(20px)`. The tab row escapes this because its transform sits on
          // the blurred layer itself, not on an ancestor.
          //
          // `none` -> `translateY(120%)` still animates, so the exit is intact.
          transform: hidden ? "translateY(120%) scale(0.98)" : "none",
          opacity: hidden ? 0 : 1,
          transition: hidden
            ? "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms cubic-bezier(0.16, 1, 0.3, 1)"
            : "transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: hidden ? "transform, opacity" : "auto",
        }}
      >
        <div className="persistent-player-dock__glass sk-toast-in flex w-full items-center gap-2.5 rounded-xl border px-2 py-2 shadow-[0_-4px_24px_rgba(0,0,0,0.4)]">
          {/* Cover + title is one tappable surface → expands the
              full-screen player (Spotify/Apple-Music mini-bar
              behavior). The song PAGE stays reachable from inside the
              expanded player's header. */}
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
            }}
            aria-label={`Expand player — ${track.title}`}
            aria-expanded={expanded}
            className="sk-press flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-lg)] text-left focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
          >
            <Cover track={track} size={38} />
            <div className="min-w-0 flex-1">
              <p className="persistent-player-dock__ink truncate text-[13px] font-bold tracking-[-0.01em]">
                {track.title}
              </p>
              {/* Neutral, not brand amber. Over a warm cover the amber
                  subtitle sat on a wash of its own hue and washed out in both
                  themes — the one place the glass genuinely cost legibility.
                  It stays secondary through size and weight, the same way the
                  tab row below dropped its own tint. */}
              <p className="persistent-player-dock__ink truncate text-[11px] font-semibold text-[rgb(var(--sk-nav-glass-ink)/0.72)]">
                {track.subtitle}
              </p>
            </div>
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--sk-nav-glass-ink))] text-[rgb(var(--sk-nav-glass-tint))]"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            aria-label="Expand player"
            title="Expand player"
            onClick={() => {
              setExpanded(true);
            }}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--sk-nav-glass-ink)/0.72)] hover:text-[rgb(var(--sk-nav-glass-ink))]"
          >
            <ExpandIcon />
          </button>
          <button
            type="button"
            aria-label="Close player"
            title="Close player"
            onClick={() => {
              playerClose();
            }}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--sk-nav-glass-ink)/0.08)] text-[rgb(var(--sk-nav-glass-ink)/0.72)] hover:text-[rgb(var(--sk-nav-glass-ink))]"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {mounted && !hidden && typeof document !== "undefined"
        ? createPortal(
            <MobileFullPlayer
              track={track}
              playing={playing}
              currentMs={currentMs}
              durationMs={durationMs}
              progressPct={progressPct}
              {...transport}
              expanded={expanded}
              onCollapse={() => {
                setExpanded(false);
              }}
              collapseBtnRef={collapseBtnRef}
              pathname={pathname}
              direction={portalScope?.dir === "rtl" ? "rtl" : "ltr"}
              language={portalScope?.lang || document.documentElement.lang || undefined}
            />,
            document.body,
          )
        : null}
    </>
  );
}

// ─── Mobile full-screen player (SK-55) ───────────────────────────────
//
// Kept mounted while the dock is visible so the slide-up/down transition
// can run both ways; route-hidden states remove it entirely. The `expanded`
// flag toggles the transform (CSS class-toggle pattern — the state machine
// is one boolean, the motion is pure CSS). Reduced-motion users
// get an instant swap.

export function MobileFullPlayer({
  track,
  playing,
  currentMs,
  durationMs,
  progressPct,
  loop,
  shuffle,
  hasNext,
  onTogglePlay,
  onScrub,
  onSkip,
  onNext,
  onPrevious,
  onCycleLoop,
  onToggleShuffle,
  onShare,
  sharing,
  expanded,
  onCollapse,
  collapseBtnRef,
  pathname,
  direction,
  language,
}: {
  track: PlayerTrack;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  progressPct: number;
  expanded: boolean;
  onCollapse: () => void;
  collapseBtnRef: React.RefObject<HTMLButtonElement | null>;
  pathname: string | null;
  direction?: "ltr" | "rtl";
  language?: string | undefined;
} & PlayerTransport) {
  // Tint the top of the sheet with the track's identity gradient —
  // same producerGradient hash the covers use, so mini → full reads
  // as the same object growing.
  const tint = producerGradient(track.subtitle);
  const swipeDirection = direction === "rtl" ? "rtl" : "ltr";
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [scrubPreviewPct, setScrubPreviewPct] = useState<number | null>(null);
  const [artworkOffsetX, setArtworkOffsetX] = useState(0);
  const [artworkSwiping, setArtworkSwiping] = useState(false);
  const suppressHandleClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastAt: number;
    velocityY: number;
    moved: boolean;
  } | null>(null);
  const artworkDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastAt: number;
    velocityX: number;
    horizontal: boolean;
    reducedMotion: boolean;
  } | null>(null);

  useEffect(() => {
    if (expanded) return;
    dragRef.current = null;
    artworkDragRef.current = null;
    setDragging(false);
    setDragOffsetY(0);
    setScrubPreviewPct(null);
    setArtworkSwiping(false);
    setArtworkOffsetX(0);
  }, [expanded]);

  function pointerOffset(clientY: number): number {
    const drag = dragRef.current;
    if (!drag) return 0;
    const viewportHeight = typeof window === "undefined" ? 800 : Math.max(1, window.innerHeight);
    return Math.min(viewportHeight, Math.max(0, clientY - drag.startY));
  }

  function onHandlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressHandleClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: event.timeStamp,
      velocityY: 0,
      moved: false,
    };
    setDragging(true);
    setDragOffsetY(0);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Older Safari builds can expose pointer capture before it works.
    }
  }

  function onHandlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const offsetY = pointerOffset(event.clientY);
    drag.velocityY = blendPointerVelocity({
      previousVelocity: drag.velocityY,
      delta: event.clientY - drag.lastY,
      elapsedMs: event.timeStamp - drag.lastAt,
    });
    drag.lastY = event.clientY;
    drag.lastAt = event.timeStamp;
    drag.moved ||= Math.abs(event.clientY - drag.startY) >= 5;
    setDragOffsetY(offsetY);
  }

  function finishHandleDrag(event: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const offsetY = pointerOffset(event.clientY);
    const velocityY = blendPointerVelocity({
      previousVelocity: drag.velocityY,
      delta: event.clientY - drag.lastY,
      elapsedMs: event.timeStamp - drag.lastAt,
    });
    const moved = drag.moved || Math.abs(event.clientY - drag.startY) >= 5;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Losing capture during system gestures is safe; settle below.
    }

    if (moved) {
      suppressHandleClickRef.current = true;
      window.setTimeout(() => {
        suppressHandleClickRef.current = false;
      }, 0);
    }

    if (
      !cancelled &&
      moved &&
      shouldCollapsePlayerDrag({
        offsetY,
        velocityY,
        viewportHeight: window.innerHeight,
      })
    ) {
      setDragOffsetY(offsetY);
      onCollapse();
      return;
    }
    setDragOffsetY(0);
  }

  // ── Artwork swipe ──
  // The cover is the only surface here that owns horizontal travel, so
  // the gesture waits for the finger to declare itself: a vertical drag
  // is handed straight back to the browser rather than fighting it.

  function onArtworkPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    artworkDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      velocityX: 0,
      horizontal: false,
      reducedMotion: prefersReducedMotion(),
    };
  }

  function onArtworkPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = artworkDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (!drag.horizontal) {
      if (
        Math.abs(deltaX) < ARTWORK_SWIPE_INTENT_DISTANCE &&
        Math.abs(deltaY) < ARTWORK_SWIPE_INTENT_DISTANCE
      ) {
        return;
      }
      if (Math.abs(deltaX) <= Math.abs(deltaY) * ARTWORK_SWIPE_INTENT_RATIO) {
        artworkDragRef.current = null;
        return;
      }
      drag.horizontal = true;
      setArtworkSwiping(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Older Safari builds can expose pointer capture before it works.
      }
    }

    event.preventDefault();
    drag.velocityX = blendPointerVelocity({
      previousVelocity: drag.velocityX,
      delta: event.clientX - drag.lastX,
      elapsedMs: event.timeStamp - drag.lastAt,
    });
    drag.lastX = event.clientX;
    drag.lastAt = event.timeStamp;
    if (drag.reducedMotion) return;
    setArtworkOffsetX(resolveArtworkDragOffset({ deltaX, hasNext, direction: swipeDirection }));
  }

  function finishArtworkDrag(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const drag = artworkDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    artworkDragRef.current = null;
    setArtworkSwiping(false);
    // Always settle the cover back to centre: a committed swipe repaints
    // it with the next song's identity gradient in the same frame.
    setArtworkOffsetX(0);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Losing capture to a system gesture is safe; the cover settled above.
    }
    if (!drag.horizontal || cancelled) return;

    event.preventDefault();
    const intent = resolveArtworkSwipe({
      deltaX: event.clientX - drag.startX,
      deltaY: event.clientY - drag.startY,
      velocityX: blendPointerVelocity({
        previousVelocity: drag.velocityX,
        delta: event.clientX - drag.lastX,
        elapsedMs: event.timeStamp - drag.lastAt,
      }),
      hasNext,
      direction: swipeDirection,
    });
    if (intent === "next") onNext();
    if (intent === "previous") onPrevious();
  }

  // A cover mid-gesture dims a little as it leaves, so the hand-off to
  // the next song reads as travel rather than a slab sliding about.
  const artworkTravelling = artworkOffsetX !== 0;
  const displayedProgressPct = scrubPreviewPct ?? progressPct;
  const displayedCurrentMs =
    scrubPreviewPct !== null && durationMs
      ? Math.round((scrubPreviewPct / 100) * durationMs)
      : currentMs;

  return (
    <div
      role="dialog"
      aria-modal={expanded}
      aria-label={`Now playing — ${track.title}`}
      aria-hidden={!expanded}
      inert={!expanded}
      data-player-state={expanded ? "open" : "closed"}
      dir={direction}
      lang={language}
      className={[
        "mobile-full-player-sheet fixed inset-x-0 z-50 flex flex-col md:hidden",
        expanded ? "" : "pointer-events-none",
      ].join(" ")}
      style={{
        background: "#141414",
        color: "#fff",
        top: "var(--sk-layout-viewport-top, 0px)",
        bottom: "auto",
        height: "var(--sk-layout-viewport-height, 100dvh)",
        maxHeight: "var(--sk-layout-viewport-height, 100dvh)",
        transform: expanded ? `translateY(${String(dragOffsetY)}px)` : "translateY(100%)",
        transition: dragging ? "none" : undefined,
        willChange: expanded || dragging ? "transform" : undefined,
      }}
    >
      {/* Identity tint — fades from the track gradient into the dark
          sheet so the artwork sits in its own light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[46%] opacity-[0.32]"
        style={{
          background: tint,
          maskImage: "linear-gradient(to bottom, black, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
        }}
      />

      <div
        className="relative flex h-full min-h-0 flex-col px-6 pb-6"
        style={{ paddingTop: "max(6px, env(safe-area-inset-top))" }}
      >
        {/* Grab handle — the whole strip is the minimize control
            (Samply/Apple-sheet language: a quiet pill up top instead
            of header chrome). Escape and the Close footer also exist. */}
        <button
          ref={collapseBtnRef}
          type="button"
          aria-label="Minimize player"
          onClick={() => {
            if (suppressHandleClickRef.current) {
              suppressHandleClickRef.current = false;
              return;
            }
            onCollapse();
          }}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={(event) => {
            finishHandleDrag(event, false);
          }}
          onPointerCancel={(event) => {
            finishHandleDrag(event, true);
          }}
          onLostPointerCapture={(event) => {
            if (event.target !== event.currentTarget) return;
            if (dragRef.current?.pointerId === event.pointerId) {
              finishHandleDrag(event, true);
            }
          }}
          className="sk-press mx-auto flex h-11 w-full max-w-[160px] touch-none items-center justify-center select-none"
        >
          <span aria-hidden className="h-[5px] w-10 rounded-full bg-white/25" />
        </button>

        {/* Artwork — square, screen-width minus gutters, capped so it
            never starves the transport on short phones. Soft radial
            highlight over the identity gradient (Samply's airbrushed
            cover feel) instead of a flat color slab.

            The cap is 100% of this flex slot, not a slice of the viewport:
            a viewport fraction knows nothing about the chrome stacked below,
            so on a short phone the cover overflowed the slot and painted over
            the song title. Letting it letterbox is fine — the block is a
            decorative gradient, not a real cover image.

            The slot is also the swipe surface: dragging the cover
            sideways moves through the queue, the way every phone music app
            does it. `touch-action: pan-y` keeps vertical gestures with the
            browser while claiming the horizontal axis, so the gesture can
            never race iOS's edge back-swipe. */}
        <div
          className="flex min-h-0 flex-1 touch-pan-y items-center justify-center py-3 select-none"
          onPointerDown={onArtworkPointerDown}
          onPointerMove={onArtworkPointerMove}
          onPointerUp={(event) => {
            finishArtworkDrag(event, false);
          }}
          onPointerCancel={(event) => {
            finishArtworkDrag(event, true);
          }}
          onLostPointerCapture={(event) => {
            if (event.target !== event.currentTarget) return;
            if (artworkDragRef.current?.pointerId === event.pointerId) {
              finishArtworkDrag(event, true);
            }
          }}
        >
          <div
            aria-hidden
            data-swipe-state={artworkSwiping ? "dragging" : undefined}
            className="mobile-full-player-artwork relative aspect-square w-full max-w-[360px] overflow-hidden rounded-[28px] shadow-[0_28px_70px_rgba(0,0,0,0.55)]"
            style={{
              background: tint,
              maxHeight: "min(360px, 100%)",
              transform: artworkTravelling ? `translateX(${String(artworkOffsetX)}px)` : undefined,
              opacity: artworkTravelling
                ? Math.max(0.55, 1 - Math.abs(artworkOffsetX) / 640)
                : undefined,
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(115% 95% at 22% 14%, rgba(255,255,255,0.34), transparent 58%), radial-gradient(120% 100% at 85% 95%, rgba(0,0,0,0.28), transparent 55%)",
              }}
            />
            <span className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
          </div>
        </div>

        {/* Title row — the name itself opens the song page (Gili,
            round 2), with a round glass button as the explicit
            affordance for the same destination. */}
        <div className="flex items-center gap-3">
          <Link
            href={expandHrefForTrack(track, pathname)}
            prefetch={false}
            onClick={onCollapse}
            className="group min-w-0 flex-1 rounded-md focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
            aria-label={`Open ${track.title} song page`}
          >
            <p className="truncate text-[22px] leading-tight font-extrabold tracking-[-0.015em] group-active:opacity-70">
              {track.title}
            </p>
            <p className="mt-0.5 truncate text-[14px] font-semibold text-[rgb(var(--brand-primary))]">
              {track.subtitle}
            </p>
          </Link>
          <button
            type="button"
            aria-label="Share song"
            title="Share song"
            aria-busy={sharing}
            disabled={sharing}
            onClick={onShare}
            className="sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/85 hover:bg-white/[0.14] hover:text-white disabled:opacity-50"
          >
            <ShareIcon />
          </button>
          <Link
            href={expandHrefForTrack(track, pathname)}
            prefetch={false}
            onClick={onCollapse}
            aria-label="Open song page"
            title="Open song page"
            className="sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/85 hover:bg-white/[0.14] hover:text-white"
          >
            <ExpandIcon />
          </Link>
        </div>

        {/* Seek — tall waveform + time stamps. */}
        <div className="mt-4">
          <div className="flex items-center">
            <MiniWaveform
              track={track}
              progressPct={displayedProgressPct}
              onScrub={onScrub}
              onPreview={setScrubPreviewPct}
              tall
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] text-white/55 tabular-nums">
            <span>{fmtTime(displayedCurrentMs)}</span>
            <span>{durationMs ? fmtTime(durationMs) : "–:––"}</span>
          </div>
        </div>

        {/* Transport — 64px play/pause between song skips, with shuffle
            and repeat on the outside (Spotify / Apple Music order). */}
        <div className="mt-2 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Shuffle"
            aria-pressed={shuffle}
            onClick={onToggleShuffle}
            className={[
              "sk-press inline-flex h-11 w-11 items-center justify-center rounded-full",
              shuffle ? "text-[rgb(var(--brand-primary))]" : "text-white/60 hover:text-white",
            ].join(" ")}
          >
            <ShuffleIcon />
          </button>
          <button
            type="button"
            aria-label="Previous song"
            onClick={onPrevious}
            className="sk-press inline-flex h-12 w-12 items-center justify-center rounded-full text-white/85 hover:text-white"
          >
            <SkipBackIcon />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
            className="sk-press inline-flex h-16 w-16 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)] shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
          >
            <span className="scale-[1.45]">{playing ? <PauseIcon /> : <PlayIcon />}</span>
          </button>
          <button
            type="button"
            aria-label="Next song"
            onClick={onNext}
            disabled={!hasNext}
            className="sk-press inline-flex h-12 w-12 items-center justify-center rounded-full text-white/85 hover:text-white disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:text-white/25"
          >
            <SkipForwardIcon />
          </button>
          <button
            type="button"
            aria-label={loopButtonLabel(loop)}
            aria-pressed={loop !== "off"}
            onClick={onCycleLoop}
            className={[
              "sk-press inline-flex h-11 w-11 items-center justify-center rounded-full",
              loop === "off" ? "text-white/60 hover:text-white" : "text-[rgb(var(--brand-primary))]",
            ].join(" ")}
          >
            <LoopIcon single={loop === "one"} />
          </button>
        </div>

        {/* Fine seek — the ±10 second nudges live on their own row so
            the song skips above never get mistaken for them again. */}
        <div className="mt-1.5 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Back 10 seconds"
            onClick={() => {
              onSkip(-SEEK_STEP_MS);
            }}
            className="sk-press inline-flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-white/60 hover:text-white"
          >
            <Seek10Icon direction="back" />
          </button>
          <button
            type="button"
            aria-label="Forward 10 seconds"
            onClick={() => {
              onSkip(SEEK_STEP_MS);
            }}
            className="sk-press inline-flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-white/60 hover:text-white"
          >
            <Seek10Icon direction="forward" />
          </button>
        </div>

        {/* Footer — quiet close action, clear of the home indicator. */}
        <div
          className="mt-3 flex justify-center"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <button
            type="button"
            onClick={() => {
              onCollapse();
              playerClose();
            }}
            className="sk-press inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 font-mono text-[10px] font-bold tracking-[0.14em] text-white/45 uppercase hover:text-white/80"
          >
            <CloseIcon />
            Close player
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cover ────────────────────────────────────────────────────────────

function Cover({ track, size }: { track: PlayerTrack; size: number }) {
  // Hash the subtitle so the dock cover matches the L1 list / hero
  // gradient for the same client. `producerGradient` is deterministic
  // — same input string → same gradient, every render.
  const bg = producerGradient(track.subtitle);
  return (
    <div
      aria-hidden
      className="relative shrink-0 overflow-hidden rounded-md"
      style={{ width: size, height: size, background: bg }}
    >
      {/* Faint inner ring so the cover reads as tactile against the
          dark dock surface. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
      />
    </div>
  );
}

// ─── Mini waveform (dock progress visual) ────────────────────────────
// A row of bars matching the L3 hero waveform aesthetic — same "this is
// a music app" visual language. Played bars render solid white,
// unplayed bars sit at 20% white. Click anywhere on the strip to seek
// (the founder still expects scrubbing to work from the dock).
//
// The envelope is the REAL audio, in this order:
//
//   1. track.peaks — pre-computed server-side at upload and shipped
//      down with the page payload. No fetch, correct on first frame.
//   2. a client decode of the same-origin stream URL, sharing the
//      module cache with the L3 hero waveform, so a track that was
//      already drawn on the Song page costs nothing here.
//   3. the seeded pseudo-envelope below — only while a decode is in
//      flight, or when the audio can't be decoded at all (offline,
//      exotic container, cross-origin public URL).

const MINI_BAR_COUNT = 32;
/** The full-screen player is wider and taller — give it finer detail. */
const FULL_BAR_COUNT = 64;

// 32-bit FNV-1a + tiny PRNG, derived from `seededHeights` in
// waveform-50.tsx. Same input → same bar pattern, every render.
function seededBars(seed: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = (h ^ 0x9e3779b9) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    // Skew toward middle so the dock waveform reads as an envelope,
    // not jagged outliers. Floor at 0.3 so even quiet bars stay
    // visible against the dark dock.
    out.push(0.3 + r * 0.6 + Math.sin(i * 0.7) * 0.06);
  }
  return out;
}

export function MiniWaveform({
  track,
  progressPct,
  onScrub,
  onPreview,
  tall = false,
}: {
  track: PlayerTrack;
  progressPct: number;
  onScrub: (pct: number) => void;
  onPreview?: (pct: number | null) => void;
  /** Full-screen player variant — taller strip, thicker bars. */
  tall?: boolean;
}) {
  const barCount = tall ? FULL_BAR_COUNT : MINI_BAR_COUNT;
  const seed = track.id;
  const fallback = useMemo(() => seededBars(seed, barCount), [seed, barCount]);
  // Peaks that rode down with the page payload win outright — no fetch,
  // no decode, right envelope on the first painted frame.
  const supplied = useMemo(
    () =>
      track.peaks && track.peaks.length > 0
        ? resampleWaveformHeights(track.peaks, barCount)
        : null,
    [track.peaks, barCount],
  );
  // Read the origin after mount so the server-rendered markup and the
  // first client render agree; the decode is an effect either way.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const decodeUrl = supplied ? null : sameOriginPeaksUrl(track.audioUrl, origin);
  const heights = useAudioPeaks(decodeUrl, barCount, supplied ?? fallback);
  const [pointerPreviewPct, setPointerPreviewPct] = useState<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const displayedProgressPct = pointerPreviewPct ?? progressPct;
  const playedBars = Math.floor((displayedProgressPct / 100) * heights.length);

  function percentAt(clientX: number, element: HTMLDivElement): number {
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return 0;
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  }

  function previewAt(clientX: number, element: HTMLDivElement): number {
    const pct = percentAt(clientX, element);
    setPointerPreviewPct(pct);
    onPreview?.(pct);
    return pct;
  }

  function stopPreview(): void {
    activePointerIdRef.current = null;
    setPointerPreviewPct(null);
    onPreview?.(null);
  }

  return (
    <div
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(displayedProgressPct)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onScrub(Math.max(0, displayedProgressPct - 5));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onScrub(Math.min(100, displayedProgressPct + 5));
        }
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activePointerIdRef.current = event.pointerId;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is best effort on older Safari versions.
        }
        previewAt(event.clientX, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        previewAt(event.clientX, event.currentTarget);
      }}
      onPointerUp={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const pct = previewAt(event.clientX, event.currentTarget);
        activePointerIdRef.current = null;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // The browser may already have released capture.
        }
        onScrub(pct);
        stopPreview();
      }}
      onPointerCancel={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        stopPreview();
      }}
      onLostPointerCapture={(event) => {
        if (event.target !== event.currentTarget) return;
        if (activePointerIdRef.current === event.pointerId) stopPreview();
      }}
      className={[
        "relative flex-1 cursor-pointer touch-none select-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-none",
        tall ? "h-12" : "h-11",
      ].join(" ")}
    >
      <div
        className={[
          "absolute flex items-center justify-between gap-[2px]",
          tall ? "inset-0" : "inset-x-0 top-1/2 h-6 -translate-y-1/2",
        ].join(" ")}
      >
        {heights.map((h, i) => (
          <span
            key={`mb-${String(i)}`}
            aria-hidden
            className={[
              "block rounded-full transition-colors",
              tall ? "w-[3px]" : "w-[2px]",
              i < playedBars ? "bg-white" : "bg-white/20",
            ].join(" ")}
            style={{ height: `${String(h * 100)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Time formatter ──────────────────────────────────────────────────

// Exported for unit tests so we can validate m:ss formatting without
// booting the full player (jsdom-free env).
export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

// ─── Icons (inline SVG — never depend on icon-font load) ─────────────

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

function SkipBackIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="11 13 5 8 11 3" fill="currentColor" stroke="none" />
      <line x1="3" y1="3" x2="3" y2="13" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="5 3 11 8 5 13" fill="currentColor" stroke="none" />
      <line x1="13" y1="3" x2="13" y2="13" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

/** Repeat. `single` adds the "1" that marks repeat-this-song. */
function LoopIcon({ single = false }: { single?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="17 2 21 6 17 10" />
      <path d="M3 12V10a4 4 0 0 1 4-4h14" />
      <polyline points="7 22 3 18 7 14" />
      <path d="M21 12v2a4 4 0 0 1-4 4H3" />
      {single ? (
        <text
          x="12"
          y="15.4"
          textAnchor="middle"
          fontSize="9"
          fontWeight="800"
          fill="currentColor"
          stroke="none"
        >
          1
        </text>
      ) : null}
    </svg>
  );
}

/**
 * Circular seek arrow with the step printed inside — the Apple Podcasts
 * / Spotify convention that makes "this nudges 10 seconds" unmistakable
 * next to the triangular song-skip arrows.
 */
function Seek10Icon({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg viewBox="0 0 24 24" width={19} height={19} aria-hidden>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        {...(direction === "forward" ? { transform: "translate(24,0) scale(-1,1)" } : {})}
      >
        <path d="M12 4.6a7.6 7.6 0 1 1-7.2 5.2" />
        <polygon points="12,1.9 12,7.3 8.4,4.6" fill="currentColor" stroke="none" />
      </g>
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fontSize="8.4"
        fontWeight="800"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 10V2" />
      <path d="m5 5 3-3 3 3" />
      <path d="M4 7.5h-.5A1.5 1.5 0 0 0 2 9v3.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5H12" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="9 3 13 3 13 7" />
      <polyline points="7 13 3 13 3 9" />
      <line x1="13" y1="3" x2="9" y2="7" />
      <line x1="3" y1="13" x2="7" y2="9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}
