"use client";

import { AudioLines, ChevronDown, Disc3, Grid3x3, List, Play, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EqBars } from "~/components/audio/eq-bars";
import { playerPlay, playerToggle, useNowPlaying } from "~/components/audio/persistent-player";
import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { withArtistStudio } from "~/lib/artist-studio-context";

import { ProjectCover } from "./project-cover";
import {
  SongManagementControls,
  type EditSongArtistAction,
  type MarkSongReleasedAction,
  type RenameSongAction,
  type SetSongArchivedAction,
} from "./song-management-controls";
import {
  fmtCount,
  fmtDuration,
  gradientForSeed,
  padIndex,
  sumDurations,
  type GradientClass,
  type ProjectKind,
} from "./lib";

// ─── Wire types ──────────────────────────────────────────────────────
export type MusicProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export function archivedProjectLabel(
  status: MusicProjectLifecycleStatus | undefined,
): "Archived · Completed" | "Archived · Canceled" | null {
  if (status === "completed") return "Archived · Completed";
  if (status === "canceled") return "Archived · Canceled";
  return null;
}

interface MusicLibraryItemBase {
  id: string;
  producerId?: string;
  projectId: string;
  projectTitle: string;
  projectLifecycleStatus?: MusicProjectLifecycleStatus;
  clientName: string | null;
}

// An allocated song is stable even before its first version exists. Older
// callers can omit `kind` and `latestVersionId`: in that compatibility shape
// `id` is still treated as the latest version id. New callers should use a
// stable row id (normally the track id) and set `latestVersionId` explicitly,
// including `null` for a zero-version song.
export interface MusicLibraryTrackRow extends MusicLibraryItemBase {
  kind?: "track";
  trackId: string;
  trackTitle: string;
  trackArtist: string | null;
  archivedAtIso: string | null;
  releasedAtIso?: string | null;
  /** Explicit tombstone for an intentionally deleted stored-audio object. */
  audioDeletedAtIso?: string | null;
  label: string | null;
  latestVersionId?: string | null;
  uploadedAtIso: string | null;
  audioUrl: string | null;
  durationMs: number | null;
  unreadComments: number;
  plays: number;
  /** A real upload/add-version destination for a zero-audio song. */
  actionHref?: string | null;
}

// A purchased but unallocated entitlement. It is a view model only: there is
// no track id, version id, play action, or song-page link until allocation.
export interface MusicLibraryEmptySlotRow extends MusicLibraryItemBase {
  kind: "empty-slot";
  purchaseId: string;
  slotIndex: number;
  trackTitle?: string;
  trackArtist?: string | null;
  /** A real Add Song destination that claims this exact entitlement. */
  actionHref?: string | null;
}

export type MusicLibraryRow = MusicLibraryTrackRow | MusicLibraryEmptySlotRow;

// Optional project-level rows let artist libraries keep projects with no
// playable versions visible. Producer callers can continue deriving projects
// entirely from the track list.
export interface MusicLibraryProjectRow {
  id: string;
  producerId?: string;
  title: string;
  artistLabel: string;
  /** Total allocated songs plus synthesized empty entitlements. */
  visibleSpaceCount?: number;
  /** Backward-compatible alias; interpreted as visible-space count. */
  trackCount?: number;
  playableTrackCount?: number;
  projectLifecycleStatus?: MusicProjectLifecycleStatus;
  latestTrackUploadedAtIso: string | null;
}

// One row per PROJECT, combined client-side from project metadata and tracks.
export interface ProjectAggregate {
  id: string;
  producerId: string | undefined;
  title: string;
  artistLabel: string;
  trackCount: number;
  durationMs: number;
  kind: ProjectKind;
  gradient: GradientClass;
  unreadComments: number;
  playableTrackCount: number;
  projectLifecycleStatus: MusicProjectLifecycleStatus | undefined;
  latestTrackUploadedAtIso: string | null;
}

type Mode = "projects" | "songs";
type View = "grid" | "table";
type SongSort = "recent" | "title" | "notes" | "length";
type ProjectArchiveFilter = "active" | "archived";
export type SongArchiveFilter = "active" | "archived";

const MUSIC_LIBRARY_MODES = ["projects", "songs"] as const;

export interface MusicLibraryUrlState {
  mode: Mode;
  view: View;
  search: string;
  sort: SongSort;
  archive: "active" | "archived";
}

function enumerated<T extends string>(
  value: string | null,
  values: readonly T[],
  fallback: T,
): T {
  return value !== null && values.includes(value as T) ? (value as T) : fallback;
}

export function parseMusicLibraryUrlState(search: string): MusicLibraryUrlState {
  const params = new URLSearchParams(search);
  return {
    mode: enumerated(params.get("mode"), ["projects", "songs"], "songs"),
    view: enumerated(params.get("view"), ["grid", "table"], "grid"),
    search: (params.get("search") ?? "").slice(0, 120),
    sort: enumerated(params.get("sort"), ["recent", "title", "notes", "length"], "recent"),
    archive: enumerated(params.get("filter"), ["active", "archived"], "active"),
  };
}

const SORT_LABEL: Record<SongSort, string> = {
  recent: "Most recent",
  title: "Title A → Z",
  notes: "Most notes",
  length: "Length",
};

export function isMusicLibraryEmptySlot(row: MusicLibraryRow): row is MusicLibraryEmptySlotRow {
  return row.kind === "empty-slot";
}

export function isMusicLibraryTrack(row: MusicLibraryRow): row is MusicLibraryTrackRow {
  return !isMusicLibraryEmptySlot(row);
}

export function filterMusicRowsBySongArchive(
  rows: MusicLibraryRow[],
  filter: SongArchiveFilter,
): MusicLibraryRow[] {
  return rows.filter((row) => {
    if (isMusicLibraryEmptySlot(row)) return filter === "active";
    const archived = row.archivedAtIso !== null;
    return filter === "archived" ? archived : !archived;
  });
}

function rowActionHref(actionHref: string | null | undefined, fallbackHref: string): string | null {
  // Undefined is the legacy "use the screen fallback" shape. Explicit null
  // means the exact project/purchase is not eligible for new work.
  return actionHref === undefined ? fallbackHref : actionHref;
}

/** One purchased space is a single; adding any second space makes an album. */
export function kindFromVisibleSpaceCount(count: number): ProjectKind {
  return count <= 1 ? "SINGLE" : "ALBUM";
}

export function latestVersionIdForLibraryTrack(row: MusicLibraryTrackRow): string | null {
  return row.latestVersionId === undefined ? row.id : row.latestVersionId;
}

export function isMusicLibraryTrackAudioDeleted(row: MusicLibraryTrackRow): boolean {
  return row.audioDeletedAtIso != null && row.audioUrl === null;
}

export function isMusicLibraryTrackPlayable(row: MusicLibraryTrackRow): boolean {
  return (
    row.audioDeletedAtIso == null &&
    row.audioUrl !== null &&
    latestVersionIdForLibraryTrack(row) !== null
  );
}

function rowTitle(row: MusicLibraryRow): string {
  if (isMusicLibraryTrack(row)) return row.trackTitle;
  return row.trackTitle?.trim() || `Song space ${String(row.slotIndex)}`;
}

function rowArtist(row: MusicLibraryRow): string | null {
  return row.trackArtist ?? row.clientName ?? null;
}

function uploadedAtMs(row: MusicLibraryRow): number {
  if (!isMusicLibraryTrack(row) || !row.uploadedAtIso) return 0;
  const parsed = Date.parse(row.uploadedAtIso);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function aggregateMusicProjects(
  rows: MusicLibraryRow[],
  explicitProjects: MusicLibraryProjectRow[] = [],
): ProjectAggregate[] {
  const byId = new Map<
    string,
    ProjectAggregate & { rows: MusicLibraryRow[]; minimumVisibleSpaceCount: number }
  >();

  for (const project of explicitProjects) {
    const visibleSpaceCount = project.visibleSpaceCount ?? project.trackCount ?? 0;
    byId.set(project.id, {
      id: project.id,
      producerId: project.producerId,
      title: project.title,
      artistLabel: project.artistLabel,
      trackCount: visibleSpaceCount,
      minimumVisibleSpaceCount: visibleSpaceCount,
      durationMs: 0,
      kind: kindFromVisibleSpaceCount(visibleSpaceCount),
      gradient: gradientForSeed(project.id),
      unreadComments: 0,
      playableTrackCount: project.playableTrackCount ?? 0,
      projectLifecycleStatus: project.projectLifecycleStatus,
      latestTrackUploadedAtIso: project.latestTrackUploadedAtIso,
      rows: [],
    });
  }

  for (const row of rows) {
    let aggregate = byId.get(row.projectId);
    if (!aggregate) {
      aggregate = {
        id: row.projectId,
        producerId: row.producerId,
        title: row.projectTitle,
        artistLabel: rowArtist(row)?.trim() ?? "",
        trackCount: 0,
        minimumVisibleSpaceCount: 0,
        durationMs: 0,
        kind: "SINGLE",
        gradient: gradientForSeed(row.projectId),
        unreadComments: 0,
        playableTrackCount: 0,
        projectLifecycleStatus: row.projectLifecycleStatus,
        latestTrackUploadedAtIso: null,
        rows: [],
      };
      byId.set(row.projectId, aggregate);
    }
    aggregate.rows.push(row);
  }

  const projects: ProjectAggregate[] = [];
  for (const aggregate of byId.values()) {
    const tracks = aggregate.rows.filter(isMusicLibraryTrack);
    const trackCount = Math.max(aggregate.minimumVisibleSpaceCount, aggregate.rows.length);
    const newestRow = tracks.reduce<MusicLibraryTrackRow | null>((newest, track) => {
      if (!newest || uploadedAtMs(track) > uploadedAtMs(newest)) return track;
      return newest;
    }, null);
    projects.push({
      id: aggregate.id,
      producerId: aggregate.producerId,
      title: aggregate.title,
      artistLabel: aggregate.artistLabel,
      trackCount,
      durationMs: sumDurations(tracks.map((track) => track.durationMs)),
      kind: kindFromVisibleSpaceCount(trackCount),
      gradient: aggregate.gradient,
      unreadComments: tracks.reduce((total, track) => total + track.unreadComments, 0),
      playableTrackCount: Math.max(
        aggregate.playableTrackCount,
        tracks.filter(isMusicLibraryTrackPlayable).length,
      ),
      projectLifecycleStatus: aggregate.projectLifecycleStatus,
      latestTrackUploadedAtIso:
        aggregate.latestTrackUploadedAtIso ?? newestRow?.uploadedAtIso ?? null,
    });
  }

  projects.sort((a, b) => {
    const at = a.latestTrackUploadedAtIso ? Date.parse(a.latestTrackUploadedAtIso) : 0;
    const bt = b.latestTrackUploadedAtIso ? Date.parse(b.latestTrackUploadedAtIso) : 0;
    return bt - at;
  });
  return projects;
}

// ─── Public component ────────────────────────────────────────────────

// Which side of the app is rendering this screen. The producer view is
// the original — it owns Upload + artist-filter chrome and links into
// the /dashboard tree. The artist view shares the layout pixel-for-
// pixel but hides producer-only actions and routes into /artist/* URLs.
// Default = "producer" so existing call-sites that don't pass a role
// behave unchanged.
export type MusicLibraryRole = "producer" | "artist";

// Internal href builders centralised here (instead of inlined per-cell)
// so the URL switch lives in ONE place. Each side now has its own
// L2 + L3 route (SK-30 added the artist L3).
function projectHref(
  role: MusicLibraryRole,
  projectId: string,
  producerId?: string,
): string {
  return role === "producer"
    ? `/dashboard/music/project/${projectId}`
    : withArtistStudio(`/artist/music/${projectId}`, producerId);
}
function songHref(role: MusicLibraryRole, songId: string, producerId?: string): string {
  return role === "producer"
    ? `/dashboard/music/${songId}`
    : withArtistStudio(`/artist/music/song/${songId}`, producerId);
}

export function MusicLibraryScreen({
  tracks,
  projectRows: explicitProjects = [],
  role = "producer",
  addSongHref = "/dashboard/music?addSong=1",
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  tracks: MusicLibraryRow[];
  projectRows?: MusicLibraryProjectRow[];
  role?: MusicLibraryRole;
  /** Producer Add Song entry point; also used by producer empty states. */
  addSongHref?: string;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlState = parseMusicLibraryUrlState(searchParams.toString());
  // "all" is the sentinel for "no artist filter" — any other string is
  // a literal client/artist name from the artist filter pill.
  const [mode, setMode] = useState<Mode>(urlState.mode);
  const [view, setView] = useState<View>(urlState.view);
  const [search, setSearch] = useState(urlState.search);
  const [artist, setArtist] = useState<string>("all");
  const [sort, setSort] = useState<SongSort>(urlState.sort);
  const [projectArchiveFilter, setProjectArchiveFilter] =
    useState<ProjectArchiveFilter>(urlState.archive);
  const [songArchiveFilter, setSongArchiveFilter] =
    useState<SongArchiveFilter>(urlState.archive);

  useEffect(() => {
    const next = parseMusicLibraryUrlState(searchParams.toString());
    setMode(next.mode);
    setView(next.view);
    setSearch(next.search);
    setSort(next.sort);
    setProjectArchiveFilter(next.archive);
    setSongArchiveFilter(next.archive);
  }, [searchParams]);

  function replaceUrlState(
    key: "mode" | "view" | "search" | "sort" | "filter",
    value: string,
    defaultValue: string,
  ) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete(key);
    else params.set(key, value.slice(0, 120));
    const query = params.toString();
    window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
  }

  function updateMode(next: Mode) {
    setMode(next);
    replaceUrlState("mode", next, "songs");
  }

  const modeSwipeHandlers = useTabSwipe({
    items: MUSIC_LIBRARY_MODES,
    value: mode,
    onChange: updateMode,
  });

  function updateView(next: View) {
    setView(next);
    replaceUrlState("view", next, "grid");
  }

  function updateSearch(next: string) {
    const bounded = next.slice(0, 120);
    setSearch(bounded);
    replaceUrlState("search", bounded, "");
  }

  function updateSort(next: SongSort) {
    setSort(next);
    replaceUrlState("sort", next, "recent");
  }

  function updateProjectArchiveFilter(next: ProjectArchiveFilter) {
    setProjectArchiveFilter(next);
    replaceUrlState("filter", next, "active");
  }

  function updateSongArchiveFilter(next: SongArchiveFilter) {
    setSongArchiveFilter(next);
    replaceUrlState("filter", next, "active");
  }

  // Unique client/artist names for the filter pill. Order by first
  // appearance so the most-recently-uploaded clients sit near the top.
  const artistOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tracks) {
      const name = (rowArtist(t) ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }, [tracks]);

  // Apply search + artist filter to the raw track list. Reused for the
  // Songs view directly and as the substrate for project aggregation.
  const filteredTracks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks.filter((t) => {
      if (artist !== "all") {
        const name = (rowArtist(t) ?? "").trim();
        if (name !== artist) return false;
      }
      if (!q) return true;
      const hay = [rowTitle(t), rowArtist(t) ?? "", t.projectTitle].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [tracks, search, artist]);

  const filteredExplicitProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return explicitProjects.filter((project) => {
      if (artist !== "all" && project.artistLabel !== artist) return false;
      if (!q) return true;
      return `${project.title} ${project.artistLabel}`.toLowerCase().includes(q);
    });
  }, [explicitProjects, search, artist]);

  // Project aggregation — one entry per projectId, with track count,
  // total duration, kind, and a stable gradient picked by hashing the
  // projectId so the same project always lands on the same palette.
  const projects = useMemo<ProjectAggregate[]>(() => {
    return aggregateMusicProjects(filteredTracks, filteredExplicitProjects);
  }, [filteredExplicitProjects, filteredTracks]);

  const visibleProjects = useMemo(() => {
    if (role !== "artist") return projects;
    return projects.filter((project) => {
      const archived = archivedProjectLabel(project.projectLifecycleStatus) !== null;
      return projectArchiveFilter === "archived" ? archived : !archived;
    });
  }, [projectArchiveFilter, projects, role]);

  // Song archive is deliberately a second-level filter. Project
  // aggregation above always receives every matching song so archiving one
  // song can never hide or archive its project.
  const visibleSongs = useMemo(() => {
    if (role !== "producer") return filteredTracks;
    return filterMusicRowsBySongArchive(filteredTracks, songArchiveFilter);
  }, [filteredTracks, role, songArchiveFilter]);

  // Header counts — surface the raw-tracks totals, not the filtered
  // version, so the meta line reads as a stable library summary.
  const totalTracks = tracks.length;
  const totalProjects = useMemo(() => {
    const seen = new Set<string>();
    for (const project of explicitProjects) seen.add(project.id);
    for (const t of tracks) seen.add(t.projectId);
    return seen.size;
  }, [explicitProjects, tracks]);
  const totalUnread = useMemo(
    () =>
      tracks.reduce((total, row) => total + (isMusicLibraryTrack(row) ? row.unreadComments : 0), 0),
    [tracks],
  );

  // Sort songs only when the songs table is showing (per design.md the
  // sort dropdown disappears in grid view).
  const sortedSongs = useMemo(() => {
    if (mode !== "songs" || view !== "table") return visibleSongs;
    const arr = [...visibleSongs];
    switch (sort) {
      case "title":
        arr.sort((a, b) => rowTitle(a).localeCompare(rowTitle(b)));
        break;
      case "notes":
        arr.sort(
          (a, b) =>
            (isMusicLibraryTrack(b) ? b.unreadComments : 0) -
            (isMusicLibraryTrack(a) ? a.unreadComments : 0),
        );
        break;
      case "length":
        arr.sort(
          (a, b) =>
            (isMusicLibraryTrack(b) ? (b.durationMs ?? 0) : 0) -
            (isMusicLibraryTrack(a) ? (a.durationMs ?? 0) : 0),
        );
        break;
      case "recent":
      default:
        arr.sort((a, b) => uploadedAtMs(b) - uploadedAtMs(a));
        break;
    }
    return arr;
  }, [mode, sort, view, visibleSongs]);

  return (
    <div className="sk-page-enter flex flex-col gap-5">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1
            className="font-display leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]"
            style={{ margin: 0, fontSize: "clamp(28px, 3.2vw, 38px)" }}
          >
            Library
            <span className="text-[rgb(var(--brand-primary-dark))]">.</span>
          </h1>
          <p className="mt-2 text-[12.5px] text-[rgb(var(--fg-muted))]">
            <span className="font-mono font-bold text-[rgb(var(--fg-default))] tabular-nums">
              {String(totalTracks)}
            </span>{" "}
            song space{totalTracks === 1 ? "" : "s"}
            {" · "}
            <span className="font-mono font-bold text-[rgb(var(--fg-default))] tabular-nums">
              {String(totalProjects)}
            </span>{" "}
            projects{" · "}
            {totalUnread > 0 ? (
              <span className="font-bold text-[rgb(var(--brand-primary-dark))]">
                {String(totalUnread)} with new notes
              </span>
            ) : (
              <span className="text-[rgb(var(--fg-success))]">all notes answered</span>
            )}
          </p>
        </div>
        {/* Add Song is producer-only. The caller owns the real workflow
            destination so this shared read model never invents a route. */}
        {role === "producer" ? (
          <Link
            href={addSongHref}
            className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-[15px] text-[12.5px] font-bold text-[rgb(var(--fg-default))] shadow-[0_2px_12px_rgb(var(--brand-primary)/0.22)]"
          >
            <Plus size={13} strokeWidth={2.4} />
            Add Song
          </Link>
        ) : null}
      </header>

      {/* Toolbar — fully-opaque elevated surface with a confident border
          so it reads as the lid of the library section, not a floating
          translucent strip. On phones (SK-55) the card chrome drops
          away and the controls re-flow into two tidy rows — search (+
          artist filter), then mode toggle left / sort + view right —
          the Spotify library pattern. md+ keeps the card exactly as
          designed (background/border moved from inline style to md:
          classes so the mobile reset can win). */}
      <div className="flex flex-wrap items-center gap-2 md:gap-2.5 md:rounded-[12px] md:border md:border-[rgb(var(--border-strong))] md:bg-[rgb(var(--bg-elevated))] md:px-3 md:py-2.5">
        {/* Search — focus-within ring brightens the pill so the
            keyboardable surface is visible without a heavy outline. */}
        <div
          className="sk-trans flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--bg-elevated))] px-3 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.18)] md:max-w-[320px] md:min-w-[220px]"
          style={{ border: "1px solid rgb(var(--border-subtle))" }}
        >
          <Search size={13} className="text-[rgb(var(--fg-muted))]" />
          <input
            type="search"
            inputMode="search"
            value={search}
            onChange={(e) => {
              updateSearch(e.target.value);
            }}
            maxLength={120}
            placeholder="Search tracks, artists, projects…"
            aria-label="Search music library"
            className="h-11 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[rgb(var(--fg-muted))]"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                updateSearch("");
              }}
              className="sk-press -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        {/* Artist filter pill — producer-only. Producers filter their
            library by client/artist; artists don't have an equivalent
            axis (one library, possibly across several producers, but
            the product decision is "always show all"). */}
        {role === "producer" ? (
          <ArtistFilterPill options={artistOptions} value={artist} onChange={setArtist} />
        ) : null}

        {/* Phone-only row break — everything after this wraps onto the
            second toolbar row. Display:none from md up. */}
        <span aria-hidden className="w-full md:hidden" />

        {/* Mode toggle (Projects / Songs) — pushed to the right on
            desktop; anchors the second row's left edge on phones. */}
        <div className="flex shrink-0 md:ml-auto">
          <ModeToggle value={mode} onChange={updateMode} />
        </div>

        {/* Sorting is a real action only in the songs table. Removing it
            elsewhere keeps phones free of a disabled, dead control. */}
        {mode === "songs" && view === "table" ? (
          <SortDropdown value={sort} onChange={updateSort} />
        ) : null}

        {/* Phones use one compact native menu; desktop keeps the faster
            two-button view switch. Both update the same view state. */}
        <CompactViewMenu value={view} onChange={updateView} />
        <div className="hidden md:block">
          <ViewToggle value={view} onChange={updateView} />
        </div>
      </div>

      {role === "artist" && mode === "projects" ? (
        <ProjectArchiveFilterControl
          value={projectArchiveFilter}
          onChange={updateProjectArchiveFilter}
        />
      ) : null}

      {role === "producer" && mode === "songs" ? (
        <SongArchiveFilterControl
          value={songArchiveFilter}
          onChange={updateSongArchiveFilter}
        />
      ) : null}

      {/* Body — one results region updated by the two pressed-button groups. */}
      <div
        id={RESULTS_PANEL_ID}
        role="region"
        aria-label="Library results"
        className="[touch-action:pan-y_pinch-zoom]"
        data-tab-swipe-surface
        {...modeSwipeHandlers}
      >
        {mode === "projects" && visibleProjects.length === 0 ? (
          <EmptyResult
            hasQuery={Boolean(search.trim()) || artist !== "all"}
            hasProjects={totalProjects > 0}
            role={role}
            addSongHref={addSongHref}
            {...(role === "artist" ? { projectArchiveFilter } : {})}
            onProjectArchiveFilterChange={updateProjectArchiveFilter}
          />
        ) : mode === "projects" ? (
          view === "grid" ? (
            <ProjectsGrid projects={visibleProjects} role={role} />
          ) : (
            <ProjectsTable projects={visibleProjects} role={role} />
          )
        ) : visibleSongs.length === 0 ? (
          <EmptyResult
            hasQuery={Boolean(search.trim()) || artist !== "all"}
            hasProjects={totalProjects > 0}
            role={role}
            addSongHref={addSongHref}
            {...(role === "producer" ? { songArchiveFilter } : {})}
            onSongArchiveFilterChange={updateSongArchiveFilter}
          />
        ) : view === "grid" ? (
          <SongsGrid
            songs={visibleSongs}
            role={role}
            addSongHref={addSongHref}
            {...(renameSong ? { renameSong } : {})}
            {...(editArtist ? { editArtist } : {})}
            {...(setArchived ? { setArchived } : {})}
            {...(markReleased ? { markReleased } : {})}
          />
        ) : (
          <SongsTable
            songs={sortedSongs}
            role={role}
            addSongHref={addSongHref}
            {...(renameSong ? { renameSong } : {})}
            {...(editArtist ? { editArtist } : {})}
            {...(setArchived ? { setArchived } : {})}
            {...(markReleased ? { markReleased } : {})}
          />
        )}
      </div>
    </div>
  );
}

// ─── Toolbar primitives ──────────────────────────────────────────────

// Shared id for the results region — both pressed-button groups point
// to it via aria-controls so their effect is explicit without claiming
// the keyboard contract of tabs.
const RESULTS_PANEL_ID = "library-results";

function ProjectArchiveFilterControl({
  value,
  onChange,
}: {
  value: ProjectArchiveFilter;
  onChange: (value: ProjectArchiveFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Project status"
      className="flex w-fit rounded-[9px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-[2px]"
    >
      <ProjectArchiveFilterButton
        label="Active"
        active={value === "active"}
        onClick={() => {
          onChange("active");
        }}
      />
      <ProjectArchiveFilterButton
        label="Archived"
        active={value === "archived"}
        onClick={() => {
          onChange("archived");
        }}
      />
    </div>
  );
}

function ProjectArchiveFilterButton({
  label,
  active,
  onClick,
}: {
  label: "Active" | "Archived";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "sk-press min-h-11 rounded-[7px] px-3 py-1.5 text-[11.5px] font-bold",
        active
          ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))] shadow-sm"
          : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function SongArchiveFilterControl({
  value,
  onChange,
}: {
  value: SongArchiveFilter;
  onChange: (value: SongArchiveFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Song status"
      className="flex w-fit max-w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-[2px]"
    >
      {(["active", "archived"] as const).map((status) => {
        const active = value === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(status);
            }}
            className={[
              "sk-press min-h-11 rounded-[var(--radius-lg)] px-3 py-1.5 text-[11.5px] font-bold whitespace-nowrap",
              active
                ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))] shadow-sm"
                : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
            ].join(" ")}
          >
            {status === "active" ? "Active Songs" : "Archived Songs"}
          </button>
        );
      })}
    </div>
  );
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      role="group"
      aria-label="Library mode"
      className="flex rounded-[9px] p-[2px]"
      style={{
        background: "rgb(var(--bg-elevated))",
        border: "1px solid rgb(var(--border-subtle))",
      }}
    >
      <SegmentedButton
        active={value === "projects"}
        onClick={() => {
          onChange("projects");
        }}
        icon={<Disc3 size={13} strokeWidth={2.2} />}
        label="Projects"
        controls={RESULTS_PANEL_ID}
      />
      <SegmentedButton
        active={value === "songs"}
        onClick={() => {
          onChange("songs");
        }}
        icon={<AudioLines size={13} strokeWidth={2.2} />}
        label="Songs"
        controls={RESULTS_PANEL_ID}
      />
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div
      role="group"
      aria-label="View"
      className="flex rounded-[9px] p-[2px]"
      style={{
        background: "rgb(var(--bg-elevated))",
        border: "1px solid rgb(var(--border-subtle))",
      }}
    >
      <SegmentedButton
        active={value === "grid"}
        onClick={() => {
          onChange("grid");
        }}
        icon={<Grid3x3 size={13} strokeWidth={2.2} />}
        ariaLabel="Grid view"
        iconOnly
        controls={RESULTS_PANEL_ID}
      />
      <SegmentedButton
        active={value === "table"}
        onClick={() => {
          onChange("table");
        }}
        icon={<List size={13} strokeWidth={2.2} />}
        ariaLabel="Table view"
        iconOnly
        controls={RESULTS_PANEL_ID}
      />
    </div>
  );
}

function CompactViewMenu({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <label
      className="sk-press relative ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 text-[11.5px] font-semibold text-[rgb(var(--fg-default))] md:hidden"
    >
      <span className="pointer-events-none text-[rgb(var(--fg-muted))]">View</span>
      <span className="pointer-events-none hidden min-[375px]:inline">
        {value === "grid" ? "Grid" : "List"}
      </span>
      <ChevronDown
        aria-hidden
        size={11}
        strokeWidth={2.2}
        className="pointer-events-none"
      />
      <select
        aria-label="Library view"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as View);
        }}
        className="absolute inset-0 min-h-11 cursor-pointer opacity-0 md:min-h-0"
      >
        <option value="grid">Grid view</option>
        <option value="table">List view</option>
      </select>
    </label>
  );
}

function SegmentedButton({
  active,
  onClick,
  icon,
  label,
  ariaLabel,
  iconOnly,
  controls,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label?: string;
  ariaLabel?: string;
  iconOnly?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel ?? label}
      aria-controls={controls}
      onClick={onClick}
      className={[
        // sk-press provides scale(0.97) on :active for tactile feedback;
        // sk-trans pairs it with the project's strong custom easing
        // curve. The hover lift (-translate-y-px) is the new touch —
        // a 1px nudge that the user reads subconsciously as "this is
        // clickable" before they even press. Emil-style: invisible
        // detail that compounds.
        "sk-press sk-trans inline-flex min-h-11 items-center gap-1.5 rounded-[7px] font-bold",
        iconOnly ? "min-w-11 justify-center px-[9px] py-[6px]" : "px-[11px] py-[6px]",
        "text-[11.5px]",
        active
          ? "bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : "bg-transparent text-[rgb(var(--fg-muted))] hover:-translate-y-px hover:text-[rgb(var(--fg-default))]",
      ].join(" ")}
    >
      {icon}
      {label && !iconOnly ? <span>{label}</span> : null}
    </button>
  );
}

function ArtistFilterPill({
  options,
  value,
  onChange,
}: {
  options: string[];
  /** "all" is the sentinel for "no filter"; any other value is a name. */
  value: string;
  onChange: (v: string) => void;
}) {
  const filtered = value !== "all";
  return (
    <label
      className={[
        "sk-press sk-trans relative inline-flex min-h-11 max-w-[112px] min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[12px] font-semibold sm:max-w-[180px] sm:px-3 md:max-w-[220px]",
        filtered
          ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-background))]"
          : "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]",
      ].join(" ")}
      style={{
        border: filtered ? "none" : "1px solid rgb(var(--border-subtle))",
      }}
    >
      <span className="pointer-events-none min-w-0 truncate">
        {filtered ? value : "All artists"}
      </span>
      <ChevronDown size={11} strokeWidth={2.2} className="pointer-events-none" />
      <select
        aria-label="Filter by artist"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="absolute inset-0 min-h-11 cursor-pointer opacity-0 md:min-h-0"
      >
        <option value="all">All artists</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortDropdown({
  value,
  onChange,
}: {
  value: SongSort;
  onChange: (v: SongSort) => void;
}) {
  return (
    <label
      className="sk-press sk-trans relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-elevated))] px-2.5 py-1.5 text-[11.5px] font-semibold text-[rgb(var(--fg-default))] md:px-3"
      style={{ border: "1px solid rgb(var(--border-subtle))" }}
    >
      <span className="pointer-events-none text-[rgb(var(--fg-muted))]">Sort</span>
      <span className="pointer-events-none hidden md:inline">{SORT_LABEL[value]}</span>
      <ChevronDown size={11} strokeWidth={2.2} className="pointer-events-none" />
      <select
        aria-label="Sort songs"
        value={value}
        onChange={(e) => {
          onChange(e.target.value as SongSort);
        }}
        className="absolute inset-0 min-h-11 cursor-pointer opacity-0 md:min-h-0"
      >
        {(Object.keys(SORT_LABEL) as SongSort[]).map((k) => (
          <option key={k} value={k}>
            {SORT_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── Views ───────────────────────────────────────────────────────────

function ProjectsGrid({
  projects,
  role,
}: {
  projects: ProjectAggregate[];
  role: MusicLibraryRole;
}) {
  // Featured layout: when the library has more than 6 projects the
  // first card spans 2 columns. Breaks the "every card identical" grid
  // monotony without inventing a new component. Below that threshold a
  // single oversized card would just look lopsided, so we stay in the
  // uniform grid.
  const FEATURED_THRESHOLD = 6;
  const useFeatured = projects.length > FEATURED_THRESHOLD;
  return (
    // Below sm the auto-fill grid would resolve to ONE full-width
    // column (giant ~360px covers on a phone), so phones get an
    // explicit 2-col grid with a tighter gap. From sm up the original
    // auto-fill behavior applies unchanged.
    <ul
      role="list"
      className="grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] sm:gap-[22px]"
    >
      {projects.map((p, i) => (
        // Featured span applies from sm: up only — below 640px the
        // grid is a fixed 2-col phone grid where a span-2 item would
        // read as a jarring full-width banner. At sm+ the grid always
        // fits 2+ columns, so the span is safe.
        <li
          key={p.id}
          className={useFeatured && i === 0 ? "sk-stagger-item sm:col-span-2" : "sk-stagger-item"}
          style={{ "--i": String(i) } as React.CSSProperties}
        >
          <ProjectCard project={p} role={role} />
        </li>
      ))}
    </ul>
  );
}

function ProjectCard({ project, role }: { project: ProjectAggregate; role: MusicLibraryRole }) {
  const archivedLabel = archivedProjectLabel(project.projectLifecycleStatus);
  return (
    <Link
      href={projectHref(role, project.id, project.producerId)}
      className="sk-lift group flex flex-col gap-3 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))] focus-visible:outline-none"
    >
      <div className="relative" style={{ willChange: "transform" }}>
        <ProjectCover
          seed={project.id}
          gradient={project.gradient}
          kind={project.kind}
          shadow="hero"
          radius="12px"
          className="aspect-square"
        />
        {project.playableTrackCount > 0 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 bottom-3 flex h-11 w-11 translate-y-1.5 scale-90 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))] opacity-0 shadow-[0_6px_14px_rgba(17,16,9,0.32)] group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100"
            style={{
              transition:
                "opacity 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 220ms cubic-bezier(0.23, 1, 0.32, 1)",
            }}
          >
            <Play size={16} strokeWidth={2.6} fill="currentColor" />
          </span>
        ) : (
          <span className="absolute right-3 bottom-3 rounded-[var(--radius-sm)] border border-white/30 bg-[rgb(17_16_9)/0.36] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.08em] text-white uppercase backdrop-blur-sm">
            Awaiting audio
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p
          className="font-display truncate text-[14px] leading-tight font-bold text-[rgb(var(--fg-default))] sm:text-[15px]"
          style={{ letterSpacing: "-0.02em" }}
        >
          {project.title}
        </p>
        {project.artistLabel ? (
          <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
            {project.artistLabel}
          </p>
        ) : null}
        {archivedLabel ? (
          <p className="mt-1 inline-flex rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
            {archivedLabel}
          </p>
        ) : null}
        <p className="mt-1 truncate font-mono text-[10.5px] text-[rgb(var(--fg-faint))]">
          {project.kind} · {String(project.trackCount)} song space
          {project.trackCount === 1 ? "" : "s"} · {fmtDuration(project.durationMs)}
        </p>
      </div>
    </Link>
  );
}

function ProjectsTable({
  projects,
  role,
}: {
  projects: ProjectAggregate[];
  role: MusicLibraryRole;
}) {
  return (
    <>
      {/* Below lg the fixed px columns outgrow a phone viewport, so the
        wide table is desktop-only (max-lg:hidden) and phones get the
        compact list rows rendered after it. At lg+ nothing changes:
        same overflow-hidden card as before. */}
      <div
        className="overflow-hidden rounded-[12px] border max-lg:hidden"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <div>
          {/* Header */}
          <div
            className="grid items-center gap-3 px-4 py-2 text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
            style={{
              gridTemplateColumns: "44px minmax(0,2.2fr) minmax(0,1.4fr) 90px 100px 80px 70px",
              borderBottom: "1px solid rgb(var(--border-subtle))",
            }}
          >
            <span />
            <span>Project</span>
            <span>Artist</span>
            <span>Kind</span>
            <span className="text-right">Song spaces</span>
            <span className="text-right">Duration</span>
            <span className="text-right">Notes</span>
          </div>
          <ul role="list">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={projectHref(role, p.id, p.producerId)}
                  className="grid items-center gap-3 px-4 py-2.5 hover:bg-[rgb(var(--bg-overlay))] focus-visible:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none active:scale-[0.992] active:bg-[rgb(var(--bg-overlay))]"
                  style={{
                    gridTemplateColumns:
                      "44px minmax(0,2.2fr) minmax(0,1.4fr) 90px 100px 80px 70px",
                    borderBottom: "1px solid rgb(var(--border-subtle))",
                    transition:
                      "background-color 140ms ease-out, transform 100ms cubic-bezier(0.4,0,0.2,1)",
                  }}
                >
                  <ProjectCover
                    seed={p.id}
                    gradient={p.gradient}
                    kind={null}
                    wordmark={false}
                    showKind={false}
                    shadow="none"
                    radius="6px"
                    className="h-9 w-9"
                  />
                  <span className="min-w-0">
                    <span className="font-display block truncate text-[14px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                      {p.title}
                    </span>
                    {archivedProjectLabel(p.projectLifecycleStatus) ? (
                      <span className="mt-0.5 block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        {archivedProjectLabel(p.projectLifecycleStatus)}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
                    {p.artistLabel}
                  </span>
                  <span>
                    <span className="inline-flex items-center rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-0.5 font-mono text-[10px] font-bold text-[rgb(var(--fg-default))]">
                      {p.kind}
                    </span>
                  </span>
                  <span className="text-right font-mono text-[11.5px] text-[rgb(var(--fg-muted))] tabular-nums">
                    {String(p.trackCount)}
                  </span>
                  <span className="text-right font-mono text-[11.5px] text-[rgb(var(--fg-muted))] tabular-nums">
                    {fmtDuration(p.durationMs)}
                  </span>
                  <span
                    className={[
                      "text-right font-mono text-[11.5px] tabular-nums",
                      p.unreadComments > 0
                        ? "font-bold text-[rgb(var(--brand-primary-dark))]"
                        : "text-[rgb(var(--fg-faint))]",
                    ].join(" ")}
                    style={{ minWidth: 24 }}
                  >
                    {fmtCount(p.unreadComments)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Mobile/tablet (below lg): compact list rows — same hrefs and
        data as the table, Spotify-style. Thumb + title/artist + kind
        chip + duration; ≥44px tap target per row. */}
      <ul
        role="list"
        className="relative rounded-[12px] border lg:hidden"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={projectHref(role, p.id, p.producerId)}
              className="flex items-center gap-3 px-3 py-2.5 active:bg-[rgb(var(--bg-overlay))]"
              style={{
                borderBottom: "1px solid rgb(var(--border-subtle))",
                transition: "background-color 140ms ease-out",
              }}
            >
              <ProjectCover
                seed={p.id}
                gradient={p.gradient}
                kind={null}
                wordmark={false}
                showKind={false}
                shadow="none"
                radius="8px"
                className="h-11 w-11 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="font-display block truncate text-[14px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                  {p.title}
                </span>
                <span className="block truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
                  {p.artistLabel ? `${p.artistLabel} · ` : ""}
                  {String(p.trackCount)} song space{p.trackCount === 1 ? "" : "s"}
                </span>
                {archivedProjectLabel(p.projectLifecycleStatus) ? (
                  <span className="mt-0.5 block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                    {archivedProjectLabel(p.projectLifecycleStatus)}
                  </span>
                ) : null}
              </span>
              <span className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-0.5 font-mono text-[10px] font-bold text-[rgb(var(--fg-default))]">
                {p.kind}
              </span>
              <span className="shrink-0 font-mono text-[11.5px] text-[rgb(var(--fg-muted))] tabular-nums">
                {fmtDuration(p.durationMs)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function SongsGrid({
  songs,
  role,
  addSongHref,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  songs: MusicLibraryRow[];
  role: MusicLibraryRole;
  addSongHref: string;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const nowPlaying = useNowPlaying();
  return (
    // Same phone treatment as ProjectsGrid: explicit 2 columns below
    // sm, original auto-fill from sm up.
    <ul
      role="list"
      className="grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] sm:gap-[22px]"
    >
      {songs.map((song, i) => (
        <li
          key={song.id}
          className="sk-stagger-item"
          style={{ "--i": String(i) } as React.CSSProperties}
        >
          {isMusicLibraryEmptySlot(song) ? (
            <EmptySongSpaceCard
              slot={song}
              role={role}
              actionHref={rowActionHref(song.actionHref, addSongHref)}
            />
          ) : (
            <SongCard
              song={song}
              isPlaying={
                nowPlaying.trackId === latestVersionIdForLibraryTrack(song) && nowPlaying.playing
              }
              role={role}
              {...(renameSong ? { renameSong } : {})}
              {...(editArtist ? { editArtist } : {})}
              {...(setArchived ? { setArchived } : {})}
              {...(markReleased ? { markReleased } : {})}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function SongCard({
  song,
  isPlaying,
  role,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  song: MusicLibraryTrackRow;
  isPlaying: boolean;
  role: MusicLibraryRole;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const gradient = gradientForSeed(song.projectId);
  const projectArchivedLabel = archivedProjectLabel(song.projectLifecycleStatus);
  const songArchived = song.archivedAtIso !== null;
  const songReleased = song.releasedAtIso != null;
  const audioDeleted = isMusicLibraryTrackAudioDeleted(song);
  const versionId = latestVersionIdForLibraryTrack(song);
  const canPlay = isMusicLibraryTrackPlayable(song);
  const detailHref = versionId ? songHref(role, versionId, song.producerId) : null;
  const subtitle = [song.projectTitle, song.trackArtist ?? song.clientName]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="sk-lift group relative flex flex-col gap-3"
      data-music-row={canPlay ? "allocated-playable" : "allocated-no-audio"}
    >
      {detailHref ? (
        <Link
          href={detailHref}
          aria-label={`Open ${song.trackTitle} song page`}
          className="absolute inset-0 z-0 rounded-[12px] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))] focus-visible:outline-none"
        />
      ) : null}
      {role === "producer" && renameSong && editArtist && setArchived ? (
        <span className="pointer-events-auto absolute top-1.5 left-1.5 z-30">
          <SongManagementControls
            projectId={song.projectId}
            trackId={song.trackId}
            title={song.trackTitle}
            artist={song.trackArtist}
            archived={songArchived}
            {...(song.releasedAtIso === undefined ? {} : { releasedAtIso: song.releasedAtIso })}
            renameSong={renameSong}
            editArtist={editArtist}
            setArchived={setArchived}
            {...(markReleased ? { markReleased } : {})}
            overlay
          />
        </span>
      ) : null}
      <div className="pointer-events-none relative z-10" style={{ willChange: "transform" }}>
        <ProjectCover
          seed={song.projectId}
          gradient={gradient}
          kind={null}
          wordmark
          showKind={false}
          radius="12px"
          shadow="hero"
          className="aspect-[1.3/1] w-full"
        />
        <span className="absolute top-2.5 right-2.5 z-10 rounded-[4px] bg-[rgb(17_16_9)/0.38] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-white uppercase backdrop-blur-sm">
          {song.label ?? "No version"}
        </span>
        {canPlay ? (
          <span
            aria-hidden
            className="sk-trans absolute bottom-3 left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)] shadow-[0_6px_14px_rgba(17,16,9,0.28)] group-hover:scale-105"
          >
            <Play size={13} strokeWidth={2.6} fill="currentColor" />
          </span>
        ) : (
          <span className="absolute bottom-3 left-3 z-10 rounded-[var(--radius-sm)] border border-white/30 bg-[rgb(17_16_9)/0.38] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.08em] text-white uppercase backdrop-blur-sm">
            {audioDeleted ? "Audio deleted" : "Awaiting audio"}
          </span>
        )}
        {isPlaying && canPlay ? (
          <span
            aria-label="Now playing"
            className="absolute right-3 bottom-3 z-10 inline-flex h-[18px] w-[18px] items-center justify-center text-white"
            style={{ opacity: 0.92 }}
          >
            <EqBars playing size={13} />
          </span>
        ) : null}
      </div>
      <div className="pointer-events-none relative z-10 flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p
            className="font-display truncate text-[13px] leading-tight font-bold text-[rgb(var(--fg-default))]"
            style={{ letterSpacing: "-0.01em" }}
          >
            {song.trackTitle}
          </p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[11px] text-[rgb(var(--fg-muted))]">{subtitle}</p>
          ) : null}
          {projectArchivedLabel ? (
            <p className="mt-1 inline-flex rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              {projectArchivedLabel}
            </p>
          ) : null}
          {songArchived ? (
            <p className="mt-1 inline-flex rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Archived
            </p>
          ) : null}
          {songReleased ? (
            <p className="mt-1 inline-flex rounded-[var(--radius-sm)] border border-[rgb(var(--fg-success)/0.22)] bg-[rgb(var(--fg-success)/0.08)] px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-success))] uppercase">
              Released
            </p>
          ) : null}
          {canPlay ? (
            <p className="mt-1 text-right font-mono text-[10.5px] text-[rgb(var(--fg-faint))] tabular-nums">
              {fmtDuration(song.durationMs)}
            </p>
          ) : (
            <span className="pointer-events-auto relative z-20 block">
              <SongWaitingState
                role={role}
                actionHref={!songArchived && song.actionHref ? song.actionHref : null}
                audioDeleted={audioDeleted}
                compact
              />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptySongSpaceCard({
  slot,
  role,
  actionHref,
}: {
  slot: MusicLibraryEmptySlotRow;
  role: MusicLibraryRole;
  actionHref: string | null;
}) {
  return (
    <div className="group flex flex-col gap-3" data-music-row="empty-slot">
      <div className="relative aspect-[1.3/1] overflow-hidden rounded-[12px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))]">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
          <AudioLines size={22} strokeWidth={1.8} className="text-[rgb(var(--fg-faint))]" />
          <span className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
            Empty song space
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="font-display truncate text-[13px] leading-tight font-bold text-[rgb(var(--fg-default))]">
          {rowTitle(slot)}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-[rgb(var(--fg-muted))]">
          {slot.projectTitle}
        </p>
        <SongWaitingState
          role={role}
          actionHref={role === "producer" ? actionHref : null}
          emptySlot
          compact
        />
      </div>
    </div>
  );
}

function SongWaitingState({
  role,
  actionHref,
  audioDeleted = false,
  emptySlot = false,
  compact = false,
}: {
  role: MusicLibraryRole;
  actionHref?: string | null;
  audioDeleted?: boolean;
  emptySlot?: boolean;
  compact?: boolean;
}) {
  if (audioDeleted) {
    return (
      <div className={compact ? "mt-1" : ""}>
        <p className="text-[10.5px] font-bold text-[rgb(var(--fg-muted))]">Audio deleted</p>
        <p className="text-[10px] leading-snug text-[rgb(var(--fg-faint))]">
          No playable audio — history kept
        </p>
        {role === "producer" && actionHref ? (
          <Link
            href={actionHref}
            className="sk-press mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))]"
          >
            <Plus size={12} strokeWidth={2.4} />
            Upload audio
          </Link>
        ) : null}
      </div>
    );
  }
  if (role === "artist") {
    return (
      <p
        className={
          compact
            ? "mt-1 text-[10.5px] text-[rgb(var(--fg-faint))]"
            : "text-[11.5px] text-[rgb(var(--fg-muted))]"
        }
      >
        Waiting for your producer
      </p>
    );
  }
  if (actionHref) {
    return (
      <Link
        href={actionHref}
        className="sk-press mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))]"
      >
        <Plus size={12} strokeWidth={2.4} />
        {emptySlot ? "Add Song" : "Upload audio"}
      </Link>
    );
  }
  return (
    <p
      className={
        compact
          ? "mt-1 text-[10.5px] text-[rgb(var(--fg-faint))]"
          : "text-[11.5px] text-[rgb(var(--fg-muted))]"
      }
    >
      {emptySlot ? "Ready for a song" : "Ready for the first upload"}
    </p>
  );
}

function SongsTable({
  songs,
  role,
  addSongHref,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  songs: MusicLibraryRow[];
  role: MusicLibraryRole;
  addSongHref: string;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const nowPlaying = useNowPlaying();
  // 8 columns: play/idx, cover thumb, title, artist, version, notes,
  // length, actions. The 40px cover sits between the play column
  // and the title — same pattern Spotify + Apple Music use in their
  // table view (small album art next to track title for visual identity).
  const cols = "44px 40px minmax(0,2fr) minmax(0,1fr) 70px 60px 64px 104px";

  function handlePlay(song: MusicLibraryTrackRow) {
    const versionId = latestVersionIdForLibraryTrack(song);
    if (!isMusicLibraryTrackPlayable(song) || !song.audioUrl || !versionId) return;
    if (nowPlaying.trackId === versionId) {
      playerToggle();
      return;
    }
    playerPlay({
      id: versionId,
      audioUrl: song.audioUrl,
      title: song.trackTitle,
      subtitle: `${song.trackArtist ?? song.clientName ?? song.projectTitle} · ${song.label ?? "No version"}`,
      durationMs: song.durationMs,
      ...(role === "producer" ? { cachePolicy: "account-unlocked" as const } : {}),
    });
  }

  return (
    <>
      {/* Same mobile treatment as ProjectsTable: the wide table is
        desktop-only (max-lg:hidden); phones get the compact list rows
        rendered after it. Untouched at lg+. */}
      <div
        className="relative rounded-[12px] border max-lg:hidden"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <div>
          <div
            className="grid items-center gap-3 px-4 py-2 text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
            style={{
              gridTemplateColumns: cols,
              borderBottom: "1px solid rgb(var(--border-subtle))",
            }}
          >
            <span className="text-right">#</span>
            <span aria-hidden />
            <span>Title</span>
            <span>Artist</span>
            <span>Version</span>
            <span className="text-right">Notes</span>
            <span className="text-right">Length</span>
            <span className="text-right">Actions</span>
          </div>
          <ul role="list">
            {songs.map((song, index) => (
              <LibrarySongDesktopRow
                key={song.id}
                item={song}
                index={index}
                role={role}
                cols={cols}
                nowPlayingId={nowPlaying.trackId}
                isPlaying={nowPlaying.playing}
                onPlay={handlePlay}
                addSongHref={addSongHref}
                {...(renameSong ? { renameSong } : {})}
                {...(editArtist ? { editArtist } : {})}
                {...(setArchived ? { setArchived } : {})}
                {...(markReleased ? { markReleased } : {})}
              />
            ))}
          </ul>
        </div>
      </div>

      {/* Mobile/tablet (below lg): compact list rows. Whole row is the
        same Link → song page; the cover thumb doubles as the play
        affordance (preventDefault + stopPropagation, same handlePlay).
        Title + version chip + duration, ≥44px tap targets. */}
      <ul
        role="list"
        className="relative rounded-[12px] border lg:hidden"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        {songs.map((song) => (
          <LibrarySongMobileRow
            key={song.id}
            item={song}
            role={role}
            nowPlayingId={nowPlaying.trackId}
            isPlaying={nowPlaying.playing}
            onPlay={handlePlay}
            addSongHref={addSongHref}
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

function LibrarySongDesktopRow({
  item,
  index,
  role,
  cols,
  nowPlayingId,
  isPlaying,
  onPlay,
  addSongHref,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  item: MusicLibraryRow;
  index: number;
  role: MusicLibraryRole;
  cols: string;
  nowPlayingId: string | null;
  isPlaying: boolean;
  onPlay: (track: MusicLibraryTrackRow) => void;
  addSongHref: string;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: cols,
    borderBottom: "1px solid rgb(var(--border-subtle))",
    transition: "background-color 140ms ease-out",
  };

  if (isMusicLibraryEmptySlot(item)) {
    const actionHref = rowActionHref(item.actionHref, addSongHref);
    return (
      <li data-music-row="empty-slot">
        <div
          role="group"
          aria-label={`${rowTitle(item)}, empty purchased song space`}
          className="grid items-center gap-3 px-4 py-2.5"
          style={rowStyle}
        >
          <span className="text-right font-mono text-[11px] text-[rgb(var(--fg-faint))] tabular-nums">
            {padIndex(index)}
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-faint))]">
            <AudioLines size={15} strokeWidth={1.8} />
          </span>
          <span className="block min-w-0">
            <span className="block truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))]">
              {rowTitle(item)}
            </span>
            <span className="block truncate text-[11px] text-[rgb(var(--fg-muted))]">
              {role === "producer"
                ? "Purchased space ready for a song"
                : "Waiting for your producer"}
            </span>
          </span>
          <span className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
            {rowArtist(item) ?? ""}
          </span>
          <span className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
            Empty
          </span>
          <span />
          <span className="text-right text-[11px] text-[rgb(var(--fg-faint))]">No audio</span>
          <span className="flex justify-end">
            {role === "producer" && actionHref ? (
              <Link
                href={actionHref}
                aria-label={`Add song to ${item.projectTitle}`}
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

  const versionId = latestVersionIdForLibraryTrack(item);
  const songArchived = item.archivedAtIso !== null;
  const songReleased = item.releasedAtIso != null;
  const audioDeleted = isMusicLibraryTrackAudioDeleted(item);
  const canPlay = isMusicLibraryTrackPlayable(item);
  const current = canPlay && nowPlayingId === versionId;
  const playingHere = current && isPlaying;
  const href = versionId ? songHref(role, versionId, item.producerId) : null;
  return (
    <li data-music-row={canPlay ? "allocated-playable" : "allocated-no-audio"}>
      <div
        role="group"
        aria-label={
          canPlay
            ? `Open ${item.trackTitle} song page`
            : audioDeleted
              ? `${item.trackTitle}, audio deleted, history kept`
              : `${item.trackTitle}, awaiting audio`
        }
        className={[
          "group grid items-center gap-3 px-4 py-2.5",
          canPlay ? "hover:bg-[rgb(var(--bg-overlay))]" : "",
          current ? "bg-[rgb(var(--brand-primary)/0.055)]" : "",
        ].join(" ")}
        style={rowStyle}
      >
        <span className="relative flex justify-end">
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
                "sk-press sk-trans inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
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
        <ProjectCover
          seed={item.projectId}
          gradient={gradientForSeed(item.projectId)}
          kind={null}
          showKind={false}
          shadow="card"
          radius="6px"
          className="h-9 w-9"
        />
        <span className="block min-w-0">
          {href ? (
            <Link
              href={href}
              className="flex min-h-11 w-full items-center truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))] hover:underline focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              {item.trackTitle}
            </Link>
          ) : (
            <span className="block truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))]">
              {item.trackTitle}
            </span>
          )}
          <span className="block truncate text-[11px] text-[rgb(var(--fg-muted))]">
            {canPlay
              ? item.projectTitle
              : audioDeleted
                ? "No playable audio — history kept"
                : role === "producer"
                  ? "Allocated song, ready for the first upload"
                  : "Waiting for your producer"}
          </span>
          {archivedProjectLabel(item.projectLifecycleStatus) ? (
            <span className="block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              {archivedProjectLabel(item.projectLifecycleStatus)}
            </span>
          ) : null}
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
        <span className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
          {rowArtist(item) ?? ""}
        </span>
        <span className="font-mono text-[10px] font-bold text-[rgb(var(--fg-default))] uppercase">
          {item.label ?? "No version"}
        </span>
        <span
          className={[
            "text-right font-mono text-[11px] tabular-nums",
            item.unreadComments > 0
              ? "font-bold text-[rgb(var(--brand-primary-dark))]"
              : "text-[rgb(var(--fg-faint))]",
          ].join(" ")}
        >
          {fmtCount(item.unreadComments)}
        </span>
        <span className="text-right font-mono text-[11px] text-[rgb(var(--fg-muted))] tabular-nums">
          {canPlay ? fmtDuration(item.durationMs) : audioDeleted ? "Audio deleted" : "No audio"}
        </span>
        <span className="flex justify-end gap-1.5">
          {role === "producer" && !songArchived && !canPlay && item.actionHref ? (
            <Link
              href={item.actionHref}
              aria-label={`Upload audio for ${item.trackTitle}`}
              className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
            >
              <Plus size={14} strokeWidth={2.4} />
            </Link>
          ) : null}
          {role === "producer" && renameSong && editArtist && setArchived ? (
            <SongManagementControls
              projectId={item.projectId}
              trackId={item.trackId}
              title={item.trackTitle}
              artist={item.trackArtist}
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

function LibrarySongMobileRow({
  item,
  role,
  nowPlayingId,
  isPlaying,
  onPlay,
  addSongHref,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  item: MusicLibraryRow;
  role: MusicLibraryRole;
  nowPlayingId: string | null;
  isPlaying: boolean;
  onPlay: (track: MusicLibraryTrackRow) => void;
  addSongHref: string;
  renameSong?: RenameSongAction;
  editArtist?: EditSongArtistAction;
  setArchived?: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const rowStyle: React.CSSProperties = {
    borderBottom: "1px solid rgb(var(--border-subtle))",
    transition: "background-color 140ms ease-out",
  };

  if (isMusicLibraryEmptySlot(item)) {
    return (
      <li data-music-row="empty-slot">
        <div
          role="group"
          aria-label={`${rowTitle(item)}, empty purchased song space`}
          className="flex min-h-[64px] items-center gap-3 px-3 py-2.5"
          style={rowStyle}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-faint))]">
            <AudioLines size={17} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))]">
              {rowTitle(item)}
            </span>
            <span className="block truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
              {role === "producer" ? "Purchased space" : "Waiting for your producer"}
            </span>
          </span>
          {role === "producer" && rowActionHref(item.actionHref, addSongHref) ? (
            <Link
              href={rowActionHref(item.actionHref, addSongHref) ?? addSongHref}
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

  const versionId = latestVersionIdForLibraryTrack(item);
  const songArchived = item.archivedAtIso !== null;
  const songReleased = item.releasedAtIso != null;
  const audioDeleted = isMusicLibraryTrackAudioDeleted(item);
  const canPlay = isMusicLibraryTrackPlayable(item);
  const current = canPlay && nowPlayingId === versionId;
  const playingHere = current && isPlaying;
  const href = versionId ? songHref(role, versionId, item.producerId) : null;
  return (
    <li data-music-row={canPlay ? "allocated-playable" : "allocated-no-audio"}>
      <div
        role="group"
        aria-label={
          canPlay
            ? `Open ${item.trackTitle} song page`
            : audioDeleted
              ? `${item.trackTitle}, audio deleted, history kept`
              : `${item.trackTitle}, awaiting audio`
        }
        className={[
          "flex min-h-[64px] items-center gap-3 px-3 py-2.5",
          canPlay ? "active:bg-[rgb(var(--bg-overlay))]" : "",
          current ? "bg-[rgb(var(--brand-primary)/0.055)]" : "",
        ].join(" ")}
        style={rowStyle}
      >
        <span className="relative h-11 w-11 shrink-0">
          <ProjectCover
            seed={item.projectId}
            gradient={gradientForSeed(item.projectId)}
            kind={null}
            showKind={false}
            shadow="none"
            radius="8px"
            className="h-11 w-11"
          />
          {canPlay ? (
            <button
              type="button"
              aria-label={playingHere ? "Pause" : "Play"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onPlay(item);
              }}
              className="absolute inset-0 flex items-center justify-center rounded-[8px] text-white"
            >
              {playingHere ? (
                <EqBars playing size={12} />
              ) : (
                <Play
                  size={14}
                  strokeWidth={2.6}
                  fill="currentColor"
                  className="drop-shadow-[0_1px_3px_rgba(17,16,9,0.45)]"
                />
              )}
            </button>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          {href ? (
            <Link
              href={href}
              className="flex min-h-11 w-full items-center truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              {item.trackTitle}
            </Link>
          ) : (
            <span className="block truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))]">
              {item.trackTitle}
            </span>
          )}
          <span className="block truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
            {canPlay
              ? item.projectTitle
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
            <span className="hidden shrink-0 items-center rounded-[4px] bg-[rgb(var(--bg-sunken))] px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-[rgb(var(--fg-default))] uppercase md:inline-flex">
              {item.label ?? "Mix"}
            </span>
            <span className="hidden shrink-0 font-mono text-[11px] text-[rgb(var(--fg-muted))] tabular-nums md:inline">
              {fmtDuration(item.durationMs)}
            </span>
          </>
        ) : null}
        {role === "producer" && !songArchived && !canPlay && item.actionHref ? (
          <Link
            href={item.actionHref}
            aria-label={`Upload audio for ${item.trackTitle}`}
            className="sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
          >
            <Plus size={14} strokeWidth={2.4} />
          </Link>
        ) : null}
        {role === "producer" && renameSong && editArtist && setArchived ? (
          <SongManagementControls
            projectId={item.projectId}
            trackId={item.trackId}
            title={item.trackTitle}
            artist={item.trackArtist}
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

function EmptyResult({
  hasQuery,
  hasProjects,
  role,
  addSongHref,
  projectArchiveFilter,
  songArchiveFilter,
  onProjectArchiveFilterChange,
  onSongArchiveFilterChange,
}: {
  hasQuery: boolean;
  hasProjects: boolean;
  role: MusicLibraryRole;
  addSongHref: string;
  projectArchiveFilter?: ProjectArchiveFilter;
  songArchiveFilter?: SongArchiveFilter;
  onProjectArchiveFilterChange?: (value: ProjectArchiveFilter) => void;
  onSongArchiveFilterChange?: (value: SongArchiveFilter) => void;
}) {
  // Three states. CTAs route into producer-only surfaces (project
  // creation, upload), so they're suppressed in artist mode and the
  // body copy switches to reflect the artist's POV (they don't create
  // projects — their producer does).
  if (hasQuery) {
    return (
      <EmptyShell
        title="Nothing matches"
        body={
          role === "producer"
            ? "Clear the search or the artist filter to see everything."
            : "Clear the search to see everything."
        }
      />
    );
  }
  if (!hasProjects) {
    if (role === "artist") {
      return (
        <EmptyShell
          title="No projects yet"
          body="Once a producer opens a project for you, your music will land here."
        />
      );
    }
    return (
      <EmptyShell
        title="Add your first song"
        body="Choose an active project, or create a new one when none exists."
        cta={{
          href: addSongHref,
          label: "Add Song",
        }}
      />
    );
  }
  if (role === "artist" && projectArchiveFilter) {
    return projectArchiveFilter === "archived" ? (
      <EmptyShell
        title="No archived projects"
        body="Nothing is archived. Completed and canceled projects will appear here."
        action={{
          label: "View active projects",
          onClick: () => {
            onProjectArchiveFilterChange?.("active");
          },
        }}
      />
    ) : (
      <EmptyShell
        title="No active projects"
        body="Your completed and canceled projects are still available under Archived."
      />
    );
  }
  if (role === "producer" && songArchiveFilter) {
    return songArchiveFilter === "archived" ? (
      <EmptyShell
        title="No archived songs"
        body="Nothing is archived. Songs you archive will stay available here."
        action={{
          label: "View active songs",
          onClick: () => {
            onSongArchiveFilterChange?.("active");
          },
        }}
      />
    ) : (
      <EmptyShell
        title="No active songs"
        body="Restore a song from Archived Songs, or add a song to an active project."
        cta={{ href: addSongHref, label: "Add Song" }}
      />
    );
  }
  if (role === "artist") {
    return (
      <EmptyShell title="No songs yet" body="Once your producer uploads a mix, it shows up here." />
    );
  }
  return (
    <EmptyShell
      title="No songs yet"
      body="Add a song to an active project, then upload its first version."
      cta={{
        href: addSongHref,
        label: "Add Song",
      }}
    />
  );
}

function EmptyShell({
  title,
  body,
  cta,
  action,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
  action?: { label: string; onClick: () => void };
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
        {title}
        <span className="text-[rgb(var(--brand-primary-dark))]">.</span>
      </h3>
      <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="sk-press mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-[12.5px] font-bold text-[rgb(var(--fg-default))]"
        >
          {cta.label}
        </Link>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="sk-press mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-[12.5px] font-bold text-[rgb(var(--fg-default))]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
