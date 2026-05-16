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

// DAW-style waveform for the producer L3 song page.
//
//   • 220 thin bars at 1px gap — reads as a real audio envelope
//     (Samply / SoundCloud density).
//   • Sharp 1px-radius rectangles (not rounded pills) so the silhouette
//     resolves as a continuous shape rather than discrete dots.
//   • Seeded envelope with sine harmonics + grain, biased toward
//     song-shaped peaks (quieter intro, louder body, soft tail).
//   • Played bars in `--brand-primary`, unplayed in `white/18` (tuned
//     for the dark waveform-card surface).
//   • Premium playhead: glowing amber dot + amber vertical line +
//     dark glass time pill.
//   • Hover-scrub ghost: dim white line + dark glass time tooltip.
//   • Click-to-seek + drag-to-scrub + keyboard arrows.
//   • Comment markers above the wave as 10-14px amber/gray ticks.
//
// The persistent player owns audio playback; this component is purely
// presentational. `onProgress` is driven by the parent subscribing to
// PersistentPlayer's `skitza:player:time` event; `onSeek` is the
// click-to-seek hook the parent wires to `playerSeek`.

const BAR_COUNT = 220;

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
  /** Visual height in px (default 140 — fits the L3 hero card). */
  height?: number;
  /** Optional className passthrough. */
  className?: string;
}

// Mulberry32 PRNG so each version's bars are stable across renders.
// Heights are sculpted by sine harmonics on top of the random floor —
// produces a song-shaped silhouette (soft intro → loud body → quieter
// tail) instead of a uniform noise carpet.
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

    const x = i / n;
    // Song-shape envelope: low intro, mid-section climax, soft outro.
    const macro = Math.sin(x * Math.PI) * 0.55;
    // Sub-envelope for verse / chorus blocks.
    const phrase = Math.sin(x * Math.PI * 4) * 0.18;
    // Bar-level texture — uneven peaks within a phrase.
    const detail = Math.sin(i * 0.41) * 0.12 + Math.sin(i * 1.17) * 0.08;
    // Random grain — keeps adjacent bars from being identical.
    const grain = (r - 0.5) * 0.42;

    const v = 0.18 + macro + phrase + detail + grain;
    out.push(Math.max(0.05, Math.min(1, v)));
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
  height = 140,
  className,
}: Waveform50Props) {
  const [internalMs, setInternalMs] = useState(initialMs);
  const [liveMs, setLiveMs] = useState(0);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
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
  const isPlaying = isLive && nowPlaying.playing;

  // Subscribe to the dock's time broadcast.
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

  // Reset both timers when the seed (active version) changes.
  useEffect(() => {
    setInternalMs(0);
    setLiveMs(0);
    onProgressRef.current?.(0);
  }, [seed]);

  const currentMs = pickWaveformTime({ isLive, liveMs, internalMs });

  const heights = useMemo(() => seededHeights(seed, BAR_COUNT), [seed]);
  const progressPct = durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;
  const playedBars = Math.floor((progressPct / 100) * BAR_COUNT);

  const pctFromClientX = useCallback((clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return rect.width > 0 ? (x / rect.width) * 100 : 0;
  }, []);

  const seekFromClientX = useCallback(
    (clientX: number, fireSeek: boolean) => {
      const pct = pctFromClientX(clientX);
      const ms = Math.round((pct / 100) * durationMs);
      if (isLive) {
        playerSeek(ms);
        setLiveMs(ms);
      } else {
        setInternalMs(ms);
      }
      onProgressRef.current?.(ms);
      if (fireSeek) onSeekRef.current?.(ms);
    },
    [durationMs, isLive, pctFromClientX],
  );

  const draggingRef = useRef(false);
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX, false);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (draggingRef.current) {
      seekFromClientX(e.clientX, false);
      return;
    }
    setHoverPct(pctFromClientX(e.clientX));
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    seekFromClientX(e.clientX, true);
  }
  function onPointerLeave() {
    setHoverPct(null);
  }

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

  const hoverMs = hoverPct !== null ? Math.round((hoverPct / 100) * durationMs) : 0;

  return (
    <div className={["w-full", className ?? ""].join(" ")}>
      {/* Top rail — comment markers ABOVE the bar surface so they don't
          crowd the audio envelope. */}
      {comments && comments.length > 0 && durationMs > 0 ? (
        <div aria-hidden className="relative mb-2 h-3.5">
          {comments.map((c) => {
            const pct = (c.timeMs / durationMs) * 100;
            if (pct < 0 || pct > 100) return null;
            const isHovered = hoveredCommentId === c.id;
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
                onMouseEnter={() => {
                  setHoveredCommentId(c.id);
                }}
                onMouseLeave={() => {
                  setHoveredCommentId((p) => (p === c.id ? null : p));
                }}
                aria-label={`Jump to ${fmt(c.timeMs)}`}
                className={[
                  "sk-press pointer-events-auto absolute bottom-0 -translate-x-1/2",
                  "transition-[height,width,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  isHovered ? "h-3.5 w-[3px] opacity-100" : "h-2.5 w-[2px] opacity-90",
                  c.fromProducer
                    ? "bg-[rgb(var(--brand-primary))]"
                    : "bg-white/55",
                ].join(" ")}
                style={{
                  left: `${pct.toFixed(2)}%`,
                  boxShadow: c.fromProducer
                    ? `0 0 ${isHovered ? "8px" : "5px"} rgb(var(--brand-primary) / ${isHovered ? "0.7" : "0.45"})`
                    : "none",
                }}
              />
            );
          })}
        </div>
      ) : null}

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
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        className="group relative w-full cursor-pointer touch-none select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:rounded-[4px]"
        style={{ height }}
      >
        {/* Center baseline — barely-visible reference line that anchors
            the eye like a DAW spectrogram's zero axis. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-px bg-white/[0.04]"
        />

        {/* Bars layer — 220 thin sharp bars at 1px gap. The flex layout
            distributes them edge-to-edge so the wave reads as a
            continuous envelope, not a row of dots. */}
        <div className="absolute inset-0 flex items-center justify-between gap-px">
          {heights.map((h, i) => {
            const isPlayed = i < playedBars;
            // Hovered bars (not yet played) get a ghost amber tint.
            const hoverBar = hoverPct !== null ? Math.floor((hoverPct / 100) * BAR_COUNT) : -1;
            const isUnderHover = hoverBar >= 0 && i >= playedBars && i <= hoverBar;
            return (
              <span
                key={`b-${String(i)}`}
                aria-hidden
                className={[
                  "block flex-1 rounded-[1px]",
                  "transition-[background-color] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                  isPlayed
                    ? "bg-[rgb(var(--brand-primary))]"
                    : isUnderHover
                      ? "bg-[rgb(var(--brand-primary)/0.42)]"
                      : "bg-white/[0.18]",
                ].join(" ")}
                style={{
                  height: `${String(Math.max(4, h * 100))}%`,
                  minHeight: "2px",
                }}
              />
            );
          })}
        </div>

        {/* Hover scrub ghost — dim white line + glass tooltip. */}
        {hoverPct !== null && Math.abs(hoverPct - progressPct) > 0.5 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 z-10"
            style={{ left: `${hoverPct.toFixed(2)}%` }}
          >
            <div className="absolute inset-y-1 left-0 w-px bg-white/35" />
            <span className="absolute -bottom-7 left-0 -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-black/70 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-white/85 ring-1 ring-white/10 backdrop-blur-md">
              {fmt(hoverMs)}
            </span>
          </div>
        ) : null}

        {/* Playhead — thin amber line + glowing dot + glass time pill. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 z-20"
          style={{ left: `${progressPct.toFixed(2)}%` }}
        >
          {/* Vertical line — strong amber, full height. */}
          <div
            className="absolute inset-y-0 left-0 w-px bg-[rgb(var(--brand-primary))]"
            style={{
              boxShadow: "0 0 8px rgb(var(--brand-primary) / 0.6)",
            }}
          />
          {/* Glow dot — wrapped so the breathing ring lives on the parent
              while the dot keeps its static halo. */}
          <div className="absolute top-1/2 left-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full">
            {isPlaying ? (
              <span
                aria-hidden
                className="skitza-playing-glow absolute inset-0 rounded-full"
              />
            ) : null}
            <div
              className="relative h-full w-full rounded-full bg-[rgb(var(--brand-primary))]"
              style={{
                boxShadow:
                  "0 0 0 2px rgb(28 26 20), 0 0 14px 2px rgb(var(--brand-primary) / 0.55)",
              }}
            />
          </div>
          {/* Time pill — dark glass for the dark surface, amber text. */}
          <span
            className="absolute -top-8 left-0 -translate-x-1/2 whitespace-nowrap rounded-[6px] px-1.5 py-0.5 font-mono text-[10.5px] font-bold tabular-nums backdrop-blur-md"
            style={{
              background: "rgb(28 26 20 / 0.92)",
              color: "rgb(var(--brand-primary))",
              boxShadow:
                "0 0 0 1px rgb(var(--brand-primary) / 0.45), 0 4px 12px -2px rgba(0,0,0,0.5)",
            }}
          >
            {fmt(currentMs)}
          </span>
        </div>
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
