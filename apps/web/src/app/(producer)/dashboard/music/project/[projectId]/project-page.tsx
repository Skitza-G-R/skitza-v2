"use client";

import {
  ChevronLeft,
  Clock3,
  MoreHorizontal,
  Play,
  Share2,
  Shuffle,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { EqBars } from "~/components/audio/eq-bars";
import {
  playerPlay,
  playerToggle,
  useNowPlaying,
} from "~/components/audio/persistent-player";

import { ProjectCover } from "~/components/dashboard/music/project-cover";
import {
  fmtDuration,
  gradientForSeed,
  GRADIENT_CSS,
  kindFromTrackCount,
  padIndex,
  sumDurations,
} from "~/components/dashboard/music/lib";

// ─── Wire types ──────────────────────────────────────────────────────

export interface ProjectPageTrack {
  id: string; // latest version id
  trackId: string;
  title: string;
  artist: string | null;
  versionLabel: string;
  audioUrl: string | null;
  durationMs: number | null;
  uploadedAtIso: string;
  unreadComments: number;
  plays: number;
}

export interface ProjectPageData {
  project: {
    id: string;
    title: string;
    clientName: string | null;
    createdAtIso: string;
  };
  tracks: ProjectPageTrack[];
}

// ─── Component ───────────────────────────────────────────────────────

export function ProjectPage({ data }: { data: ProjectPageData }) {
  const nowPlaying = useNowPlaying();

  const gradient = useMemo(
    () => gradientForSeed(data.project.id),
    [data.project.id],
  );
  const kind = useMemo(
    () => kindFromTrackCount(data.tracks.length),
    [data.tracks.length],
  );
  const totalDurationMs = useMemo(
    () => sumDurations(data.tracks.map((t) => t.durationMs)),
    [data.tracks],
  );
  const artistLabel = (data.project.clientName ?? "").trim() || "Unknown artist";

  // Build a PlayerTrack payload for a given row.
  function toPlayerTrack(t: ProjectPageTrack) {
    return {
      id: t.id,
      audioUrl: t.audioUrl,
      title: t.title,
      subtitle: `${artistLabel} · ${t.versionLabel}`,
      durationMs: t.durationMs,
    };
  }

  function handlePlayTrack(t: ProjectPageTrack) {
    if (!t.audioUrl) return;
    if (nowPlaying.trackId === t.id) {
      playerToggle();
      return;
    }
    playerPlay(toPlayerTrack(t));
  }

  function handlePlayProject() {
    // "Play current track if it's in this project, else the first."
    const currentInProject = data.tracks.find((t) => t.id === nowPlaying.trackId);
    const target = currentInProject ?? data.tracks[0];
    if (!target) return;
    if (nowPlaying.trackId === target.id) {
      playerToggle();
      return;
    }
    handlePlayTrack(target);
  }

  function handleShuffle() {
    // Pick a random track and start it. No shuffle queue persistence
    // for v1 — single-shot randomization is good enough for the action
    // rail's "Shuffle" affordance.
    if (data.tracks.length === 0) return;
    const idx = Math.floor(Math.random() * data.tracks.length);
    const target = data.tracks[idx];
    if (target) handlePlayTrack(target);
  }

  async function handleShare() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      await navigator.share({ title: data.project.title, url });
    } catch {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Neither API available — the affordance is non-destructive.
      }
    }
  }

  // Whole project-play playing state (true when ANY track in the
  // project is currently playing — drives the hero play button glyph).
  const projectTrackIds = useMemo(
    () => new Set(data.tracks.map((t) => t.id)),
    [data.tracks],
  );
  const projectIsPlaying =
    nowPlaying.playing && nowPlaying.trackId !== null &&
    projectTrackIds.has(nowPlaying.trackId);

  return (
    <main className="sk-page-enter">
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <header
        className="relative isolate overflow-hidden"
        style={{ background: GRADIENT_CSS[gradient] }}
      >
        {/* Atmospheric overlay: subtle white highlight top-left +
            linear fade to the page background at the bottom. Signature
            treatment shared with the song page hero. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 60% at 18% 18%, rgba(255,255,255,0.18), transparent 60%), linear-gradient(180deg, rgba(17,16,9,0), rgba(17,16,9,0.18) 70%, rgb(var(--bg-background)))",
          }}
        />

        <div
          className="relative mx-auto"
          style={{
            maxWidth: 1120,
            padding: "clamp(22px, 2.6vw, 32px) clamp(28px, 3vw, 36px) clamp(30px, 3vw, 40px)",
          }}
        >
          {/* Top row: back button + eyebrow + ellipsis */}
          <div className="reveal-up mb-6 flex items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/music"
                aria-label="Back to Library"
                className="sk-press sk-trans inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/22 bg-white/14 backdrop-blur-sm hover:bg-white/22"
              >
                <ChevronLeft size={14} strokeWidth={2.4} />
              </Link>
              <span
                className="font-mono text-[10.5px] font-bold uppercase"
                style={{
                  letterSpacing: "0.06em",
                  color: "rgba(255,255,255,0.65)",
                }}
              >
                Library / {kind}
              </span>
            </div>
            <button
              type="button"
              aria-label="More actions"
              className="sk-press sk-trans inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/22 bg-white/14 text-white backdrop-blur-sm hover:bg-white/22"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>

          {/* Cover + meta — flex row, ends at bottom so the title baseline
              aligns with the cover's bottom edge. Wraps on narrow screens.
              Hero elements reveal in a 4-step cascade so the page assembles
              visually rather than appearing as a single block. */}
          <div className="flex flex-wrap items-end gap-8 pb-1.5">
            <div className="reveal-up reveal-up-delay-1">
              <ProjectCover
                seed={data.project.id}
                gradient={gradient}
                kind={kind}
                shadow="hero"
                radius="18px"
                className="h-[232px] w-[232px] shrink-0"
              />
            </div>
            <div className="min-w-0 flex-1">
              <span
                className="reveal-up reveal-up-delay-2 inline-block font-mono text-[10.5px] font-bold uppercase"
                style={{
                  letterSpacing: "0.1em",
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                {kind}
              </span>
              <h1
                className="reveal-up reveal-up-delay-2 mt-3 font-display font-extrabold text-white"
                style={{
                  fontSize: "clamp(40px, 6.4vw, 76px)",
                  lineHeight: 0.96,
                  letterSpacing: "-0.035em",
                  textShadow: "0 2px 12px rgba(17,16,9,0.22)",
                  margin: 0,
                }}
              >
                {data.project.title}
              </h1>
              <p
                className="reveal-up reveal-up-delay-3 mt-4 text-[13px]"
                style={{ color: "rgba(255,255,255,0.92)" }}
              >
                {artistLabel} · {String(data.tracks.length)} track
                {data.tracks.length === 1 ? "" : "s"} ·{" "}
                <span className="font-mono tabular-nums">
                  {fmtDuration(totalDurationMs)}
                </span>
              </p>
            </div>
          </div>

          {/* Action row */}
          <div className="reveal-up reveal-up-delay-4 mt-6 flex flex-wrap items-center gap-3.5">
            <button
              type="button"
              aria-label={projectIsPlaying ? "Pause project" : "Play project"}
              onClick={handlePlayProject}
              className={[
                "sk-press inline-flex h-[60px] w-[60px] items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))] shadow-[0_8px_22px_rgba(17,16,9,0.28)]",
                projectIsPlaying ? "skitza-playing-glow" : "",
              ].join(" ")}
            >
              {projectIsPlaying ? (
                <EqBars playing size={20} />
              ) : (
                <Play size={20} strokeWidth={2.6} fill="currentColor" />
              )}
            </button>
            <CircleIconButton
              ariaLabel="Shuffle"
              onClick={handleShuffle}
            >
              <Shuffle size={16} strokeWidth={2.2} />
            </CircleIconButton>
            <CircleIconButton ariaLabel="Share" onClick={() => void handleShare()}>
              <Share2 size={16} strokeWidth={2.2} />
            </CircleIconButton>
            <CircleIconButton ariaLabel="More">
              <MoreHorizontal size={16} strokeWidth={2.2} />
            </CircleIconButton>
          </div>
        </div>
      </header>

      {/* ── Tracklist ──────────────────────────────────────────────── */}
      <section
        className="mx-auto"
        style={{
          maxWidth: 1120,
          padding: "clamp(14px, 1.8vw, 22px) clamp(28px, 3vw, 36px) clamp(56px, 5vw, 80px)",
        }}
      >
        {data.tracks.length === 0 ? (
          <EmptyTracklist projectId={data.project.id} />
        ) : (
          <>
            <Tracklist
              tracks={data.tracks}
              projectId={data.project.id}
              nowPlayingId={nowPlaying.trackId}
              isPlaying={nowPlaying.playing}
              onPlay={handlePlayTrack}
            />
            <footer
              className="mt-7 flex flex-wrap items-center justify-between gap-2 pt-4 font-mono text-[11.5px] text-[rgb(var(--fg-muted))]"
              style={{ borderTop: "1px solid rgb(var(--border-subtle))" }}
            >
              <span>
                <span className="font-bold tabular-nums text-[rgb(var(--fg-default))]">
                  {String(data.tracks.length)}
                </span>{" "}
                track{data.tracks.length === 1 ? "" : "s"} ·{" "}
                <span className="tabular-nums">{fmtDuration(totalDurationMs)}</span>
              </span>
              <span className="truncate">{artistLabel}</span>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}

// ─── Local primitives ────────────────────────────────────────────────

function CircleIconButton({
  ariaLabel,
  onClick,
  active,
  children,
}: {
  ariaLabel: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        "sk-press sk-trans inline-flex h-10 w-10 items-center justify-center rounded-full",
        active
          ? "bg-white text-[rgb(17_16_9)]"
          : "bg-transparent text-white hover:bg-white/12",
      ].join(" ")}
      style={{ border: "1px solid rgba(255,255,255,0.92)" }}
    >
      {children}
    </button>
  );
}

function Tracklist({
  tracks,
  projectId,
  nowPlayingId,
  isPlaying,
  onPlay,
}: {
  tracks: ProjectPageTrack[];
  projectId: string;
  nowPlayingId: string | null;
  isPlaying: boolean;
  onPlay: (t: ProjectPageTrack) => void;
}) {
  const cols = "36px minmax(0,1fr) 86px 80px 60px 44px";
  return (
    <>
      {/* Header eyebrow row */}
      <div
        className="grid items-center gap-3 px-4 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
        style={{
          gridTemplateColumns: cols,
          borderBottom: "1px solid rgb(var(--border-subtle))",
        }}
      >
        <span className="text-right">#</span>
        <span>Title</span>
        <span>Version</span>
        <span className="text-right">Plays</span>
        <span className="text-right">Notes</span>
        <span className="flex justify-end">
          <Clock3 size={11} strokeWidth={2} />
        </span>
      </div>
      <ul role="list">
        {tracks.map((t, idx) => {
          const isCurrent = nowPlayingId === t.id;
          const playingHere = isCurrent && isPlaying;
          return (
            <li
              key={t.id}
              className="sk-stagger-item"
              style={{ "--i": String(idx) } as React.CSSProperties}
            >
              <div
                className={[
                  "group relative grid items-center gap-3 px-4 py-2.5",
                  isCurrent
                    ? "bg-[rgb(var(--brand-primary)/0.06)]"
                    : "hover:bg-[rgb(var(--bg-overlay))]",
                ].join(" ")}
                style={{
                  gridTemplateColumns: cols,
                  borderRadius: 12,
                  transition: "background-color 140ms ease-out",
                }}
              >
                {/* Index → play swap */}
                <div className="relative flex justify-end">
                  <button
                    type="button"
                    aria-label={playingHere ? "Pause" : "Play"}
                    onClick={() => {
                      onPlay(t);
                    }}
                    disabled={!t.audioUrl}
                    className={[
                      "sk-press sk-trans inline-flex h-[26px] w-[26px] items-center justify-center rounded-full disabled:opacity-40",
                      isCurrent
                        ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))] shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.25)]"
                        : "bg-[rgb(var(--fg-default))] text-white opacity-0 group-hover:opacity-100",
                    ].join(" ")}
                  >
                    {playingHere ? (
                      <EqBars playing size={11} />
                    ) : (
                      <Play size={11} strokeWidth={2.6} fill="currentColor" />
                    )}
                  </button>
                  <span
                    aria-hidden
                    className={[
                      "pointer-events-none absolute font-mono text-[11px] tabular-nums text-[rgb(var(--fg-faint))]",
                      isCurrent ? "opacity-0" : "group-hover:opacity-0",
                    ].join(" ")}
                    style={{
                      width: 28,
                      textAlign: "right",
                      lineHeight: "26px",
                    }}
                  >
                    {padIndex(idx)}
                  </span>
                </div>

                {/* Title (deep link to song page) */}
                <Link
                  href={`/dashboard/music/${t.id}?from=${projectId}`}
                  className="min-w-0"
                >
                  <p className="truncate text-[14px] font-bold leading-tight text-[rgb(var(--fg-default))]">
                    {t.title}
                  </p>
                  {t.artist ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                      {t.artist}
                    </p>
                  ) : null}
                </Link>

                <span>
                  <span
                    className="inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-[rgb(var(--fg-default))]"
                    style={{
                      background: "rgb(var(--bg-elevated))",
                      border: "1px solid rgb(var(--border-subtle))",
                    }}
                  >
                    {t.versionLabel}
                  </span>
                </span>

                <span className="text-right font-mono text-[11px] tabular-nums text-[rgb(var(--fg-muted))]">
                  {t.plays > 0 ? String(t.plays) : "—"}
                </span>

                <span
                  className={[
                    "text-right font-mono text-[11px] tabular-nums",
                    t.unreadComments > 0
                      ? "font-bold text-[rgb(var(--brand-primary-dark))]"
                      : "text-[rgb(var(--fg-faint))]",
                  ].join(" ")}
                >
                  {t.unreadComments > 0 ? String(t.unreadComments) : "—"}
                </span>

                <span className="text-right font-mono text-[12px] tabular-nums text-[rgb(var(--fg-muted))]">
                  {fmtDuration(t.durationMs)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function EmptyTracklist({ projectId }: { projectId: string }) {
  return (
    <div
      role="status"
      className="rounded-[14px] border border-dashed px-6 py-10 text-center"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        background: "rgb(var(--bg-elevated))",
      }}
    >
      <h3 className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
        No tracks here yet
        <span className="text-[rgb(var(--brand-primary-dark))]">.</span>
      </h3>
      <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
        Drop a WAV into this project to kick it off.
      </p>
      <Link
        href={`/dashboard/clients-projects/${projectId}?tab=music&action=upload`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-[9px] bg-[rgb(var(--brand-primary))] px-3.5 py-2 text-[12.5px] font-bold text-[rgb(var(--fg-default))]"
      >
        Upload track
      </Link>
    </div>
  );
}
