"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { producerGradient } from "~/lib/_phase4-stubs/producer-color";

// Public read-only state for "what's currently playing" — populated by
// PersistentPlayer on every set / toggle / ended / close event so any
// list can flag the active row (e.g. EqBars on the playing track).
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

// PersistentPlayer — the dark rounded floating dock. Mounted once in
// the dashboard layout (apps/web/src/components/shell/app-shell.tsx)
// so it survives client-side navigation between sibling routes.
//
// Communication with the rest of the app happens over a tiny custom-
// event bus on `window`, five events total:
//
//   skitza:player:set    CustomEvent<PlayerTrack>  — load + play a track
//   skitza:player:toggle CustomEvent<void>          — pause / resume
//   skitza:player:seek   CustomEvent<number>        — jump to ms offset
//   skitza:player:close  CustomEvent<void>          — unload + hide dock
//   skitza:player:time   CustomEvent<number>        — BROADCAST: current ms
//
// The first four are inputs; the fifth is an output (side-panel
// waveforms subscribe to keep their playhead aligned with the dock).

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
const EVT_CLOSE = "skitza:player:close";
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

export function playerClose(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_CLOSE));
}

// Event name exports so listeners stay in sync with dispatchers.
export const PLAYER_EVENTS = {
  set: EVT_SET,
  toggle: EVT_TOGGLE,
  seek: EVT_SEEK,
  close: EVT_CLOSE,
  time: EVT_TIME,
} as const;

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
  if (
    dbDurationMs !== null &&
    Number.isFinite(dbDurationMs) &&
    dbDurationMs > 0
  ) {
    return dbDurationMs;
  }
  if (
    audioDurationSec !== null &&
    Number.isFinite(audioDurationSec) &&
    audioDurationSec > 0
  ) {
    return Math.round(audioDurationSec * 1000);
  }
  return null;
}

/**
 * URL the dock's expand button sends the producer to. Always points
 * at the L3 song page for the currently-playing track-version.
 */
export function expandHrefForTrack(track: PlayerTrack): string {
  return `/dashboard/music/${track.id}`;
}

// ─── Component ───────────────────────────────────────────────────────

export function PersistentPlayer() {
  const [state, setState] = useState<PlayerState>({ track: null, playing: false });
  const [currentMs, setCurrentMs] = useState(0);
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Wire incoming events once per mount. Downstream dispatchers fire
  // these from anywhere — library rows, side panels, mobile modals.
  useEffect(() => {
    function onSet(e: Event) {
      const track = (e as CustomEvent<PlayerTrack>).detail;
      setState({ track, playing: true });
      setCurrentMs(0);
      setAudioDurationSec(null); // reset; <audio> onLoadedMetadata refills
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
    function onClose() {
      setState({ track: null, playing: false });
      setCurrentMs(0);
      setAudioDurationSec(null);
      setNowPlayingState({ trackId: null, playing: false });
    }
    window.addEventListener(EVT_SET, onSet as EventListener);
    window.addEventListener(EVT_TOGGLE, onToggle as EventListener);
    window.addEventListener(EVT_SEEK, onSeek as EventListener);
    window.addEventListener(EVT_CLOSE, onClose as EventListener);
    return () => {
      window.removeEventListener(EVT_SET, onSet as EventListener);
      window.removeEventListener(EVT_TOGGLE, onToggle as EventListener);
      window.removeEventListener(EVT_SEEK, onSeek as EventListener);
      window.removeEventListener(EVT_CLOSE, onClose as EventListener);
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
  // the single source of truth (this element). Also captures
  // loadedmetadata so we can fall back to <audio>.duration when the
  // database row didn't carry a recorded duration.
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
    const onLoadedMetadata = () => {
      // `audio.duration` is in seconds; HLS reports Infinity briefly.
      // pickDurationMs() guards against non-finite values, so we just
      // pass it through.
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

  const dbDurationMs = state.track.durationMs;
  const effectiveDurationMs = pickDurationMs(dbDurationMs, audioDurationSec);
  const progressPct =
    effectiveDurationMs && effectiveDurationMs > 0
      ? Math.min(100, Math.max(0, (currentMs / effectiveDurationMs) * 100))
      : 0;

  function onScrub(pct: number) {
    if (!effectiveDurationMs) return;
    const ms = Math.floor((pct / 100) * effectiveDurationMs);
    const el = audioRef.current;
    if (el) el.currentTime = ms / 1000;
    setCurrentMs(ms);
  }

  function onSkip(deltaPct: number) {
    onScrub(Math.min(100, Math.max(0, progressPct + deltaPct)));
  }

  function onTogglePlay() {
    setState((s) => {
      const next = { ...s, playing: !s.playing };
      setNowPlayingState({
        trackId: next.track?.id ?? null,
        playing: next.playing,
      });
      return next;
    });
  }

  return (
    <>
      {/* Desktop dock — md+ */}
      <DesktopDock
        track={state.track}
        playing={state.playing}
        currentMs={currentMs}
        durationMs={effectiveDurationMs}
        progressPct={progressPct}
        onTogglePlay={onTogglePlay}
        onScrub={onScrub}
        onSkip={onSkip}
      />
      {/* Mobile dock — <md, sits above the bottom nav */}
      <MobileDock
        track={state.track}
        playing={state.playing}
        onTogglePlay={onTogglePlay}
      />
      {/* Hidden audio element — sr-only keeps assistive tech from
          picking it up as a second player (the visible controls above
          already announce play/pause state). */}
      <audio
        ref={audioRef}
        src={state.track.audioUrl ?? undefined}
        preload="auto"
        className="sr-only"
      />
    </>
  );
}

// ─── Desktop dock ────────────────────────────────────────────────────

function DesktopDock({
  track,
  playing,
  currentMs,
  durationMs,
  progressPct,
  onTogglePlay,
  onScrub,
  onSkip,
}: {
  track: PlayerTrack;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  progressPct: number;
  onTogglePlay: () => void;
  onScrub: (pct: number) => void;
  onSkip: (deltaPct: number) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Audio player"
      // Floats with margin from the sidebar (lg+) and from the right
      // edge — feels like a tactile dock, not a full-width bar. The
      // .persistent-player-dock class in globals.css contributes the
      // `bottom: <safe-area-inset>` offset; we layer the desktop
      // margins on top here.
      className="persistent-player-dock fixed inset-x-0 z-40 hidden md:flex md:justify-center md:px-6 lg:ps-[calc(var(--sidebar-width,260px)+24px)] lg:pe-6"
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
            spacers. */}
        <div className="flex min-w-0 items-center gap-3">
          <Cover track={track} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold tracking-[-0.01em]">
              {track.title}
            </p>
            <p className="truncate text-[11px] font-semibold text-[rgb(var(--brand-primary))]">
              {track.subtitle}
            </p>
          </div>
        </div>

        {/* CENTER — transport. Sits in the auto-width middle grid
            track. The inner stack carries `min-w-[360px]` so the
            auto column expands to give the time + waveform row room
            to render — without it the waveform collapses (regression
            the founder flagged: "no waveform bar on the floating
            player"). */}
        <div className="hidden min-w-[360px] flex-col items-center gap-1.5 lg:flex">
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              aria-label="Skip back 5%"
              onClick={() => {
                onSkip(-5);
              }}
              className="sk-press text-white/55 hover:text-white"
            >
              <SkipBackIcon />
            </button>
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={onTogglePlay}
              className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)] shadow-[0_2px_14px_rgba(255,255,255,0.18)]"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              aria-label="Skip forward 5%"
              onClick={() => {
                onSkip(5);
              }}
              className="sk-press text-white/55 hover:text-white"
            >
              <SkipForwardIcon />
            </button>
          </div>
          <div className="flex w-full items-center gap-2.5 font-mono text-[10px] text-white/40">
            <span className="w-8 text-right tabular-nums">{fmtTime(currentMs)}</span>
            <MiniWaveform seed={track.id} progressPct={progressPct} onScrub={onScrub} />
            <span className="w-8 tabular-nums">{durationMs == null ? "—" : fmtTime(durationMs)}</span>
          </div>
        </div>

        {/* Compact play (md → lg) — when the center transport is
            hidden, this sits in the auto-width center grid track. */}
        <div className="flex items-center justify-center lg:hidden">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
            className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)] shadow-[0_2px_14px_rgba(255,255,255,0.18)]"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>

        {/* RIGHT — expand + close. Right-aligned within the third
            1fr column (justify-self-end + justify-end). The opposite
            1fr column on the left mirrors this so the center auto
            column stays at true geometric center. */}
        <div className="flex items-center justify-end gap-1 justify-self-end border-s border-white/10 ps-3">
          <Link
            href={expandHrefForTrack(track)}
            aria-label="Open song page"
            title="Open song page"
            className="sk-press inline-flex h-8 w-8 items-center justify-center rounded-md text-white/55 hover:text-white"
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
            className="sk-press inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.06] text-white/70 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mobile dock ─────────────────────────────────────────────────────

function MobileDock({
  track,
  playing,
  onTogglePlay,
}: {
  track: PlayerTrack;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Audio player"
      // Sits above the producer bottom nav (~62px tall) on <md.
      // .persistent-player-dock from globals.css already handles the
      // bottom-nav + safe-area offset; here we just ensure the dock
      // takes the dark pill aesthetic and only renders <md.
      className="persistent-player-dock fixed inset-x-2 z-40 flex md:hidden"
    >
      <div
        className="flex w-full items-center gap-2.5 rounded-xl border px-2 py-2 shadow-[0_-4px_24px_rgba(0,0,0,0.4)]"
        style={{
          background: "#1A1A1A",
          borderColor: "rgba(255,255,255,0.08)",
          color: "#fff",
        }}
      >
        <Cover track={track} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold tracking-[-0.01em]">
            {track.title}
          </p>
          <p className="truncate text-[11px] font-semibold text-[rgb(var(--brand-primary))]">
            {track.subtitle}
          </p>
        </div>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={onTogglePlay}
          className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)]"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <Link
          href={expandHrefForTrack(track)}
          aria-label="Open song page"
          title="Open song page"
          className="sk-press inline-flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:text-white"
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
          className="sk-press inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.06] text-white/70 hover:text-white"
        >
          <CloseIcon />
        </button>
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
// Replaces the flat ScrubBar with a row of seeded bars matching the
// L3 hero waveform aesthetic — same "this is a music app" visual
// language. Played bars render solid white, unplayed bars sit at
// 12% white. Click anywhere on the strip to seek (the founder still
// expects scrubbing to work from the dock).

const MINI_BAR_COUNT = 32;

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

function MiniWaveform({
  seed,
  progressPct,
  onScrub,
}: {
  seed: string;
  progressPct: number;
  onScrub: (pct: number) => void;
}) {
  const heights = seededBars(seed, MINI_BAR_COUNT);
  const playedBars = Math.floor((progressPct / 100) * MINI_BAR_COUNT);
  return (
    <div
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progressPct)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onScrub(Math.max(0, progressPct - 5));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onScrub(Math.min(100, progressPct + 5));
        }
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const pct = ((e.clientX - r.left) / r.width) * 100;
        onScrub(pct);
      }}
      className="relative h-6 flex-1 cursor-pointer touch-none select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
    >
      <div className="absolute inset-0 flex items-center justify-between gap-[2px]">
        {heights.map((h, i) => (
          <span
            key={`mb-${String(i)}`}
            aria-hidden
            className={[
              "block w-[2px] rounded-full transition-colors",
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
    <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 13 5 8 11 3" fill="currentColor" stroke="none" />
      <line x1="3" y1="3" x2="3" y2="13" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="5 3 11 8 5 13" fill="currentColor" stroke="none" />
      <line x1="13" y1="3" x2="13" y2="13" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 3 13 3 13 7" />
      <polyline points="7 13 3 13 3 9" />
      <line x1="13" y1="3" x2="9" y2="7" />
      <line x1="3" y1="13" x2="7" y2="9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}
