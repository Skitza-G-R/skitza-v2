"use client";

import { AudioLines, Clock3, Play, Plus, Shuffle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { EqBars } from "~/components/audio/eq-bars";
import { playerPlay, playerToggle, useNowPlaying } from "~/components/audio/persistent-player";

import { ProjectCover } from "~/components/music/project-cover";
import {
  SongManagementControls,
  type EditSongArtistAction,
  type MarkSongReleasedAction,
  type RenameSongAction,
  type SetSongArchivedAction,
} from "~/components/music/song-management-controls";
import {
  fmtCount,
  fmtDuration,
  formatProjectFooter,
  gradientForSeed,
  GRADIENT_CSS,
  padIndex,
  sumDurations,
  type ProjectKind,
} from "~/components/music/lib";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { withArtistStudio } from "~/lib/artist-studio-context";

// ─── Wire types ──────────────────────────────────────────────────────

export interface ProjectPageTrack {
  kind?: "track";
  /** Stable row id. Older callers may continue passing latest-version id. */
  id: string;
  trackId: string;
  title: string;
  artist: string | null;
  archivedAtIso: string | null;
  releasedAtIso?: string | null;
  /** Explicit tombstone for an intentionally deleted stored-audio object. */
  audioDeletedAtIso?: string | null;
  versionLabel: string | null;
  /** Undefined preserves the legacy `id is version id` contract. */
  latestVersionId?: string | null;
  audioUrl: string | null;
  durationMs: number | null;
  uploadedAtIso: string | null;
  unreadComments: number;
  plays: number;
  /** Real upload/add-version destination for an allocated no-audio song. */
  actionHref?: string | null;
}

export interface ProjectPageEmptySlot {
  kind: "empty-slot";
  id: string;
  purchaseId: string;
  slotIndex: number;
  title?: string;
  /** Real Add Song destination that claims this exact purchase space. */
  actionHref?: string | null;
}

export type ProjectPageMusicItem = ProjectPageTrack | ProjectPageEmptySlot;

export interface ProjectPageData {
  project: {
    id: string;
    title: string;
    clientName: string | null;
    createdAtIso: string;
    lifecycleStatus?: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  };
  /** Allocated tracks and synthesized, unallocated purchase spaces. */
  tracks: ProjectPageMusicItem[];
}

export function isProjectPageEmptySlot(item: ProjectPageMusicItem): item is ProjectPageEmptySlot {
  return item.kind === "empty-slot";
}

export function isProjectPageTrack(item: ProjectPageMusicItem): item is ProjectPageTrack {
  return !isProjectPageEmptySlot(item);
}

export function latestVersionIdForProjectTrack(track: ProjectPageTrack): string | null {
  return track.latestVersionId === undefined ? track.id : track.latestVersionId;
}

export function isProjectPageTrackAudioDeleted(track: ProjectPageTrack): boolean {
  return track.audioDeletedAtIso != null && track.audioUrl === null;
}

export function isProjectPageTrackPlayable(track: ProjectPageTrack): boolean {
  return (
    track.audioDeletedAtIso == null &&
    track.audioUrl !== null &&
    latestVersionIdForProjectTrack(track) !== null
  );
}

function projectItemActionHref(
  actionHref: string | null | undefined,
  fallbackHref: string | undefined,
): string | undefined {
  // Explicit null is a fail-closed eligibility decision. Only callers that
  // omit the field inherit the project-level fallback.
  return actionHref === undefined ? fallbackHref : (actionHref ?? undefined);
}

export function projectKindFromVisibleSpaces(count: number): ProjectKind {
  return count <= 1 ? "SINGLE" : "ALBUM";
}

export function summarizeProjectMusic(items: ProjectPageMusicItem[]) {
  const tracks = items.filter(isProjectPageTrack);
  const playableTracks = tracks.filter(isProjectPageTrackPlayable);
  let lastUploadIso: string | null = null;
  let lastUploadMs = 0;
  for (const track of tracks) {
    if (!track.uploadedAtIso) continue;
    const uploadedAtMs = Date.parse(track.uploadedAtIso);
    if (Number.isFinite(uploadedAtMs) && uploadedAtMs > lastUploadMs) {
      lastUploadMs = uploadedAtMs;
      lastUploadIso = track.uploadedAtIso;
    }
  }
  return {
    kind: projectKindFromVisibleSpaces(items.length),
    visibleSpaceCount: items.length,
    allocatedSongCount: tracks.length,
    emptySpaceCount: items.length - tracks.length,
    playableTrackCount: playableTracks.length,
    totalDurationMs: sumDurations(tracks.map((track) => track.durationMs)),
    lastUploadIso,
  };
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
  artistStudioId,
  producerActionHref,
  extraBelow,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  data: ProjectPageData;
  role?: ProjectPageRole;
  artistStudioId?: string | undefined;
  /** Fallback for producer Add Song/upload actions; omitted means no fake CTA. */
  producerActionHref?: string;
  extraBelow?: React.ReactNode;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const nowPlaying = useNowPlaying();

  const gradient = useMemo(() => gradientForSeed(data.project.id), [data.project.id]);
  const summary = useMemo(() => summarizeProjectMusic(data.tracks), [data.tracks]);
  const { kind, totalDurationMs, lastUploadIso, visibleSpaceCount, allocatedSongCount } = summary;
  const allocatedTracks = useMemo(() => data.tracks.filter(isProjectPageTrack), [data.tracks]);
  const playableTracks = useMemo(
    () => allocatedTracks.filter(isProjectPageTrackPlayable),
    [allocatedTracks],
  );
  const hasDeletedAudioHistory = allocatedTracks.some(isProjectPageTrackAudioDeleted);
  const artistLabel = (data.project.clientName ?? "").trim() || "Unknown artist";
  const archivedLabel =
    data.project.lifecycleStatus === "completed"
      ? "Archived · Completed"
      : data.project.lifecycleStatus === "canceled"
        ? "Archived · Canceled"
        : null;

  // Build a PlayerTrack payload for a given row.
  function toPlayerTrack(t: ProjectPageTrack) {
    const versionId = latestVersionIdForProjectTrack(t);
    if (!versionId) return null;
    return {
      id: versionId,
      audioUrl: t.audioUrl,
      title: t.title,
      subtitle: `${artistLabel} · ${t.versionLabel ?? "No version"}`,
      durationMs: t.durationMs,
    };
  }

  function handlePlayTrack(t: ProjectPageTrack) {
    const playerTrack = toPlayerTrack(t);
    if (!isProjectPageTrackPlayable(t) || !t.audioUrl || !playerTrack) return;
    if (nowPlaying.trackId === playerTrack.id) {
      playerToggle();
      return;
    }
    playerPlay(playerTrack);
  }

  function handlePlayProject() {
    // "Play current track if it's in this project, else the first."
    const currentInProject = playableTracks.find(
      (track) => latestVersionIdForProjectTrack(track) === nowPlaying.trackId,
    );
    const target = currentInProject ?? playableTracks[0];
    if (!target) return;
    if (nowPlaying.trackId === latestVersionIdForProjectTrack(target)) {
      playerToggle();
      return;
    }
    handlePlayTrack(target);
  }

  function handleShuffle() {
    if (playableTracks.length === 0) return;
    const target = playableTracks[Math.floor(Math.random() * playableTracks.length)];
    if (target) handlePlayTrack(target);
  }

  // Whole project-play playing state (true when ANY track in the
  // project is currently playing — drives the hero play button glyph).
  const projectTrackIds = useMemo(
    () =>
      new Set(
        playableTracks
          .map(latestVersionIdForProjectTrack)
          .filter((id): id is string => id !== null),
      ),
    [playableTracks],
  );
  const projectIsPlaying =
    nowPlaying.playing && nowPlaying.trackId !== null && projectTrackIds.has(nowPlaying.trackId);

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
                ? [{ label: data.project.clientName }, { label: data.project.title }]
                : [{ label: data.project.title }]
            }
          />

          {/* Cover + meta — flex row from sm up, ends at bottom so the
              title baseline aligns with the cover's bottom edge. Below
              sm the row stacks: smaller cover on top, title below at a
              size that fits a phone (the side-by-side layout starved
              the title of width and clipped it). Hero elements reveal
              in a 4-step cascade so the page assembles visually rather
              than appearing as a single block. */}
          <div className="flex flex-col gap-5 pb-1.5 sm:flex-row sm:flex-wrap sm:items-end sm:gap-8">
            <div className="reveal-up reveal-up-delay-1">
              {/* Phone cover: no kind badge — at 132px the badge
                  ("ALBUM", 79px in Syne) collides with the wordmark,
                  and the kind eyebrow right below the cover already
                  says it. Two CSS-toggled covers keep the sm+ instance
                  byte-identical to the original. */}
              <ProjectCover
                seed={data.project.id}
                gradient={gradient}
                kind={null}
                showKind={false}
                wordmark
                shadow="hero"
                radius="18px"
                className="h-[132px] w-[132px] shrink-0 sm:hidden"
              />
              <ProjectCover
                seed={data.project.id}
                gradient={gradient}
                kind={kind}
                wordmark
                shadow="hero"
                radius="18px"
                className="hidden h-[232px] w-[232px] shrink-0 sm:block"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="reveal-up reveal-up-delay-2 flex flex-wrap items-center gap-2">
                <span
                  className="font-mono text-[10.5px] font-bold uppercase"
                  style={{
                    letterSpacing: "0.1em",
                    color: "rgba(255,255,255,0.78)",
                  }}
                >
                  {kind}
                </span>
                {archivedLabel ? (
                  <span className="inline-flex rounded-[var(--radius-sm)] border border-white/25 bg-white/12 px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.08em] text-white/90 uppercase backdrop-blur-sm">
                    {archivedLabel}
                  </span>
                ) : null}
              </div>
              {/* Font size moved from the inline style into classes so
                  it can shrink below sm: 32px fits a phone column and
                  long titles wrap to 2 lines instead of clipping. The
                  sm+ clamp is byte-identical to the old inline value —
                  capped lower than the original 76px max so the title
                  reads as bold without becoming a billboard. Apple
                  Music's album hero caps around 56–60px. */}
              <h1
                className="reveal-up reveal-up-delay-2 font-display mt-3 text-[32px] font-extrabold text-white sm:text-[length:clamp(36px,4.4vw,60px)]"
                style={{
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
                {artistLabel} · {String(visibleSpaceCount)} song space
                {visibleSpaceCount === 1 ? "" : "s"} ·{" "}
                <span className="font-mono tabular-nums">{fmtDuration(totalDurationMs)}</span>
              </p>
            </div>
          </div>

          {/* Action row */}
          <div className="reveal-up reveal-up-delay-4 mt-6 flex flex-wrap items-center gap-3.5">
            {playableTracks.length > 0 ? (
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
            ) : (
              <span
                role="status"
                className="inline-flex min-h-10 items-center rounded-[var(--radius-lg)] border border-white/30 bg-white/12 px-3 text-[11.5px] font-bold text-white backdrop-blur-sm"
              >
                {hasDeletedAudioHistory
                  ? "No playable audio — history kept"
                  : "Audio has not been uploaded yet"}
              </span>
            )}
            {playableTracks.length > 0 ? (
              <CircleIconButton ariaLabel="Shuffle" title="Shuffle play" onClick={handleShuffle}>
                <Shuffle size={16} strokeWidth={2.2} />
              </CircleIconButton>
            ) : null}
            {role === "producer" && producerActionHref ? (
              <Link
                href={producerActionHref}
                className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] border border-white/30 bg-white/12 px-4 text-[12px] font-bold text-white backdrop-blur-sm"
              >
                <Plus size={14} strokeWidth={2.4} />
                {kind === "SINGLE" && allocatedSongCount === 1 ? "Add another song" : "Add Song"}
              </Link>
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
          <EmptyTracklist role={role} producerActionHref={producerActionHref} />
        ) : (
          <>
            <Tracklist
              items={data.tracks}
              projectId={data.project.id}
              nowPlayingId={nowPlaying.trackId}
              isPlaying={nowPlaying.playing}
              onPlay={handlePlayTrack}
              role={role}
              artistStudioId={artistStudioId}
              producerActionHref={producerActionHref}
              {...(renameSong ? { renameSong } : {})}
              {...(editArtist ? { editArtist } : {})}
              {...(setArchived ? { setArchived } : {})}
              {...(markReleased ? { markReleased } : {})}
            />
            <footer
              className="mt-7 flex flex-col gap-1 pt-4 font-mono text-[11.5px] text-[rgb(var(--fg-muted))]"
              style={{ borderTop: "1px solid rgb(var(--border-subtle))" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-bold text-[rgb(var(--fg-default))] tabular-nums">
                    {String(visibleSpaceCount)}
                  </span>{" "}
                  song space{visibleSpaceCount === 1 ? "" : "s"} ·{" "}
                  <span className="tabular-nums">{fmtDuration(totalDurationMs)}</span>
                </span>
                <span className="truncate">{artistLabel}</span>
              </div>
              {(() => {
                const meta = formatProjectFooter({
                  createdAtIso: data.project.createdAtIso,
                  lastUploadIso,
                });
                return meta ? (
                  <div className="text-[10.5px] text-[rgb(var(--fg-faint))]">{meta}</div>
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

function CircleIconButton({
  ariaLabel,
  title,
  onClick,
  children,
}: {
  ariaLabel: string;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      onClick={onClick}
      className="sk-press sk-trans inline-flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-white hover:bg-white/12"
      style={{ border: "1px solid rgba(255,255,255,0.92)" }}
    >
      {children}
    </button>
  );
}

function Tracklist({
  items,
  projectId,
  nowPlayingId,
  isPlaying,
  onPlay,
  role,
  artistStudioId,
  producerActionHref,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  items: ProjectPageMusicItem[];
  projectId: string;
  nowPlayingId: string | null;
  isPlaying: boolean;
  onPlay: (t: ProjectPageTrack) => void;
  role: ProjectPageRole;
  artistStudioId: string | undefined;
  producerActionHref: string | undefined;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const cols = "44px minmax(0,1fr) 86px 60px 72px 96px";
  return (
    <>
      {/* Header eyebrow row — desktop only. Below lg the fixed px
          columns outgrow a phone viewport, so the whole table (header
          + grid rows) is lg+ and phones get the compact list rows
          rendered at the end. */}
      <div
        className="grid items-center gap-3 px-4 pb-2 text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase max-lg:hidden"
        style={{
          gridTemplateColumns: cols,
          borderBottom: "1px solid rgb(var(--border-subtle))",
        }}
      >
        <span className="text-right">#</span>
        <span>Title</span>
        <span>Version</span>
        <span className="text-right">Notes</span>
        <span className="flex justify-end">
          <Clock3 size={11} strokeWidth={2} />
        </span>
        <span aria-hidden />
      </div>
      <ul role="list" className="max-lg:hidden">
        {items.map((item, index) => (
          <ProjectMusicDesktopRow
            key={item.id}
            item={item}
            index={index}
            cols={cols}
            projectId={projectId}
            nowPlayingId={nowPlayingId}
            isPlaying={isPlaying}
            onPlay={onPlay}
            role={role}
            artistStudioId={artistStudioId}
            producerActionHref={producerActionHref}
            {...(renameSong ? { renameSong } : {})}
            {...(editArtist ? { editArtist } : {})}
            {...(setArchived ? { setArchived } : {})}
            {...(markReleased ? { markReleased } : {})}
          />
        ))}
      </ul>

      {/* Mobile/tablet (below lg): compact list rows. Same Link target
          and onPlay handler as the table rows — the always-visible
          44px play circle replaces the hover-reveal index swap (no
          hover on touch). Title + version chip + duration (mono). */}
      <ul role="list" className="lg:hidden">
        {items.map((item, index) => (
          <ProjectMusicMobileRow
            key={item.id}
            item={item}
            index={index}
            projectId={projectId}
            nowPlayingId={nowPlayingId}
            isPlaying={isPlaying}
            onPlay={onPlay}
            role={role}
            artistStudioId={artistStudioId}
            producerActionHref={producerActionHref}
            {...(renameSong ? { renameSong } : {})}
            {...(editArtist ? { editArtist } : {})}
            {...(setArchived ? { setArchived } : {})}
            {...(markReleased ? { markReleased } : {})}
          />
        ))}
      </ul>
    </>
  );
}

function projectSongHref(
  role: ProjectPageRole,
  versionId: string,
  projectId: string,
  artistStudioId?: string,
): string {
  return role === "producer"
    ? `/dashboard/music/${versionId}?from=${projectId}`
    : withArtistStudio(`/artist/music/song/${versionId}`, artistStudioId);
}

function ProjectMusicDesktopRow({
  item,
  index,
  cols,
  projectId,
  nowPlayingId,
  isPlaying,
  onPlay,
  role,
  artistStudioId,
  producerActionHref,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  item: ProjectPageMusicItem;
  index: number;
  cols: string;
  projectId: string;
  nowPlayingId: string | null;
  isPlaying: boolean;
  onPlay: (track: ProjectPageTrack) => void;
  role: ProjectPageRole;
  artistStudioId: string | undefined;
  producerActionHref: string | undefined;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: cols,
    borderRadius: 12,
    transition: "background-color 140ms ease-out",
  };

  if (isProjectPageEmptySlot(item)) {
    const actionHref = projectItemActionHref(item.actionHref, producerActionHref);
    return (
      <li
        className="sk-stagger-item"
        data-project-music-row="empty-slot"
        style={{ "--i": String(index) } as React.CSSProperties}
      >
        <div
          role="group"
          aria-label={`${item.title?.trim() || `Song space ${String(item.slotIndex)}`}, empty purchased song space`}
          className="grid items-center gap-3 px-4 py-2.5"
          style={rowStyle}
        >
          <span className="flex justify-end font-mono text-[11px] text-[rgb(var(--fg-faint))] tabular-nums">
            {padIndex(index)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-faint))]">
                <AudioLines size={14} strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] leading-tight font-bold text-[rgb(var(--fg-default))]">
                  {item.title?.trim() || `Song space ${String(item.slotIndex)}`}
                </span>
                <span className="block truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
                  {role === "producer"
                    ? "Purchased space ready for a song"
                    : "Waiting for your producer"}
                </span>
              </span>
            </span>
          </span>
          <span className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
            Empty
          </span>
          <span />
          <span className="flex justify-end font-mono text-[9px] text-[rgb(var(--fg-faint))] uppercase">
            No audio
          </span>
          <span className="flex justify-end">
            {role === "producer" && actionHref ? (
              <Link
                href={actionHref}
                aria-label="Add song to this purchased space"
                className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
              >
                <Plus size={14} strokeWidth={2.4} />
              </Link>
            ) : null}
          </span>
        </div>
      </li>
    );
  }

  const versionId = latestVersionIdForProjectTrack(item);
  const songArchived = item.archivedAtIso !== null;
  const songReleased = item.releasedAtIso != null;
  const audioDeleted = isProjectPageTrackAudioDeleted(item);
  const canPlay = isProjectPageTrackPlayable(item);
  const current = canPlay && nowPlayingId === versionId;
  const playingHere = current && isPlaying;
  const rowHref = versionId
    ? projectSongHref(role, versionId, projectId, artistStudioId)
    : null;
  const actionHref = projectItemActionHref(item.actionHref, producerActionHref);
  return (
    <li
      className="sk-stagger-item"
      data-project-music-row={canPlay ? "allocated-playable" : "allocated-no-audio"}
      style={{ "--i": String(index) } as React.CSSProperties}
    >
      <div
        role="group"
        aria-label={
          canPlay
            ? `${item.title}, playable song`
            : audioDeleted
              ? `${item.title}, audio deleted, history kept`
              : `${item.title}, awaiting audio`
        }
        className={[
          "group relative grid items-center gap-3 px-4 py-2.5",
          current ? "bg-[rgb(var(--brand-primary)/0.06)]" : "",
        ].join(" ")}
        style={rowStyle}
      >
        {rowHref ? (
          <Link
            href={rowHref}
            aria-label={`Open ${item.title} song page`}
            className="absolute inset-0 z-0 rounded-[12px] transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
          />
        ) : null}
        <span className="relative z-10 flex justify-end">
          {canPlay ? (
            <button
              type="button"
              aria-label={playingHere ? "Pause" : "Play"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onPlay(item);
              }}
              className={[
                "sk-press sk-trans inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]",
                current
                  ? "skitza-playing-glow bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
                  : "bg-[rgb(var(--fg-default))] text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
              ].join(" ")}
            >
              {playingHere ? (
                <EqBars playing size={11} />
              ) : (
                <Play size={11} strokeWidth={2.6} fill="currentColor" />
              )}
            </button>
          ) : null}
          <span
            aria-hidden
            className={[
              "pointer-events-none absolute font-mono text-[11px] text-[rgb(var(--fg-faint))] tabular-nums",
              canPlay && current ? "opacity-0" : "",
              canPlay ? "group-focus-within:opacity-0 group-hover:opacity-0" : "",
            ].join(" ")}
            style={{ width: 44, textAlign: "right", lineHeight: "44px" }}
          >
            {padIndex(index)}
          </span>
        </span>
        <span className="pointer-events-none relative z-10 block min-w-0">
          <span className="block truncate text-[14px] leading-tight font-bold text-[rgb(var(--fg-default))]">
            {item.title}
          </span>
          <span className="truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
            {canPlay
              ? (item.artist ?? "")
              : audioDeleted
                ? "No playable audio — history kept"
                : role === "producer"
                  ? "Allocated song, ready for the first upload"
                  : "Waiting for your producer"}
          </span>
          {songArchived ? (
            <span className="block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Archived
            </span>
          ) : null}
          {songReleased ? (
            <span className="block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-success))] uppercase">
              Released
            </span>
          ) : null}
        </span>
        <span className="pointer-events-none relative z-10 font-mono text-[9.5px] font-bold text-[rgb(var(--fg-default))] uppercase">
          {item.versionLabel ?? "No version"}
        </span>
        <span
          className={[
            "pointer-events-none relative z-10 text-right font-mono text-[11px] tabular-nums",
            item.unreadComments > 0
              ? "font-bold text-[rgb(var(--brand-primary-dark))]"
              : "text-[rgb(var(--fg-faint))]",
          ].join(" ")}
        >
          {fmtCount(item.unreadComments)}
        </span>
        <span className="pointer-events-none relative z-10 flex justify-end font-mono text-[10px] text-[rgb(var(--fg-muted))] tabular-nums">
          {canPlay ? fmtDuration(item.durationMs) : audioDeleted ? "Audio deleted" : "No audio"}
        </span>
        <span className="relative z-20 flex justify-end gap-1.5">
          {!canPlay && role === "producer" && !songArchived && actionHref ? (
            <Link
              href={actionHref}
              aria-label={`Upload audio for ${item.title}`}
              className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
            >
              <Plus size={14} strokeWidth={2.4} />
            </Link>
          ) : null}
          {role === "producer" && renameSong && editArtist && setArchived ? (
            <SongManagementControls
              projectId={projectId}
              trackId={item.trackId}
              title={item.title}
              artist={item.artist}
              archived={songArchived}
              {...(item.releasedAtIso === undefined ? {} : { releasedAtIso: item.releasedAtIso })}
              renameSong={renameSong}
              editArtist={editArtist}
              setArchived={setArchived}
              {...(markReleased ? { markReleased } : {})}
            />
          ) : null}
        </span>
      </div>
    </li>
  );
}

function ProjectMusicMobileRow({
  item,
  index,
  projectId,
  nowPlayingId,
  isPlaying,
  onPlay,
  role,
  artistStudioId,
  producerActionHref,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  item: ProjectPageMusicItem;
  index: number;
  projectId: string;
  nowPlayingId: string | null;
  isPlaying: boolean;
  onPlay: (track: ProjectPageTrack) => void;
  role: ProjectPageRole;
  artistStudioId: string | undefined;
  producerActionHref: string | undefined;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const rowStyle: React.CSSProperties = {
    borderRadius: 12,
    transition: "background-color 140ms ease-out",
  };

  if (isProjectPageEmptySlot(item)) {
    const actionHref = projectItemActionHref(item.actionHref, producerActionHref);
    return (
      <li
        className="sk-stagger-item"
        data-project-music-row="empty-slot"
        style={{ "--i": String(index) } as React.CSSProperties}
      >
        <div
          role="group"
          aria-label={`${item.title?.trim() || `Song space ${String(item.slotIndex)}`}, empty purchased song space`}
          className="flex min-h-[64px] items-center gap-3 px-2 py-2"
          style={rowStyle}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-faint))]">
            <AudioLines size={17} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] leading-tight font-bold text-[rgb(var(--fg-default))]">
              {item.title?.trim() || `Song space ${String(item.slotIndex)}`}
            </span>
            <span className="block truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
              {role === "producer" ? "Purchased space" : "Waiting for your producer"}
            </span>
          </span>
          {role === "producer" && actionHref ? (
            <Link
              href={actionHref}
              className="sk-press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))]"
            >
              <Plus size={12} strokeWidth={2.4} />
              Add Song
            </Link>
          ) : null}
        </div>
      </li>
    );
  }

  const versionId = latestVersionIdForProjectTrack(item);
  const songArchived = item.archivedAtIso !== null;
  const songReleased = item.releasedAtIso != null;
  const audioDeleted = isProjectPageTrackAudioDeleted(item);
  const canPlay = isProjectPageTrackPlayable(item);
  const current = canPlay && nowPlayingId === versionId;
  const playingHere = current && isPlaying;
  const rowHref = versionId
    ? projectSongHref(role, versionId, projectId, artistStudioId)
    : null;
  const actionHref = projectItemActionHref(item.actionHref, producerActionHref);
  return (
    <li
      className="sk-stagger-item"
      data-project-music-row={canPlay ? "allocated-playable" : "allocated-no-audio"}
      style={{ "--i": String(index) } as React.CSSProperties}
    >
      <div
        role="group"
        aria-label={
          canPlay
            ? `${item.title}, playable song`
            : audioDeleted
              ? `${item.title}, audio deleted, history kept`
              : `${item.title}, awaiting audio`
        }
        className={[
          "group relative flex min-h-[64px] items-center gap-3 px-2 py-2",
          current ? "bg-[rgb(var(--brand-primary)/0.06)]" : "",
        ].join(" ")}
        style={rowStyle}
      >
        {rowHref ? (
          <Link
            href={rowHref}
            aria-label={`Open ${item.title} song page`}
            className="absolute inset-0 z-0 rounded-[12px] transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset active:bg-[rgb(var(--bg-overlay))]"
          />
        ) : null}
        {canPlay ? (
          <button
            type="button"
            aria-label={playingHere ? "Pause" : "Play"}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPlay(item);
            }}
            className={[
              "sk-press relative z-20 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
              current
                ? "skitza-playing-glow bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
                : "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]",
            ].join(" ")}
          >
            {playingHere ? (
              <EqBars playing size={13} />
            ) : (
              <Play size={14} strokeWidth={2.6} fill="currentColor" />
            )}
          </button>
        ) : (
          <span className="pointer-events-none relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-faint))]">
            <AudioLines size={17} strokeWidth={1.8} />
          </span>
        )}
        <span className="pointer-events-none relative z-10 min-w-0 flex-1">
          <span className="block truncate text-[14px] leading-tight font-bold text-[rgb(var(--fg-default))]">
            {item.title}
          </span>
          <span className="truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
            {canPlay
              ? (item.artist ?? "")
              : audioDeleted
                ? "No playable audio — history kept"
                : role === "producer"
                  ? "Ready for the first upload"
                  : "Waiting for your producer"}
          </span>
          {songArchived ? (
            <span className="block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Archived
            </span>
          ) : null}
          {songReleased ? (
            <span className="block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-success))] uppercase">
              Released
            </span>
          ) : null}
        </span>
        {canPlay ? (
          <>
            <span className="pointer-events-none relative z-10 hidden shrink-0 rounded-[6px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[rgb(var(--fg-default))] uppercase min-[480px]:inline-flex">
              {item.versionLabel ?? "Mix"}
            </span>
            <span className="pointer-events-none relative z-10 hidden shrink-0 font-mono text-[11px] text-[rgb(var(--fg-muted))] tabular-nums min-[480px]:inline">
              {fmtDuration(item.durationMs)}
            </span>
          </>
        ) : role === "producer" && !songArchived && actionHref ? (
          <Link
            href={actionHref}
            className="sk-press relative z-20 inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))]"
          >
            Upload
          </Link>
        ) : null}
        {role === "producer" && renameSong && editArtist && setArchived ? (
          <SongManagementControls
            projectId={projectId}
            trackId={item.trackId}
            title={item.title}
            artist={item.artist}
            archived={songArchived}
            {...(item.releasedAtIso === undefined ? {} : { releasedAtIso: item.releasedAtIso })}
            renameSong={renameSong}
            editArtist={editArtist}
            setArchived={setArchived}
            {...(markReleased ? { markReleased } : {})}
          />
        ) : null}
      </div>
    </li>
  );
}

function EmptyTracklist({
  role,
  producerActionHref,
}: {
  role: ProjectPageRole;
  producerActionHref: string | undefined;
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
          ? "Add a purchased song space before uploading its first version."
          : "Once your producer adds a song, it will show up here."}
      </p>
      {role === "producer" && producerActionHref ? (
        <Link
          href={producerActionHref}
          className="sk-press mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3.5 py-2 text-[12.5px] font-bold text-[rgb(var(--fg-default))]"
        >
          <Plus size={13} strokeWidth={2.4} />
          Add Song
        </Link>
      ) : null}
    </div>
  );
}
