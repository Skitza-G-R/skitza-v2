"use client";

import WaveSurfer from "wavesurfer.js";
import { useCallback, useEffect, useRef, useState } from "react";

// Visual waveform player for project-room playback (dashboard + share).
//
// Why waveforms here and not on the portfolio: project rooms render a
// single track at a time with timestamped producer/artist comments, so
// the waveform is the primary scrubbing affordance. The portfolio page
// renders N tracks, each of which would decode + lay out peaks on mount
// — far too expensive. That page keeps the lighter TrackPlayer.
//
// This component mirrors TrackPlayer's button aesthetics (brand-primary
// bg, play/pause SVGs, spinner on load) so the two feel like a family.

interface WaveformPlayerProps {
  src: string;
  /** Accessible label for the player (defaults to "Audio track"). */
  label?: string;
  /** Fires once when the waveform is decoded and duration is known. */
  onReady?: (durationSec: number) => void;
  /** Fires after a user click-to-seek on the waveform. */
  onSeek?: (timeSec: number) => void;
  className?: string;
}

export function WaveformPlayer({
  src,
  label,
  onReady,
  onSeek,
  className,
}: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable refs for callbacks so we don't recreate the wavesurfer on
  // every parent re-render (which would be very expensive — each create
  // refetches + redecodes the audio).
  const onReadyRef = useRef(onReady);
  const onSeekRef = useRef(onSeek);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Resolve palette tokens to concrete rgb() strings at mount-time —
    // wavesurfer paints to canvas so CSS vars can't be used directly.
    // Reading computed style also picks up the active theme (light/dark).
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--brand-accent").trim() || "176 104 48";
    const primary = styles.getPropertyValue("--brand-primary").trim() || "212 150 10";
    const fgPrimary = styles.getPropertyValue("--fg-primary").trim() || "26 23 20";

    setReady(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(null);
    setError(null);

    const ws = WaveSurfer.create({
      container,
      height: 80,
      waveColor: `rgba(${accent.replaceAll(" ", ", ")}, 0.35)`,
      progressColor: `rgb(${primary.replaceAll(" ", ", ")})`,
      cursorColor: `rgb(${fgPrimary.replaceAll(" ", ", ")})`,
      cursorWidth: 1,
      barWidth: 2,
      barRadius: 1,
      normalize: true,
      url: src,
    });
    wsRef.current = ws;

    const offReady = ws.on("ready", () => {
      setReady(true);
      const d = ws.getDuration();
      setDuration(d);
      onReadyRef.current?.(d);
    });
    const offPlay = ws.on("play", () => {
      setPlaying(true);
    });
    const offPause = ws.on("pause", () => {
      setPlaying(false);
    });
    const offFinish = ws.on("finish", () => {
      setPlaying(false);
    });
    const offTime = ws.on("timeupdate", (t) => {
      setCurrent(t);
    });
    const offErr = ws.on("error", () => {
      setError("This track failed to load.");
      setPlaying(false);
    });
    const offClick = ws.on("click", () => {
      onSeekRef.current?.(ws.getCurrentTime());
    });

    return () => {
      offReady();
      offPlay();
      offPause();
      offFinish();
      offTime();
      offErr();
      offClick();
      ws.destroy();
      wsRef.current = null;
    };
  }, [src]);

  const toggle = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    void ws.playPause();
  }, [ready]);

  // Space toggles play/pause when the button is focused (mirrors the
  // behaviour of TrackPlayer). We swallow the default so the page doesn't
  // scroll when the user hits space.
  function onBtnKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      toggle();
    }
  }

  return (
    <div className={["flex w-full items-center gap-3", className ?? ""].join(" ")}>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={onBtnKey}
        disabled={!ready && !error}
        aria-label={playing ? "Pause" : "Play"}
        className={[
          "h-10 w-10 shrink-0 flex items-center justify-center rounded-full",
          "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]",
          "shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.15),0_2px_8px_-1px_rgb(var(--brand-primary)/0.35)]",
          "transition-[transform,filter] duration-150 active:translate-y-[1px]",
          "hover:brightness-110 disabled:cursor-default disabled:opacity-80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
        ].join(" ")}
      >
        {playing ? (
          <PauseIcon size={14} />
        ) : !ready && !error ? (
          <Spinner size={14} />
        ) : (
          <PlayIcon size={14} />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          ref={containerRef}
          aria-label={label ?? "Audio track waveform"}
          className={[
            "relative w-full rounded-sm",
            // Placeholder shimmer while decoding — wavesurfer itself paints
            // nothing until "ready", so without this the user sees a blank
            // 80px-tall gap and wonders if the upload is broken.
            !ready && !error ? "animate-pulse bg-[rgb(var(--bg-sunken))]" : "",
          ].join(" ")}
          style={{ height: 80, touchAction: "none" }}
        />
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

// Duplicated from track-player.tsx — it's 8 lines of pure logic and not
// exported there; the alternative is a new utils file for a single helper.
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
