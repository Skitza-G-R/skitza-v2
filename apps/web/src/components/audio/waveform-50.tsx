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

// Premium 80-bar stylized waveform used on the L3 song page.
//
//   • 80 bars with seeded heights (envelope-like, stable across renders).
//   • Played bars in `--brand-primary`, unplayed in `--fg-muted/18`.
//   • Bars near the playhead get a soft amber halo (perceived liveness).
//   • Premium playhead: glowing dot + vertical gradient line + glass pill.
//   • Hover-scrub ghost: faint ghost playhead + time tooltip follow cursor.
//   • Click-to-seek + drag-to-scrub + keyboard arrows.
//   • Comment markers render as tall thin amber ticks above the wave.
//
// The persistent player owns audio playback; this component is purely
// presentational. `onProgress` is driven by the parent subscribing to
// PersistentPlayer's `skitza:player:time` event; `onSeek` is the
// click-to-seek hook the parent wires to `playerSeek`.

const BAR_COUNT = 80;
const GLOW_RANGE = 6;

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
   * Optional same-origin URL to fetch + decode for REAL audio peaks.
   * When provided, we fetch the bytes via `fetch()`, decode them via
   * Web Audio's `decodeAudioData`, reduce to N RMS-block peaks, and
   * replace the seeded heights with real envelope data. Until the
   * decode resolves we render the seeded fallback so there's never a
   * loading-empty state. Cached per-URL across remounts.
   *
   * Should be the same-origin /api/download/<id> route, NOT the raw
   * R2 URL — R2 doesn't honour CORS for our preview origins.
   */
  // `| undefined` is explicit so the prop can be passed as
  // `peaksUrl={maybeUrl}` under exactOptionalPropertyTypes.
  peaksUrl?: string | undefined;
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
  /** Visual height in px (default 112 — fits the L3 hero card). */
  height?: number;
  /** Optional className passthrough. */
  className?: string;
}

// ─── Real-peak decoding ──────────────────────────────────────────────

// Module-level cache. Same URL → same peaks, so we only decode each
// audio file once per session. Cleared on full page reload.
const peaksCache = new Map<string, number[]>();

// Lazy singleton AudioContext — created on first decode so SSR doesn't
// trip on `new AudioContext()`. We never play through it, just decode.
let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_audioCtx) return _audioCtx;
  // lib.dom.d.ts types `window.AudioContext` as non-nullable, but it
  // genuinely is undefined in some legacy / Safari preview contexts —
  // cast through `unknown` so ESLint's `no-unnecessary-condition`
  // doesn't trip on the runtime fallback.
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  _audioCtx = new Ctor();
  return _audioCtx;
}

/**
 * Reduce a Float32 PCM array to N normalized RMS peaks (0..1).
 * Exported for unit testing the math without booting Web Audio.
 */
export function rmsPeaks(data: Float32Array, barCount: number): number[] {
  if (data.length === 0 || barCount <= 0) return [];
  const blockSize = Math.max(1, Math.floor(data.length / barCount));
  const out: number[] = [];
  for (let i = 0; i < barCount; i += 1) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, data.length);
    let sumSq = 0;
    for (let j = start; j < end; j += 1) {
      const v = data[j] ?? 0;
      sumSq += v * v;
    }
    out.push(Math.sqrt(sumSq / Math.max(1, end - start)));
  }
  const max = Math.max(...out, 1e-9);
  // Normalize 0..1 and floor at 0.06 so silent sections still render
  // as a sliver — matches the seeded envelope's visual rhythm.
  return out.map((p) => Math.max(0.06, Math.min(1, p / max)));
}

/**
 * Fetch + decode `url` into N peaks. Falls back to `fallback` until
 * resolved, and silently keeps the fallback if decode fails.
 */
function useAudioPeaks(
  url: string | null | undefined,
  barCount: number,
  fallback: number[],
): number[] {
  const [peaks, setPeaks] = useState<number[]>(() => {
    if (url && peaksCache.has(url)) return peaksCache.get(url) ?? fallback;
    return fallback;
  });

  // Keep peaks in sync with seed changes when no URL is provided.
  // (When URL changes, the effect below overrides this with the cache
  // hit or the decode result.)
  useEffect(() => {
    if (!url) {
      setPeaks(fallback);
    }
    // fallback is recomputed per seed by the parent useMemo; safe to
    // depend on its identity.
  }, [url, fallback]);

  useEffect(() => {
    if (!url) return;
    const cached = peaksCache.get(url);
    if (cached) {
      setPeaks(cached);
      return;
    }
    // Object-wrapped flag so ESLint's no-unnecessary-condition can't
    // statically conclude `cancelled` never flips — the cleanup
    // function below mutates `flag.cancelled` after the closure
    // captures it.
    const flag = { cancelled: false };
    void (async () => {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        // decodeAudioData mutates the buffer in some browsers (Safari);
        // give it a fresh copy in case we want to reuse the bytes.
        const audio = await ctx.decodeAudioData(buf.slice(0));
        if (flag.cancelled) return;
        const computed = rmsPeaks(audio.getChannelData(0), barCount);
        peaksCache.set(url, computed);
        setPeaks(computed);
      } catch {
        // Network / codec / CORS failure — silently keep the seeded
        // fallback. The waveform still works as a click-to-seek
        // surface, just without a real envelope.
      }
    })();
    return () => {
      flag.cancelled = true;
    };
  }, [url, barCount]);

  return peaks;
}

// Tiny mulberry32 PRNG so each version's bars are stable across renders.
// Heights skew toward the middle with sine harmonics so the silhouette
// reads as an envelope, not a barcode.
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
    // Two-harmonic envelope: long-wave swell (entry+climax+outro) plus a
    // fast jitter for grain. Result reads as a real audio envelope.
    const swell = Math.sin((i / n) * Math.PI) * 0.45;
    const jitter = Math.sin(i * 0.81) * 0.08 + r * 0.42;
    const v = 0.22 + swell + jitter;
    out.push(Math.max(0.16, Math.min(1, v)));
  }
  return out;
}

export function Waveform50({
  durationMs,
  comments,
  seed = "default",
  peaksUrl,
  initialMs = 0,
  onProgress,
  onSeek,
  height = 112,
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

  // Seeded heights serve as the loading fallback so the bar layer
  // is never empty. When `peaksUrl` resolves, real RMS peaks replace
  // them and the CSS height transition morphs the silhouette into the
  // real audio envelope.
  const seededFallback = useMemo(() => seededHeights(seed, BAR_COUNT), [seed]);
  const heights = useAudioPeaks(peaksUrl, BAR_COUNT, seededFallback);
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
    [durationMs, isLive, pctFromClientX],
  );

  // Drag state — flip on pointerdown, off on pointerup. Pointer move
  // handlers attach to the container with pointer capture so a drag
  // continues if the cursor leaves the bar box.
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

  const hoverMs = hoverPct !== null ? Math.round((hoverPct / 100) * durationMs) : 0;

  return (
    <div className={["w-full", className ?? ""].join(" ")}>
      {/* Top rail — holds comment markers ABOVE the bar surface so they
          don't crowd the audio envelope. Height matches the marker hit
          target so hover popovers anchor cleanly. */}
      {comments && comments.length > 0 && durationMs > 0 ? (
        <div aria-hidden className="relative mb-1.5 h-4">
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
                  "sk-press pointer-events-auto absolute bottom-0 -translate-x-1/2 rounded-full",
                  "transition-[height,width,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  isHovered ? "h-4 w-[3px] opacity-100" : "h-3 w-[2px] opacity-90",
                  c.fromProducer
                    ? "bg-[rgb(var(--brand-primary))]"
                    : "bg-[rgb(var(--fg-muted))]",
                ].join(" ")}
                style={{
                  left: `${pct.toFixed(2)}%`,
                  boxShadow: c.fromProducer
                    ? `0 0 ${isHovered ? "10px" : "6px"} rgb(var(--brand-primary) / ${isHovered ? "0.55" : "0.35"})`
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
        className="group relative w-full cursor-pointer touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-4 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:rounded-[8px]"
        style={{ height }}
      >
        {/* Bars layer */}
        <div className="absolute inset-0 flex items-center justify-between gap-[2.5px]">
          {heights.map((h, i) => {
            const isPlayed = i < playedBars;
            const distFromPlayhead = playedBars - i;
            // Bars within GLOW_RANGE of the playhead get a soft amber halo;
            // intensity decays linearly out, so the cluster reads as "lit"
            // rather than uniformly painted. Spotify uses the same trick.
            const glowStrength =
              isPlayed && distFromPlayhead > 0 && distFromPlayhead <= GLOW_RANGE
                ? (GLOW_RANGE - distFromPlayhead + 1) / GLOW_RANGE
                : 0;
            // Hovered bars (not yet played) get a subtle ghost amber to
            // preview the seek target — visible only while scrubbing.
            const hoverBar = hoverPct !== null ? Math.floor((hoverPct / 100) * BAR_COUNT) : -1;
            const isUnderHover = hoverBar >= 0 && i >= playedBars && i <= hoverBar;
            return (
              <span
                key={`b-${String(i)}`}
                aria-hidden
                className={[
                  "block flex-1 rounded-full",
                  "transition-[background-color,box-shadow,opacity,height] duration-[280ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                  isPlayed
                    ? "bg-[rgb(var(--brand-primary))]"
                    : isUnderHover
                      ? "bg-[rgb(var(--brand-primary)/0.4)]"
                      : "bg-[rgb(var(--fg-muted)/0.22)]",
                ].join(" ")}
                style={{
                  height: `${String(Math.max(8, h * 100))}%`,
                  minHeight: "4px",
                  boxShadow:
                    glowStrength > 0
                      ? `0 0 ${String(glowStrength * 14)}px rgb(var(--brand-primary) / ${String(glowStrength * 0.55)})`
                      : "none",
                }}
              />
            );
          })}
        </div>

        {/* Hover scrub ghost — only visible while pointer is over and we
            aren't already at the same position as the live playhead. */}
        {hoverPct !== null && Math.abs(hoverPct - progressPct) > 0.5 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 z-10"
            style={{ left: `${hoverPct.toFixed(2)}%` }}
          >
            <div className="absolute inset-y-2 left-0 w-px bg-[rgb(var(--fg-default)/0.35)]" />
            <span className="absolute -bottom-7 left-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-[rgb(var(--bg-elevated)/0.92)] px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-[rgb(var(--fg-muted))] shadow-[var(--shadow-sm)] ring-1 ring-[rgb(var(--border-subtle))] backdrop-blur-md">
              {fmt(hoverMs)}
            </span>
          </div>
        ) : null}

        {/* Playhead — gradient line + glowing dot + glass time pill */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 z-20"
          style={{ left: `${progressPct.toFixed(2)}%` }}
        >
          {/* Vertical line — soft top, solid amber bottom */}
          <div
            className="absolute inset-y-1 left-0 w-px"
            style={{
              background:
                "linear-gradient(to bottom, rgb(var(--brand-primary) / 0) 0%, rgb(var(--brand-primary) / 0.6) 30%, rgb(var(--brand-primary)) 100%)",
            }}
          />
          {/* Glow dot — wrapped so the breathing ring lives on the parent
              while the dot keeps its static halo + inner highlight. */}
          <div className="absolute top-1/2 left-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full">
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
                  "0 0 0 3px rgb(var(--bg-elevated)), 0 0 22px 4px rgb(var(--brand-primary) / 0.5), 0 0 4px 1px rgb(var(--brand-primary))",
              }}
            />
          </div>
          {/* Time pill — glass with backdrop-blur + stronger amber ring.
              Bumped from 11px → 12px so it's readable at a glance even
              while scrubbing on smaller laptops. */}
          <span
            className="absolute -top-10 left-0 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[12px] font-bold tabular-nums backdrop-blur-md"
            style={{
              background: "rgb(var(--bg-elevated) / 0.95)",
              color: "rgb(var(--fg-default))",
              boxShadow:
                "0 0 0 1.5px rgb(var(--brand-primary) / 0.45), 0 10px 32px -10px rgb(var(--brand-primary) / 0.55), 0 2px 8px -2px rgba(0,0,0,0.12)",
            }}
          >
            {fmt(currentMs)}
          </span>
        </div>
      </div>

      {/* Time labels — bottom rail */}
      <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] tabular-nums">
        <span className="text-[rgb(var(--fg-muted))]">{fmt(currentMs)}</span>
        <span className="text-[rgb(var(--fg-muted))]">{fmt(durationMs)}</span>
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
