"use client";

import {
  Clock3,
  MoreHorizontal,
  Play,
  Share2,
  Shuffle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EqBars } from "~/components/audio/eq-bars";
import {
  playerPlay,
  playerToggle,
  useNowPlaying,
} from "~/components/audio/persistent-player";

import { ProjectCover } from "~/components/music/project-cover";
import {
  fmtCount,
  fmtDuration,
  formatProjectFooter,
  gradientForSeed,
  GRADIENT_CSS,
  kindFromTrackCount,
  padIndex,
  sumDurations,
} from "~/components/music/lib";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";

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

// Which side of the app is rendering this screen. Default = "producer"
// so existing call-sites keep working unchanged.
//
// In artist mode:
//   - tracklist rows do NOT navigate (L3 song page doesn't exist on the
//     artist tree yet). They become play-on-click buttons.
//   - the empty-state "Upload track" CTA is hidden (artists don't
//     upload — that's the producer's job).
//
// `extraBelow` lets the artist route append a sessions panel beneath
// the tracklist footer without forking the component. Producer side
// doesn't pass it; null check inside keeps the markup clean.
export type ProjectPageRole = "producer" | "artist";

// ─── Component ───────────────────────────────────────────────────────

export function ProjectPage({
  data,
  role = "producer",
  extraBelow,
}: {
  data: ProjectPageData;
  role?: ProjectPageRole;
  extraBelow?: React.ReactNode;
}) {
  const nowPlaying = useNowPlaying();
  // Inline "Link copied" confirmation. Auto-dismisses 2.4s after the
  // share action triggers a clipboard fallback. Inline (not a modal /
  // toast) per the impeccable rule "modals are usually laziness."
  const [shareConfirm, setShareConfirm] = useState<null | "copied" | "shared">(null);

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
  const lastUploadIso = useMemo(() => {
    let max = 0;
    let iso: string | null = null;
    for (const t of data.tracks) {
      const ts = Date.parse(t.uploadedAtIso);
      if (Number.isFinite(ts) && ts > max) {
        max = ts;
        iso = t.uploadedAtIso;
      }
    }
    return iso;
  }, [data.tracks]);
  const artistLabel = (data.project.clientName ?? "").trim() || "Unknown artist";

  // Auto-dismiss the share confirmation after a short window.
  useEffect(() => {
    if (shareConfirm === null) return;
    const t = window.setTimeout(() => {
      setShareConfirm(null);
    }, 2400);
    return () => {
      window.clearTimeout(t);
    };
  }, [shareConfirm]);

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
      setShareConfirm("shared");
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setShareConfirm("copied");
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
            // More breathing room above the cover so it floats lower
            // inside its hero (hero felt cover-dominated).
            padding: "clamp(36px, 4.4vw, 56px) clamp(28px, 3vw, 36px) clamp(30px, 3vw, 40px)",
          }}
        >
          {/* Publishes Music › <client>? › <project> to the sticky
              topbar. Replaces the in-hero "Library › {kind}" breadcrumb
              that duplicated the topbar's section label. The kind
              ("SINGLE" / "ALBUM" / "EP") is still visible as the
              eyebrow above the project title. Client is plain text
              here (no link) because the Music section doesn't fetch
              the contact id — the clients-projects album page DOES
              link to the client when it has the contact resolved. */}
          <SetTopBarBreadcrumb
            crumbs={
              data.project.clientName
                ? [
                    { label: data.project.clientName },
                    { label: data.project.title },
                  ]
                : [{ label: data.project.title }]
            }
          />

          {/* Top row: just the ellipsis (More actions) now. The back-
              arrow that used to sit on the left was redundant with the
              topbar's "Music" link — same destination, two affordances
              — so design-critique flagged it for removal. */}
          <div className="reveal-up mb-6 flex items-center justify-end gap-3 text-white">
            <button
              type="button"
              aria-label="More actions"
              title="More actions"
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
                wordmark
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
                  // Capped lower than the original 76px max so the
                  // title reads as bold without becoming a billboard.
                  // Apple Music's album hero caps around 56–60px.
                  fontSize: "clamp(36px, 4.4vw, 60px)",
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
              title={projectIsPlaying ? "Pause (Space)" : "Play (Space)"}
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
            <CircleIconButton ariaLabel="Shuffle" title="Shuffle play" onClick={handleShuffle}>
              <Shuffle size={16} strokeWidth={2.2} />
            </CircleIconButton>
            <CircleIconButton
              ariaLabel="Share"
              title="Share project link"
              onClick={() => void handleShare()}
            >
              <Share2 size={16} strokeWidth={2.2} />
            </CircleIconButton>
            <CircleIconButton ariaLabel="More" title="More actions">
              <MoreHorizontal size={16} strokeWidth={2.2} />
            </CircleIconButton>
            {/* Inline share confirmation. Mounts only briefly; CSS
                fade-in via reveal-up. role="status" so screen readers
                announce the result. */}
            {shareConfirm ? (
              <span
                role="status"
                className="reveal-up rounded-[var(--radius-sm)] bg-white/90 px-3 py-1.5 text-[11.5px] font-bold text-[rgb(17_16_9)] backdrop-blur-sm"
              >
                {shareConfirm === "copied" ? "Link copied" : "Shared"}
              </span>
            ) : null}
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
          <EmptyTracklist projectId={data.project.id} role={role} />
        ) : (
          <>
            <Tracklist
              tracks={data.tracks}
              projectId={data.project.id}
              nowPlayingId={nowPlaying.trackId}
              isPlaying={nowPlaying.playing}
              onPlay={handlePlayTrack}
              role={role}
            />
            <footer
              className="mt-7 flex flex-col gap-1 pt-4 font-mono text-[11.5px] text-[rgb(var(--fg-muted))]"
              style={{ borderTop: "1px solid rgb(var(--border-subtle))" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-bold tabular-nums text-[rgb(var(--fg-default))]">
                    {String(data.tracks.length)}
                  </span>{" "}
                  track{data.tracks.length === 1 ? "" : "s"} ·{" "}
                  <span className="tabular-nums">
                    {fmtDuration(totalDurationMs)}
                  </span>
                </span>
                <span className="truncate">{artistLabel}</span>
              </div>
              {(() => {
                const meta = formatProjectFooter({
                  createdAtIso: data.project.createdAtIso,
                  lastUploadIso,
                });
                return meta ? (
                  <div className="text-[10.5px] text-[rgb(var(--fg-faint))]">
                    {meta}
                  </div>
                ) : null;
              })()}
            </footer>
          </>
        )}
        {/* `extraBelow` slot — artist L2 uses it to render the
            sessions panel beneath the tracklist. Producer side passes
            nothing and renders nothing. */}
        {extraBelow ? <div className="mt-7">{extraBelow}</div> : null}
      </section>
    </main>
  );
}

// ─── Local primitives ────────────────────────────────────────────────

function CircleIconButton({
  ariaLabel,
  title,
  onClick,
  active,
  children,
}: {
  ariaLabel: string;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
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
  role,
}: {
  tracks: ProjectPageTrack[];
  projectId: string;
  nowPlayingId: string | null;
  isPlaying: boolean;
  onPlay: (t: ProjectPageTrack) => void;
  role: ProjectPageRole;
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
          // Whole row is a <Link> → L3 song page on both sides
          // (Spotify + Apple Music both use this pattern: clickable
          // row, dedicated play affordance). The inner play button
          // calls preventDefault + stopPropagation so clicking it
          // plays without navigating. Only the URL differs by role.
          const rowHref =
            role === "producer"
              ? `/dashboard/music/${t.id}?from=${projectId}`
              : `/artist/music/song/${t.id}`;
          const rowClassName = [
            "group relative grid items-center gap-3 px-4 py-2.5",
            isCurrent
              ? "bg-[rgb(var(--brand-primary)/0.06)]"
              : "hover:bg-[rgb(var(--bg-overlay))]",
          ].join(" ");
          const rowStyle: React.CSSProperties = {
            gridTemplateColumns: cols,
            borderRadius: 12,
            transition: "background-color 140ms ease-out",
          };
          return (
            <li
              key={t.id}
              className="sk-stagger-item"
              style={{ "--i": String(idx) } as React.CSSProperties}
            >
              <Link
                href={rowHref}
                aria-label={`Open ${t.title} song page`}
                className={rowClassName}
                style={rowStyle}
              >
                {/* Index → play swap */}
                <span className="relative flex justify-end">
                  <button
                    type="button"
                    aria-label={playingHere ? "Pause" : "Play"}
                    title={playingHere ? "Pause (Space)" : "Play (Space)"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onPlay(t);
                    }}
                    disabled={!t.audioUrl}
                    className={[
                      "sk-press sk-trans inline-flex h-[26px] w-[26px] items-center justify-center rounded-full disabled:opacity-40",
                      isCurrent
                        ? "skitza-playing-glow bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
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
                </span>

                {/* Title cell — bare divs since the whole row is the link */}
                <span className="min-w-0 block">
                  <p className="truncate text-[14px] font-bold leading-tight text-[rgb(var(--fg-default))]">
                    {t.title}
                  </p>
                  {t.artist ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                      {t.artist}
                    </p>
                  ) : null}
                </span>

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

                <span
                  className="text-right font-mono text-[11px] tabular-nums text-[rgb(var(--fg-muted))]"
                  style={{ minWidth: 24 }}
                >
                  {fmtCount(t.plays)}
                </span>

                <span
                  className={[
                    "text-right font-mono text-[11px] tabular-nums",
                    t.unreadComments > 0
                      ? "font-bold text-[rgb(var(--brand-primary-dark))]"
                      : "text-[rgb(var(--fg-faint))]",
                  ].join(" ")}
                  style={{ minWidth: 24 }}
                >
                  {fmtCount(t.unreadComments)}
                </span>

                <span className="text-right font-mono text-[12px] tabular-nums text-[rgb(var(--fg-muted))]">
                  {fmtDuration(t.durationMs)}
                </span>
              </Link>
              ) : (
              <div
                role="button"
                tabIndex={0}
                aria-label={`Play ${t.title}`}
                onClick={() => {
                  onPlay(t);
                }}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    onPlay(t);
                  }
                }}
                className={[rowClassName, "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"].join(" ")}
                style={rowStyle}
              >
                {/* Index → play swap */}
                <span className="relative flex justify-end">
                  <button
                    type="button"
                    aria-label={playingHere ? "Pause" : "Play"}
                    title={playingHere ? "Pause (Space)" : "Play (Space)"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onPlay(t);
                    }}
                    disabled={!t.audioUrl}
                    className={[
                      "sk-press sk-trans inline-flex h-[26px] w-[26px] items-center justify-center rounded-full disabled:opacity-40",
                      isCurrent
                        ? "skitza-playing-glow bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
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
                </span>

                <span className="min-w-0 block">
                  <p className="truncate text-[14px] font-bold leading-tight text-[rgb(var(--fg-default))]">
                    {t.title}
                  </p>
                  {t.artist ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                      {t.artist}
                    </p>
                  ) : null}
                </span>

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

                <span
                  className="text-right font-mono text-[11px] tabular-nums text-[rgb(var(--fg-muted))]"
                  style={{ minWidth: 24 }}
                >
                  {fmtCount(t.plays)}
                </span>

                <span
                  className={[
                    "text-right font-mono text-[11px] tabular-nums",
                    t.unreadComments > 0
                      ? "font-bold text-[rgb(var(--brand-primary-dark))]"
                      : "text-[rgb(var(--fg-faint))]",
                  ].join(" ")}
                  style={{ minWidth: 24 }}
                >
                  {fmtCount(t.unreadComments)}
                </span>

                <span className="text-right font-mono text-[12px] tabular-nums text-[rgb(var(--fg-muted))]">
                  {fmtDuration(t.durationMs)}
                </span>
              </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function EmptyTracklist({
  projectId,
  role,
}: {
  projectId: string;
  role: ProjectPageRole;
}) {
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
        {role === "producer"
          ? "Drop a WAV into this project to kick it off."
          : "Once your producer uploads a mix here, it'll show up below."}
      </p>
      {role === "producer" ? (
        <Link
          href={`/dashboard/clients-projects/${projectId}?tab=music&action=upload`}
          className="mt-4 inline-flex items-center gap-1.5 rounded-[9px] bg-[rgb(var(--brand-primary))] px-3.5 py-2 text-[12.5px] font-bold text-[rgb(var(--fg-default))]"
        >
          Upload track
        </Link>
      ) : null}
    </div>
  );
}
