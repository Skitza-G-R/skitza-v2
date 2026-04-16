"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Custom audio player for the public portfolio + dashboard.
//
// Replaces the native <audio controls> widget which:
// - Has zero visual alignment with the Studio Monitor palette.
// - Ships OS-specific chrome on every browser/platform combination.
// - Can't be styled beyond a handful of non-standard pseudo-elements.
//
// We use a hidden <audio> element (the browser still decodes), plus
// our own button + progress bar. preload="none" so N tracks on the
// public page don't simultaneously hit R2/CDN.
//
// Keyboard: Space toggles play/pause on the button. Arrow keys will
// scrub in a future pass; MVP ships with click-to-seek on the bar.
//
// No external deps. Wavesurfer integration lands in weeks 6-8 as a
// drop-in replacement that reuses this component's interface.

interface TrackPlayerProps {
  src: string;
  /** Optional accessible label for the player (defaults to "Audio track"). */
  label?: string;
  /** Compact variant — shorter bar, smaller button. */
  compact?: boolean;
}

export function TrackPlayer({ src, label, compact = false }: TrackPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Event wiring — attach once per `src` change. React's strict-mode
  // re-mount will clean up via the returned closure.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    function onPlay() {
      setPlaying(true);
      setError(null);
    }
    function onPause() {
      setPlaying(false);
    }
    function onEnded() {
      setPlaying(false);
      setCurrent(0);
    }
    function onTimeUpdate() {
      if (el) setCurrent(el.currentTime);
    }
    function onLoadedMetadata() {
      if (el && Number.isFinite(el.duration)) setDuration(el.duration);
      setLoading(false);
    }
    function onProgress() {
      if (!el) return;
      const r = el.buffered;
      if (r.length > 0) setBuffered(r.end(r.length - 1));
    }
    function onWaiting() {
      setLoading(true);
    }
    function onPlaying() {
      setLoading(false);
    }
    function onError() {
      setError("This track failed to load.");
      setPlaying(false);
      setLoading(false);
    }

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("progress", onProgress);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("progress", onProgress);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("error", onError);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      setLoading(true);
      void el.play().catch(() => {
        setError("Couldn't start playback. Check your browser's autoplay settings.");
        setPlaying(false);
        setLoading(false);
      });
    } else {
      el.pause();
    }
  }, []);

  const seek = useCallback((pct: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const target = Math.max(0, Math.min(1, pct)) * el.duration;
    el.currentTime = target;
    setCurrent(target);
  }, []);

  function onBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = (e.clientX - rect.left) / rect.width;
    seek(pct);
  }

  function onBarKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!duration) return;
    // 5% per arrow — rough-scrub. Home/End jump to ends.
    if (e.key === "ArrowRight") {
      e.preventDefault();
      seek(current / duration + 0.05);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seek(current / duration - 0.05);
    } else if (e.key === "Home") {
      e.preventDefault();
      seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seek(1);
    }
  }

  const progressPct = duration && duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration && duration > 0 ? (buffered / duration) * 100 : 0;

  const btnSize = compact ? "h-8 w-8" : "h-10 w-10";
  const btnIconSize = compact ? 12 : 14;

  return (
    <div className="flex w-full items-center gap-3">
      {/* Hidden native element — keeps browser decoding + transport. */}
      <audio ref={audioRef} src={src} preload="none" className="sr-only" />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className={[
          "shrink-0 flex items-center justify-center rounded-full",
          "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]",
          "shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.15),0_2px_8px_-1px_rgb(var(--brand-primary)/0.35)]",
          "transition-[transform,filter] duration-150 active:translate-y-[1px]",
          "hover:brightness-110",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
          btnSize,
        ].join(" ")}
      >
        {playing ? (
          <PauseIcon size={btnIconSize} />
        ) : loading ? (
          <Spinner size={btnIconSize} />
        ) : (
          <PlayIcon size={btnIconSize} />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Progress bar — button role so screen readers see it as
            interactive; tabindex 0 means keyboard-focusable. */}
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label={label ?? "Audio track progress"}
          aria-valuemin={0}
          aria-valuemax={duration ?? 100}
          aria-valuenow={current}
          onClick={onBarClick}
          onKeyDown={onBarKey}
          className="group relative h-2 w-full cursor-pointer overflow-hidden rounded-full bg-[rgb(var(--bg-sunken))]"
        >
          {/* Buffered ahead — subtle, pushed under the played-through. */}
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 bg-[rgb(var(--border-strong))]"
            style={{ width: `${String(bufferedPct)}%` }}
          />
          {/* Played-through — brand green. */}
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 bg-[rgb(var(--brand-primary))] transition-[width] duration-100 ease-linear"
            style={{ width: `${String(progressPct)}%` }}
          />
          {/* Handle — only visible on hover/focus, keeps the bar clean. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgb(var(--fg-primary))] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            style={{ left: `${String(progressPct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-[0.66rem] tracking-wide text-[rgb(var(--fg-muted))]">
          <span>{formatTime(current)}</span>
          {error ? (
            <span role="alert" className="text-[rgb(var(--fg-danger))]">
              {error}
            </span>
          ) : (
            <span>{duration !== null ? formatTime(duration) : "—"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// "3:24" / "0:42" formatting. Sub-10-min tracks hide the leading minute
// for compactness. Over 60 minutes reads as "1:04:12" — unlikely for
// portfolio tracks but we handle it cleanly.
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const ss = String(s).padStart(2, "0");
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${String(h)}:${mm}:${ss}` : `${mm}:${ss}`;
}

function PlayIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function PauseIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="2" height="7" rx="0.5" />
      <rect x="7" y="2.5" width="2" height="7" rx="0.5" />
    </svg>
  );
}

function Spinner({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="3"
      />
      <path
        d="M12 4a8 8 0 0 1 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
