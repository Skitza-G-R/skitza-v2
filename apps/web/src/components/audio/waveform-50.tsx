"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PLAYER_EVENTS, playerSeek, useNowPlaying } from "./persistent-player";

// ─── Pure helper (exported for unit tests) ───────────────────────────

/**
 * Pick the playhead source. When this waveform's seed is the version
 * currently in the dock and a finite live ms tick is available, use
 * the live time. Otherwise fall back to the locally-tracked internal
 * ms (click/drag/keyboard).
 *
 * Guards against the `<audio>.duration === Infinity` window during
 * HLS manifest load — non-finite live ms degrades cleanly.
 */
export function pickWaveformTime(input: {
  isLive: boolean;
  liveMs: number;
  internalMs: number;
}): number {
  if (
    input.isLive &&
    Number.isFinite(input.liveMs) &&
    input.liveMs >= 0
  ) {
    return input.liveMs;
  }
  return input.internalMs;
}

// 50-bar stylized waveform used on the L3 song page. This is NOT the
// real wavesurfer-driven waveform (that's `WaveformPlayer` and decodes
// the audio peaks). Instead, it's a deterministic visual pseudo-wave
// that:
//
//   • Renders 50 bars with seeded heights (stable across re-renders for
//     a given track).
//   • Shows played bars in `--brand-primary`, unplayed in `--border-subtle`.
//   • Renders a draggable amber playhead with a JetBrains Mono tooltip
//     showing the live current-time.
//   • Click-to-seek + drag-to-scrub.
//   • Renders comment markers (producer = amber, artist = muted).
//
// Why a fake wave instead of wavesurfer:
//   • The L3 page is a producer-first surface. Wiring decoded peaks
//     here would mean either (a) re-decoding audio on every nav, or
//     (b) plumbing a peaks-cache through R2. Both are out of scope
//     for the v3-clean slice.
//   • The deterministic seeded-bar waveform reads as a confident visual
//     anchor for the comments thread without claiming to be a real
//     spectrogram. The persistent player owns audio playback.
//   • If we later want true peaks, swap the SVG layer for WaveformPlayer
//     and keep this component's API. The composer + comments thread
//     don't care.
//
// This component is purely presentational — it doesn't load audio.
// `onProgress` is driven by the parent (typically subscribing to the
// PersistentPlayer's `skitza:player:time` event), and `onSeek` is the
// click-to-seek hook the parent wires to `playerSeek`.

const BAR_COUNT = 50;

export interface WaveformComment {
  id: string;
  /** Timestamp on the track, in milliseconds. */
  timeMs: number;
  /** Amber for producer, muted for artist. */
  fromProducer: boolean;
}

interface Waveform50Props {
  /** Total track duration in ms. Required for tooltip + marker placement. */
  durationMs: number;
  /** Optional comment markers. */
  comments?: WaveformComment[];
  /** Stable seed for deterministic bar heights — typically `version.id`. */
  seed?: string;
  /**
   * Optional starting playhead position in ms. The component owns its
   * playhead state internally so click-to-seek + drag both work without
   * round-tripping through a parent every frame.
   */
  initialMs?: number;
  /** Fires every time the playhead moves (click, drag, keyboard arrows). */
  onProgress?: (ms: number) => void;
  /** Fires once per click-to-seek action (terminates a drag, too). */
  onSeek?: (ms: number) => void;
  /** Visual height in px (default 96 — fits the L3 hero card). */
  height?: number;
  /** Optional className passthrough. */
  className?: string;
}

// Tiny mulberry32 PRNG so each version's bars are stable across renders.
// Same seed → same heights, no useState needed inside the bar map.
function seededHeights(seed: string, n: number): number[] {
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
    // Skew toward the middle of the range so the waveform doesn't have
    // jagged outliers — feels more like a real audio envelope.
    const skewed = 0.25 + r * 0.7 + Math.sin(i * 0.7) * 0.1;
    out.push(Math.max(0.18, Math.min(1, skewed)));
  }
  return out;
}

export function Waveform50({
  durationMs,
  comments,
  seed = "default",
  initialMs = 0,
  onProgress,
  onSeek,
  height = 96,
  className,
}: Waveform50Props) {
  const [internalMs, setInternalMs] = useState(initialMs);
  const [liveMs, setLiveMs] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onProgressRef = useRef(onProgress);
  const onSeekRef = useRef(onSeek);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  // Live mode — when this waveform's seed (== version-id) is the track
  // currently playing in the dock, the playhead follows the dock. Click
  // / drag / arrow-key seeks then dispatch playerSeek so the dock's
  // <audio> element jumps too. Producer's mental model: "the big bar
  // and the little bar are the same playback."
  const nowPlaying = useNowPlaying();
  const isLive = nowPlaying.trackId === seed;

  // Subscribe to the dock's time broadcast. We listen unconditionally
  // (cheap — single window event) and short-circuit pickWaveformTime
  // by `isLive` so non-active waveforms ignore ticks for other tracks.
  useEffect(() => {
    function onTime(e: Event) {
      const ms = (e as CustomEvent<number>).detail;
      if (Number.isFinite(ms)) setLiveMs(ms);
    }
    window.addEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    return () => {
      window.removeEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    };
  }, []);

  // Reset both timers when the seed (active version) changes — same
  // pattern as wavesurfer cleaning up between sources.
  useEffect(() => {
    setInternalMs(0);
    setLiveMs(0);
    onProgressRef.current?.(0);
  }, [seed]);

  const currentMs = pickWaveformTime({ isLive, liveMs, internalMs });

  const heights = useMemo(() => seededHeights(seed, BAR_COUNT), [seed]);
  const progressPct = durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;
  const playedBars = Math.floor((progressPct / 100) * BAR_COUNT);

  const seekFromClientX = useCallback(
    (clientX: number, fireSeek: boolean) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = rect.width > 0 ? x / rect.width : 0;
      const ms = Math.round(pct * durationMs);
      // Live mode: seek the dock so the dock's <audio> element jumps
      // — broadcast comes back over PLAYER_EVENTS.time and updates
      // liveMs. Static mode: keep an internal pointer (no audio engine
      // attached, so we drive the bar visually only).
      if (isLive) {
        playerSeek(ms);
        setLiveMs(ms);
      } else {
        setInternalMs(ms);
      }
      onProgressRef.current?.(ms);
      if (fireSeek) onSeekRef.current?.(ms);
    },
    [durationMs, isLive],
  );

  // Drag state — flip on pointerdown, off on pointerup. Pointer move
  // handlers attach to window so a drag continues if the cursor leaves
  // the bar box. Same pattern as a slider knob.
  const draggingRef = useRef(false);
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX, false);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    seekFromClientX(e.clientX, false);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    seekFromClientX(e.clientX, true);
  }

  // Keyboard support — arrow keys nudge the playhead by 5%. Mirrors
  // seekFromClientX's branch: live mode dispatches to the dock,
  // static mode mutates the internal timer.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = durationMs * 0.05 * (e.key === "ArrowLeft" ? -1 : 1);
      const next = Math.max(0, Math.min(durationMs, currentMs + step));
      if (isLive) {
        playerSeek(next);
        setLiveMs(next);
      } else {
        setInternalMs(next);
      }
      onProgressRef.current?.(next);
      onSeekRef.current?.(next);
    }
  }

  return (
    <div className={["w-full", className ?? ""].join(" ")}>
      <div
        ref={containerRef}
        role="slider"
        aria-label="Track playhead"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={currentMs}
        aria-valuetext={fmt(currentMs)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative w-full cursor-pointer touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]"
        style={{ height }}
      >
        {/* Bars layer */}
        <div className="absolute inset-x-0 bottom-0 top-0 flex items-center justify-between gap-[2px]">
          {heights.map((h, i) => {
            const isPlayed = i < playedBars;
            return (
              <span
                key={`b-${String(i)}`}
                aria-hidden
                className={[
                  "block flex-1 rounded-full transition-colors",
                  isPlayed
                    ? "bg-[rgb(var(--brand-primary))]"
                    : "bg-[rgb(var(--border-subtle))]",
                ].join(" ")}
                style={{ height: `${String(h * 100)}%` }}
              />
            );
          })}
        </div>

        {/* Playhead — amber line + JetBrains Mono tooltip */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-[rgb(var(--brand-primary))]"
          style={{ left: `${progressPct.toFixed(2)}%` }}
        >
          <span
            className="absolute -top-7 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[rgb(var(--bg-default,var(--bg-elevated)))] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[rgb(var(--brand-primary-dark))] tabular-nums shadow-[var(--shadow-sm)] ring-1 ring-[rgb(var(--brand-primary)/0.4)]"
            style={{ left: 0 }}
          >
            {fmt(currentMs)}
          </span>
          <span
            aria-hidden
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-[rgb(var(--brand-primary))] ring-2 ring-[rgb(var(--bg-elevated))]"
          />
        </div>

        {/* Comment markers — pinned above the bars */}
        {comments && comments.length > 0 && durationMs > 0 ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-1 h-1.5">
            {comments.map((c) => {
              const pct = (c.timeMs / durationMs) * 100;
              if (pct < 0 || pct > 100) return null;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isLive) {
                      playerSeek(c.timeMs);
                      setLiveMs(c.timeMs);
                    } else {
                      setInternalMs(c.timeMs);
                    }
                    onProgressRef.current?.(c.timeMs);
                    onSeekRef.current?.(c.timeMs);
                  }}
                  aria-label={`Jump to ${fmt(c.timeMs)}`}
                  className={[
                    "sk-press pointer-events-auto absolute -translate-x-1/2 rounded-full",
                    "h-1.5 w-1.5",
                    c.fromProducer
                      ? "bg-[rgb(var(--brand-primary))]"
                      : "bg-[rgb(var(--fg-muted))]",
                  ].join(" ")}
                  style={{ left: `${pct.toFixed(2)}%` }}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Time labels */}
      <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[rgb(var(--fg-muted))]">
        <span>{fmt(currentMs)}</span>
        <span>{fmt(durationMs)}</span>
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}
