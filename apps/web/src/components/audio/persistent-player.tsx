"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import {
  PLAYER_EVENTS,
  playerClose,
  playerPlay,
  playerSeek,
  playerToggle,
  publishNowPlaying,
  useNowPlaying,
  usePlaybackSnapshot,
  type PlayerTrack,
} from "./playback-runtime";

export {
  PLAYER_EVENTS,
  playerClose,
  playerPlay,
  playerSeek,
  playerToggle,
  publishNowPlaying,
  useNowPlaying,
};
export type { PlayerTrack };

/** Pathname matcher for the producer Song page (/dashboard/music/<uuid>).
 *  Legacy: the song page used to suppress the dock because its
 *  in-card transport bar (Skip / Play / Skip) was the playback UI.
 *  That transport has been removed, so the dock is now always
 *  visible across the dashboard. The route-based hide logic was
 *  retired with it. */

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

// ─── Component ───────────────────────────────────────────────────────

export function PersistentPlayer() {
  const state = usePlaybackSnapshot();
  const currentMs = state.currentMs;
  const audioDurationSec = state.audioDurationSec;
  // Reactive pathname — re-renders on navigation. Drives
  // expandHrefForTrack so the dock's title / cover / expand button
  // route to the right L3 (artist vs producer) without each caller
  // having to pass a role prop.
  const pathname = usePathname();
  // Dock is always visible across the dashboard now (legacy song-page
  // hide was retired with the in-card transport). The body-data-
  // attribute padding rule in globals.css (body[data-skitza-dock="1"]
  // main#main-content { padding-bottom: 110px }) automatically clears
  // the song-page comments thread from the dock's footprint.
  const dockHidden = false;

  // Toggle a body data attribute so globals.css can reserve
  // padding-bottom equal to the dock's height on every dashboard
  // page. Skip the reservation when the dock is hidden by route
  // (song page) — we don't want phantom space below the comments
  // for a dock that isn't visible.
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
  }, [state.track, dockHidden]);

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
    playerSeek(ms);
  }

  function onSkip(deltaPct: number) {
    onScrub(Math.min(100, Math.max(0, progressPct + deltaPct)));
  }

  function onTogglePlay() {
    playerToggle();
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
        hidden={dockHidden}
        pathname={pathname}
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
        onTogglePlay={onTogglePlay}
        onScrub={onScrub}
        onSkip={onSkip}
        hidden={dockHidden}
        pathname={pathname}
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
  hidden = false,
  pathname,
}: {
  track: PlayerTrack;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  progressPct: number;
  onTogglePlay: () => void;
  onScrub: (pct: number) => void;
  onSkip: (deltaPct: number) => void;
  hidden?: boolean;
  pathname: string | null;
}) {
  return (
    <div
      role="region"
      aria-label="Audio player"
      aria-hidden={hidden}
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
        <div className="hidden min-w-[360px] flex-col items-center gap-1.5 lg:flex">
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              aria-label="Skip back 5%"
              onClick={() => {
                onSkip(-5);
              }}
              className="sk-press inline-flex min-h-11 min-w-11 items-center justify-center text-white/55 hover:text-white"
            >
              <SkipBackIcon />
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
              aria-label="Skip forward 5%"
              onClick={() => {
                onSkip(5);
              }}
              className="sk-press inline-flex min-h-11 min-w-11 items-center justify-center text-white/55 hover:text-white"
            >
              <SkipForwardIcon />
            </button>
          </div>
          <div className="flex w-full items-center gap-2.5 font-mono text-[10px] text-white/40">
            <span className="w-8 text-right tabular-nums">{fmtTime(currentMs)}</span>
            <MiniWaveform seed={track.id} progressPct={progressPct} onScrub={onScrub} />
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
          <Link
            href={expandHrefForTrack(track, pathname)}
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

function MobileDock({
  track,
  playing,
  currentMs,
  durationMs,
  progressPct,
  onTogglePlay,
  onScrub,
  onSkip,
  hidden = false,
  pathname,
}: {
  track: PlayerTrack;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  progressPct: number;
  onTogglePlay: () => void;
  onScrub: (pct: number) => void;
  onSkip: (deltaPct: number) => void;
  hidden?: boolean;
  pathname: string | null;
}) {
  // SK-55 — tapping the mini bar expands a full-screen player (the
  // Spotify/Apple-Music pattern). One state flag toggles the
  // `.expanded` class on the overlay; CSS transitions do the motion.
  const [expanded, setExpanded] = useState(false);
  const collapseBtnRef = useRef<HTMLButtonElement | null>(null);

  // Force-collapse if the dock is hidden externally (e.g. close event).
  useEffect(() => {
    if (hidden) setExpanded(false);
  }, [hidden]);

  // While expanded: lock body scroll, close on Escape, and move focus
  // to the collapse chevron so keyboard/VoiceOver users land inside
  // the dialog.
  useEffect(() => {
    if (!expanded) return;
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
  }, [expanded]);

  return (
    <>
      <div
        role="region"
        aria-label="Audio player"
        aria-hidden={hidden}
        // Sits above the producer Liquid Glass nav on <md.
        // .persistent-player-dock from globals.css already handles the
        // bottom-nav + safe-area offset; here we just ensure the dock
        // takes the dark pill aesthetic and only renders <md.
        className={[
          "persistent-player-dock fixed inset-x-2 z-40 flex md:hidden",
          hidden ? "pointer-events-none" : "",
        ].join(" ")}
        style={{
          transform: hidden ? "translateY(120%) scale(0.98)" : "translateY(0) scale(1)",
          opacity: hidden ? 0 : 1,
          filter: hidden ? "blur(6px)" : "blur(0px)",
          transition: hidden
            ? "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms cubic-bezier(0.16, 1, 0.3, 1), filter 380ms cubic-bezier(0.16, 1, 0.3, 1)"
            : "transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: "transform, opacity, filter",
        }}
      >
        <div
          className="flex w-full items-center gap-2.5 rounded-xl border px-2 py-2 shadow-[0_-4px_24px_rgba(0,0,0,0.4)]"
          style={{
            background: "#1A1A1A",
            borderColor: "rgba(255,255,255,0.08)",
            color: "#fff",
          }}
        >
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
              <p className="truncate text-[13px] font-bold tracking-[-0.01em]">{track.title}</p>
              <p className="truncate text-[11px] font-semibold text-[rgb(var(--brand-primary))]">
                {track.subtitle}
              </p>
            </div>
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)]"
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
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-white/70 hover:text-white"
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
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-white/[0.06] text-white/70 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <MobileFullPlayer
        track={track}
        playing={playing}
        currentMs={currentMs}
        durationMs={durationMs}
        progressPct={progressPct}
        onTogglePlay={onTogglePlay}
        onScrub={onScrub}
        onSkip={onSkip}
        expanded={expanded}
        onCollapse={() => {
          setExpanded(false);
        }}
        collapseBtnRef={collapseBtnRef}
        pathname={pathname}
      />
    </>
  );
}

// ─── Mobile full-screen player (SK-55) ───────────────────────────────
//
// Always mounted under the mini dock so the slide-up/down transition
// can run both ways; the `expanded` flag toggles the transform (CSS
// class-toggle pattern — the state machine is one boolean, the motion
// is pure CSS). Apple-sheet curve, 340ms up / feels-quicker down via
// the same curve (distance shrinks as it leaves). Reduced-motion users
// get an instant swap.

function MobileFullPlayer({
  track,
  playing,
  currentMs,
  durationMs,
  progressPct,
  onTogglePlay,
  onScrub,
  onSkip,
  expanded,
  onCollapse,
  collapseBtnRef,
  pathname,
}: {
  track: PlayerTrack;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  progressPct: number;
  onTogglePlay: () => void;
  onScrub: (pct: number) => void;
  onSkip: (deltaPct: number) => void;
  expanded: boolean;
  onCollapse: () => void;
  collapseBtnRef: React.RefObject<HTMLButtonElement | null>;
  pathname: string | null;
}) {
  // Tint the top of the sheet with the track's identity gradient —
  // same producerGradient hash the covers use, so mini → full reads
  // as the same object growing.
  const tint = producerGradient(track.subtitle);
  return (
    <div
      role="dialog"
      aria-modal={expanded}
      aria-label={`Now playing — ${track.title}`}
      aria-hidden={!expanded}
      className={[
        "fixed inset-0 z-50 flex flex-col md:hidden",
        "motion-reduce:transition-none",
        expanded ? "" : "pointer-events-none",
      ].join(" ")}
      style={{
        background: "#141414",
        color: "#fff",
        transform: expanded ? "translateY(0)" : "translateY(100%)",
        transition: "transform 340ms cubic-bezier(0.32, 0.72, 0, 1)",
        willChange: "transform",
        visibility: expanded ? "visible" : undefined,
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
          onClick={onCollapse}
          className="sk-press mx-auto flex h-11 w-full max-w-[160px] items-center justify-center"
        >
          <span aria-hidden className="h-[5px] w-10 rounded-full bg-white/25" />
        </button>

        {/* Artwork — square, screen-width minus gutters, capped so it
            never starves the transport on short phones. Soft radial
            highlight over the identity gradient (Samply's airbrushed
            cover feel) instead of a flat color slab. */}
        <div className="flex min-h-0 flex-1 items-center justify-center py-3">
          <div
            aria-hidden
            className="relative aspect-square w-full max-w-[360px] overflow-hidden rounded-[28px] shadow-[0_28px_70px_rgba(0,0,0,0.55)]"
            style={{
              background: tint,
              maxHeight: "min(360px, 46vh)",
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
          <Link
            href={expandHrefForTrack(track, pathname)}
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
            <MiniWaveform seed={track.id} progressPct={progressPct} onScrub={onScrub} tall />
          </div>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] text-white/55 tabular-nums">
            <span>{fmtTime(currentMs)}</span>
            <span>{durationMs ? fmtTime(durationMs) : "–:––"}</span>
          </div>
        </div>

        {/* Transport — 64px play/pause flanked by ±10% skips. */}
        <div className="mt-2 flex items-center justify-center gap-9">
          <button
            type="button"
            aria-label="Skip back"
            onClick={() => {
              onSkip(-10);
            }}
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
            aria-label="Skip forward"
            onClick={() => {
              onSkip(10);
            }}
            className="sk-press inline-flex h-12 w-12 items-center justify-center rounded-full text-white/85 hover:text-white"
          >
            <SkipForwardIcon />
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
  tall = false,
}: {
  seed: string;
  progressPct: number;
  onScrub: (pct: number) => void;
  /** Full-screen player variant — taller strip, thicker bars. */
  tall?: boolean;
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
