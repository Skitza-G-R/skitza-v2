"use client";

import {
  AudioLines,
  ChevronDown,
  Disc3,
  Grid3x3,
  List,
  MoreHorizontal,
  Play,
  Search,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EqBars } from "~/components/audio/eq-bars";
import { playerPlay, playerToggle, useNowPlaying } from "~/components/audio/persistent-player";

import { ProjectCover } from "./project-cover";
import {
  fmtCount,
  fmtDuration,
  gradientForSeed,
  kindFromTrackCount,
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

// One row per TRACK. `id` is the latest version's id so existing deep-
// links into /dashboard/music/<id> keep working.
export interface MusicLibraryRow {
  id: string;
  trackId: string;
  trackTitle: string;
  trackArtist: string | null;
  label: string;
  projectId: string;
  projectTitle: string;
  projectLifecycleStatus?: MusicProjectLifecycleStatus;
  clientName: string | null;
  uploadedAtIso: string;
  audioUrl: string | null;
  durationMs: number | null;
  unreadComments: number;
  plays: number;
}

// Optional project-level rows let artist libraries keep projects with no
// playable versions visible. Producer callers can continue deriving projects
// entirely from the track list.
export interface MusicLibraryProjectRow {
  id: string;
  title: string;
  artistLabel: string;
  trackCount: number;
  projectLifecycleStatus?: MusicProjectLifecycleStatus;
  latestTrackUploadedAtIso: string | null;
}

// One row per PROJECT, combined client-side from project metadata and tracks.
interface ProjectAggregate {
  id: string;
  title: string;
  artistLabel: string;
  trackCount: number;
  durationMs: number;
  kind: ProjectKind;
  gradient: GradientClass;
  unreadComments: number;
  projectLifecycleStatus: MusicProjectLifecycleStatus | undefined;
  firstTrack: MusicLibraryRow | null;
  latestTrackUploadedAtIso: string | null;
}

type Mode = "projects" | "songs";
type View = "grid" | "table";
type SongSort = "recent" | "title" | "plays" | "notes" | "length";
type ProjectArchiveFilter = "active" | "archived";

const SORT_LABEL: Record<SongSort, string> = {
  recent: "Most recent",
  title: "Title A → Z",
  plays: "Most plays",
  notes: "Most notes",
  length: "Length",
};

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
function projectHref(role: MusicLibraryRole, projectId: string): string {
  return role === "producer"
    ? `/dashboard/music/project/${projectId}`
    : `/artist/music/${projectId}`;
}
function songHref(role: MusicLibraryRole, songId: string): string {
  return role === "producer" ? `/dashboard/music/${songId}` : `/artist/music/song/${songId}`;
}

export function MusicLibraryScreen({
  tracks,
  projectRows: explicitProjects = [],
  role = "producer",
}: {
  tracks: MusicLibraryRow[];
  projectRows?: MusicLibraryProjectRow[];
  role?: MusicLibraryRole;
}) {
  // "all" is the sentinel for "no artist filter" — any other string is
  // a literal client/artist name from the artist filter pill.
  const [mode, setMode] = useState<Mode>("projects");
  const [view, setView] = useState<View>("grid");
  const [search, setSearch] = useState("");
  const [artist, setArtist] = useState<string>("all");
  const [sort, setSort] = useState<SongSort>("recent");
  const [projectArchiveFilter, setProjectArchiveFilter] = useState<ProjectArchiveFilter>("active");

  // Unique client/artist names for the filter pill. Order by first
  // appearance so the most-recently-uploaded clients sit near the top.
  const artistOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tracks) {
      const name = (t.clientName ?? t.trackArtist ?? "").trim();
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
        const name = (t.clientName ?? t.trackArtist ?? "").trim();
        if (name !== artist) return false;
      }
      if (!q) return true;
      const hay = [t.trackTitle, t.trackArtist ?? "", t.clientName ?? "", t.projectTitle]
        .join(" ")
        .toLowerCase();
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
    const byId = new Map<string, ProjectAggregate & { tracks: MusicLibraryRow[] }>();
    for (const project of filteredExplicitProjects) {
      byId.set(project.id, {
        id: project.id,
        title: project.title,
        artistLabel: project.artistLabel,
        trackCount: project.trackCount,
        durationMs: 0,
        kind: kindFromTrackCount(project.trackCount),
        gradient: gradientForSeed(project.id),
        unreadComments: 0,
        projectLifecycleStatus: project.projectLifecycleStatus,
        firstTrack: null,
        latestTrackUploadedAtIso: project.latestTrackUploadedAtIso,
        tracks: [],
      });
    }
    for (const t of filteredTracks) {
      let agg = byId.get(t.projectId);
      if (!agg) {
        agg = {
          id: t.projectId,
          title: t.projectTitle,
          artistLabel: (t.clientName ?? t.trackArtist ?? "").trim(),
          trackCount: 0,
          durationMs: 0,
          kind: "SINGLE",
          gradient: gradientForSeed(t.projectId),
          unreadComments: 0,
          projectLifecycleStatus: t.projectLifecycleStatus,
          firstTrack: null,
          latestTrackUploadedAtIso: t.uploadedAtIso,
          tracks: [],
        };
        byId.set(t.projectId, agg);
      }
      agg.tracks.push(t);
    }
    const items: ProjectAggregate[] = [];
    for (const agg of byId.values()) {
      const trackCount = Math.max(agg.trackCount, agg.tracks.length);
      const durationMs = sumDurations(agg.tracks.map((t) => t.durationMs));
      const unreadComments = agg.tracks.reduce((acc, t) => acc + t.unreadComments, 0);
      items.push({
        id: agg.id,
        title: agg.title,
        artistLabel: agg.artistLabel,
        trackCount,
        durationMs,
        kind: kindFromTrackCount(trackCount),
        gradient: agg.gradient,
        unreadComments,
        projectLifecycleStatus: agg.projectLifecycleStatus,
        firstTrack: agg.tracks[0] ?? null,
        latestTrackUploadedAtIso:
          agg.latestTrackUploadedAtIso ?? agg.tracks[0]?.uploadedAtIso ?? null,
      });
    }
    // Sort projects by most recent track upload (the first track is the
    // newest because filteredTracks inherits the server's desc order).
    items.sort((a, b) => {
      const at = a.latestTrackUploadedAtIso ? Date.parse(a.latestTrackUploadedAtIso) : 0;
      const bt = b.latestTrackUploadedAtIso ? Date.parse(b.latestTrackUploadedAtIso) : 0;
      return bt - at;
    });
    return items;
  }, [filteredExplicitProjects, filteredTracks]);

  const visibleProjects = useMemo(() => {
    if (role !== "artist") return projects;
    return projects.filter((project) => {
      const archived = archivedProjectLabel(project.projectLifecycleStatus) !== null;
      return projectArchiveFilter === "archived" ? archived : !archived;
    });
  }, [projectArchiveFilter, projects, role]);

  // Header counts — surface the raw-tracks totals, not the filtered
  // version, so the meta line reads as a stable library summary.
  const totalTracks = tracks.length;
  const totalProjects = useMemo(() => {
    const seen = new Set<string>();
    for (const project of explicitProjects) seen.add(project.id);
    for (const t of tracks) seen.add(t.projectId);
    return seen.size;
  }, [explicitProjects, tracks]);
  const totalUnread = useMemo(() => tracks.reduce((acc, t) => acc + t.unreadComments, 0), [tracks]);

  // Sort songs only when the songs table is showing (per design.md the
  // sort dropdown disappears in grid view).
  const sortedSongs = useMemo(() => {
    if (mode !== "songs" || view !== "table") return filteredTracks;
    const arr = [...filteredTracks];
    switch (sort) {
      case "title":
        arr.sort((a, b) => a.trackTitle.localeCompare(b.trackTitle));
        break;
      case "plays":
        arr.sort((a, b) => b.plays - a.plays);
        break;
      case "notes":
        arr.sort((a, b) => b.unreadComments - a.unreadComments);
        break;
      case "length":
        arr.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
        break;
      case "recent":
      default:
        arr.sort((a, b) => Date.parse(b.uploadedAtIso) - Date.parse(a.uploadedAtIso));
        break;
    }
    return arr;
  }, [filteredTracks, mode, view, sort]);

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
            tracks{" · "}
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
        {/* Upload track CTA — producer-only. Routes to clients-projects?
            action=upload like the prior screen so the click lands on the
            upload entry surface. Hidden in artist mode (artists don't
            upload tracks; that's the producer's job). */}
        {role === "producer" ? (
          <Link
            href="/dashboard/clients-projects?action=upload"
            className="sk-press inline-flex items-center gap-1.5 rounded-[9px] bg-[rgb(var(--brand-primary))] px-[15px] py-[9px] text-[12.5px] font-bold text-[rgb(var(--fg-default))] shadow-[0_2px_12px_rgb(var(--brand-primary)/0.22)]"
          >
            <Upload size={13} strokeWidth={2.4} />
            Upload track
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
          className="sk-trans flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--bg-elevated))] px-3 py-2 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.18)] md:max-w-[320px] md:min-w-[220px] md:py-1.5"
          style={{ border: "1px solid rgb(var(--border-subtle))" }}
        >
          <Search size={13} className="text-[rgb(var(--fg-muted))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search tracks, artists, projects…"
            aria-label="Search music library"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[rgb(var(--fg-muted))]"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
              }}
              className="sk-press rounded-[var(--radius-sm)] p-0.5 text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
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
        <div className="flex md:ml-auto">
          <ModeToggle value={mode} onChange={setMode} />
        </div>

        {/* Sort dropdown — always rendered. Disabled (greyed) when not
            applicable (i.e. anything except Songs + Table view) so the
            toolbar shape stays stable across mode/view toggles. */}
        <SortDropdown
          value={sort}
          onChange={setSort}
          disabled={!(mode === "songs" && view === "table")}
        />

        {/* View toggle (Grid / Table) */}
        <ViewToggle value={view} onChange={setView} />
      </div>

      {role === "artist" && mode === "projects" ? (
        <ProjectArchiveFilterControl
          value={projectArchiveFilter}
          onChange={setProjectArchiveFilter}
        />
      ) : null}

      {/* Body — single panel that both toggles control via aria-controls. */}
      <div id={RESULTS_PANEL_ID} role="tabpanel" aria-label="Library results">
        {mode === "projects" && visibleProjects.length === 0 ? (
          <EmptyResult
            hasQuery={Boolean(search.trim()) || artist !== "all"}
            hasProjects={totalProjects > 0}
            role={role}
            {...(role === "artist" ? { projectArchiveFilter } : {})}
          />
        ) : mode === "projects" ? (
          view === "grid" ? (
            <ProjectsGrid projects={visibleProjects} role={role} />
          ) : (
            <ProjectsTable projects={visibleProjects} role={role} />
          )
        ) : filteredTracks.length === 0 ? (
          <EmptyResult
            hasQuery={Boolean(search.trim()) || artist !== "all"}
            hasProjects={totalProjects > 0}
            role={role}
          />
        ) : view === "grid" ? (
          <SongsGrid songs={filteredTracks} role={role} />
        ) : (
          <SongsTable songs={sortedSongs} role={role} />
        )}
      </div>
    </div>
  );
}

// ─── Toolbar primitives ──────────────────────────────────────────────

// Shared id for the results panel — both toggles point to it via
// aria-controls so screen readers can announce "controls library
// results" on each tab. Two tablists controlling one panel is a known
// compromise; the alternative is duplicate panels per axis which is
// worse semantically + visually.
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
        "sk-press rounded-[7px] px-3 py-1.5 text-[11.5px] font-bold",
        active
          ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))] shadow-sm"
          : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      role="tablist"
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
      role="tablist"
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
      role="tab"
      aria-selected={active}
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
        "sk-press sk-trans inline-flex items-center gap-1.5 rounded-[7px] font-bold",
        iconOnly ? "px-[9px] py-[6px]" : "px-[11px] py-[6px]",
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
        "sk-press sk-trans relative inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-semibold",
        filtered
          ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-background))]"
          : "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]",
      ].join(" ")}
      style={{
        border: filtered ? "none" : "1px solid rgb(var(--border-subtle))",
      }}
    >
      <span className="pointer-events-none">{filtered ? value : "All artists"}</span>
      <ChevronDown size={11} strokeWidth={2.2} className="pointer-events-none" />
      <select
        aria-label="Filter by artist"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
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
  disabled = false,
}: {
  value: SongSort;
  onChange: (v: SongSort) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={[
        // ml-auto pushes sort + view to the right edge of the phone
        // toolbar's second row; md+ resets to the desktop card flow.
        "sk-trans relative ml-auto inline-flex items-center gap-1.5 rounded-[9px] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-[11.5px] font-semibold md:ml-0",
        disabled
          ? "cursor-not-allowed text-[rgb(var(--fg-faint))]"
          : "sk-press text-[rgb(var(--fg-default))]",
      ].join(" ")}
      style={{ border: "1px solid rgb(var(--border-subtle))" }}
      aria-disabled={disabled}
      title={disabled ? "Sort applies to Songs · Table view" : undefined}
    >
      <span className="pointer-events-none text-[rgb(var(--fg-muted))]">Sort</span>
      <span className="pointer-events-none">{SORT_LABEL[value]}</span>
      <ChevronDown size={11} strokeWidth={2.2} className="pointer-events-none" />
      <select
        aria-label="Sort songs"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value as SongSort);
        }}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
      href={projectHref(role, project.id)}
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
        {/* Hover-only play button — translates up + fades + scales in.
            Strong-ease-out curve (0.23, 1, 0.32, 1) matches the rest of
            the app's entries (sk-page-enter, sk-stagger-item). */}
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
          {project.kind} · {String(project.trackCount)} track
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
              gridTemplateColumns: "44px minmax(0,2.2fr) minmax(0,1.4fr) 90px 70px 80px 70px",
              borderBottom: "1px solid rgb(var(--border-subtle))",
            }}
          >
            <span />
            <span>Project</span>
            <span>Artist</span>
            <span>Kind</span>
            <span className="text-right">Tracks</span>
            <span className="text-right">Duration</span>
            <span className="text-right">Notes</span>
          </div>
          <ul role="list">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={projectHref(role, p.id)}
                  className="grid items-center gap-3 px-4 py-2.5 hover:bg-[rgb(var(--bg-overlay))] focus-visible:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none active:scale-[0.992] active:bg-[rgb(var(--bg-overlay))]"
                  style={{
                    gridTemplateColumns: "44px minmax(0,2.2fr) minmax(0,1.4fr) 90px 70px 80px 70px",
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
        className="overflow-hidden rounded-[12px] border lg:hidden"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={projectHref(role, p.id)}
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
                  {String(p.trackCount)} track{p.trackCount === 1 ? "" : "s"}
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

function SongsGrid({ songs, role }: { songs: MusicLibraryRow[]; role: MusicLibraryRole }) {
  const nowPlaying = useNowPlaying();
  return (
    // Same phone treatment as ProjectsGrid: explicit 2 columns below
    // sm, original auto-fill from sm up.
    <ul
      role="list"
      className="grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] sm:gap-[22px]"
    >
      {songs.map((s, i) => (
        <li
          key={s.id}
          className="sk-stagger-item"
          style={{ "--i": String(i) } as React.CSSProperties}
        >
          <SongCard
            song={s}
            isPlaying={nowPlaying.trackId === s.id && nowPlaying.playing}
            role={role}
          />
        </li>
      ))}
    </ul>
  );
}

function SongCard({
  song,
  isPlaying,
  role,
}: {
  song: MusicLibraryRow;
  isPlaying: boolean;
  role: MusicLibraryRole;
}) {
  const gradient = gradientForSeed(song.projectId);
  const archivedLabel = archivedProjectLabel(song.projectLifecycleStatus);
  const subtitle = [song.projectTitle, song.clientName ?? song.trackArtist]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href={songHref(role, song.id)}
      className="sk-lift group flex flex-col gap-3 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))] focus-visible:outline-none"
    >
      {/* Wrapper sized by ProjectCover's own aspect-ratio. The cover sits
          as a sibling of the overlay spans — all anchored to this
          relative wrapper. No absolute/relative conflict on ProjectCover. */}
      <div className="relative" style={{ willChange: "transform" }}>
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
        {/* Version chip top-right */}
        <span className="absolute top-2.5 right-2.5 z-10 rounded-[4px] bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-white uppercase backdrop-blur-sm">
          {song.label}
        </span>
        {/* Bottom-left: 32px white play circle. */}
        <span
          aria-hidden
          className="sk-trans absolute bottom-3 left-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[rgb(17_16_9)] shadow-[0_6px_14px_rgba(17,16,9,0.28)] group-hover:scale-105"
        >
          <Play size={13} strokeWidth={2.6} fill="currentColor" />
        </span>
        {/* Bottom-right: animated EqBars only when this song is the
            currently-playing track. When not playing, render nothing —
            avoids a static "waveform" that competes with the EqBars
            elsewhere as the now-playing signal. */}
        {isPlaying ? (
          <span
            aria-label="Now playing"
            className="absolute right-3 bottom-3 z-10 inline-flex h-[18px] w-[18px] items-center justify-center text-white"
            style={{ opacity: 0.92 }}
          >
            <EqBars playing size={13} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <p
          className="font-display truncate text-[13px] leading-tight font-bold text-[rgb(var(--fg-default))]"
          style={{ letterSpacing: "-0.01em" }}
        >
          {song.trackTitle}
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[11px] text-[rgb(var(--fg-muted))]">{subtitle}</p>
        ) : null}
        {archivedLabel ? (
          <p className="mt-1 inline-flex rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
            {archivedLabel}
          </p>
        ) : null}
        <p className="mt-1 flex items-center justify-between font-mono text-[10.5px] text-[rgb(var(--fg-faint))]">
          <span className="inline-flex items-center gap-1">
            <Play size={9} strokeWidth={2.6} fill="currentColor" />
            <span className="tabular-nums" style={{ minWidth: 16 }}>
              {fmtCount(song.plays)}
            </span>
          </span>
          <span className="tabular-nums">{fmtDuration(song.durationMs)}</span>
        </p>
      </div>
    </Link>
  );
}

function SongsTable({ songs, role }: { songs: MusicLibraryRow[]; role: MusicLibraryRole }) {
  const nowPlaying = useNowPlaying();
  // 9 columns now: play/idx, cover thumb, title, artist, version, plays,
  // notes, length, actions. The 40px cover sits between the play column
  // and the title — same pattern Spotify + Apple Music use in their
  // table view (small album art next to track title for visual identity).
  const cols = "44px 40px minmax(0,2fr) minmax(0,1fr) 70px 64px 60px 64px 36px";

  function handlePlay(song: MusicLibraryRow) {
    if (!song.audioUrl) return;
    if (nowPlaying.trackId === song.id) {
      playerToggle();
      return;
    }
    playerPlay({
      id: song.id,
      audioUrl: song.audioUrl,
      title: song.trackTitle,
      subtitle: `${song.clientName ?? song.trackArtist ?? song.projectTitle} · ${song.label}`,
      durationMs: song.durationMs,
    });
  }

  return (
    <>
      {/* Same mobile treatment as ProjectsTable: the wide table is
        desktop-only (max-lg:hidden); phones get the compact list rows
        rendered after it. Untouched at lg+. */}
      <div
        className="overflow-hidden rounded-[12px] border max-lg:hidden"
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
            <span className="text-right">Plays</span>
            <span className="text-right">Notes</span>
            <span className="text-right">Length</span>
            <span />
          </div>
          <ul role="list">
            {songs.map((s, idx) => {
              const isCurrent = nowPlaying.trackId === s.id;
              const isPlayingHere = isCurrent && nowPlaying.playing;
              return (
                <li key={s.id}>
                  {/* Whole row is a Link → song page. The play + more
                  buttons inside use preventDefault + stopPropagation
                  so they fire their own action without navigating. */}
                  <Link
                    href={songHref(role, s.id)}
                    aria-label={`Open ${s.trackTitle} song page`}
                    className={[
                      "group grid items-center gap-3 px-4 py-2 hover:bg-[rgb(var(--bg-overlay))]",
                      isCurrent ? "bg-[rgb(var(--brand-primary)/0.055)]" : "",
                    ].join(" ")}
                    style={{
                      gridTemplateColumns: cols,
                      borderBottom: "1px solid rgb(var(--border-subtle))",
                      transition: "background-color 140ms ease-out",
                    }}
                  >
                    {/* Index → play button on hover / current. Both sit in
                    the same cell so the button reveals over the number
                    on hover instead of pushing it sideways. */}
                    <span className="relative flex justify-end">
                      <button
                        type="button"
                        aria-label={isPlayingHere ? "Pause" : "Play"}
                        title={isPlayingHere ? "Pause (Space)" : "Play (Space)"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handlePlay(s);
                        }}
                        disabled={!s.audioUrl}
                        className={[
                          "sk-press sk-trans inline-flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-40",
                          isCurrent
                            ? "skitza-playing-glow bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))]"
                            : "bg-[rgb(var(--fg-default))] text-white opacity-0 group-hover:opacity-100",
                        ].join(" ")}
                      >
                        {isPlayingHere ? (
                          <EqBars playing size={11} />
                        ) : (
                          <Play size={11} strokeWidth={2.6} fill="currentColor" />
                        )}
                      </button>
                      <span
                        aria-hidden
                        className={[
                          "pointer-events-none absolute font-mono text-[11px] text-[rgb(var(--fg-faint))] tabular-nums transition",
                          isCurrent ? "opacity-0" : "group-hover:opacity-0",
                        ].join(" ")}
                        style={{
                          width: 28,
                          textAlign: "right",
                          lineHeight: "28px",
                        }}
                      >
                        {padIndex(idx)}
                      </span>
                    </span>

                    {/* Cover thumbnail — 36px, no wordmark/kind. */}
                    <ProjectCover
                      seed={s.projectId}
                      gradient={gradientForSeed(s.projectId)}
                      kind={null}
                      showKind={false}
                      shadow="card"
                      radius="6px"
                      className="h-9 w-9"
                    />

                    {/* Title + project (whole row is the link, just text here) */}
                    <span className="block min-w-0">
                      <p className="truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))]">
                        {s.trackTitle}
                      </p>
                      <p className="truncate text-[11px] text-[rgb(var(--fg-muted))]">
                        {s.projectTitle}
                      </p>
                      {archivedProjectLabel(s.projectLifecycleStatus) ? (
                        <p className="truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                          {archivedProjectLabel(s.projectLifecycleStatus)}
                        </p>
                      ) : null}
                    </span>

                    <span className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
                      {s.clientName ?? s.trackArtist ?? ""}
                    </span>

                    <span>
                      <span className="inline-flex items-center rounded-[4px] bg-[rgb(var(--bg-sunken))] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[rgb(var(--fg-default))] uppercase">
                        {s.label}
                      </span>
                    </span>

                    <span
                      className="text-right font-mono text-[11px] text-[rgb(var(--fg-muted))] tabular-nums"
                      style={{ minWidth: 24 }}
                    >
                      {fmtCount(s.plays)}
                    </span>

                    <span
                      className={[
                        "text-right font-mono text-[11px] tabular-nums",
                        s.unreadComments > 0
                          ? "font-bold text-[rgb(var(--brand-primary-dark))]"
                          : "text-[rgb(var(--fg-faint))]",
                      ].join(" ")}
                      style={{ minWidth: 24 }}
                    >
                      {fmtCount(s.unreadComments)}
                    </span>

                    <span className="text-right font-mono text-[12px] text-[rgb(var(--fg-muted))] tabular-nums">
                      {fmtDuration(s.durationMs)}
                    </span>

                    <span className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        aria-label="More actions"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        className="sk-press sk-trans rounded-[var(--radius-sm)] p-1 text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Mobile/tablet (below lg): compact list rows. Whole row is the
        same Link → song page; the cover thumb doubles as the play
        affordance (preventDefault + stopPropagation, same handlePlay).
        Title + version chip + duration, ≥44px tap targets. */}
      <ul
        role="list"
        className="overflow-hidden rounded-[12px] border lg:hidden"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        {songs.map((s) => {
          const isCurrent = nowPlaying.trackId === s.id;
          const isPlayingHere = isCurrent && nowPlaying.playing;
          return (
            <li key={s.id}>
              <Link
                href={songHref(role, s.id)}
                aria-label={`Open ${s.trackTitle} song page`}
                className={[
                  "flex items-center gap-3 px-3 py-2.5 active:bg-[rgb(var(--bg-overlay))]",
                  isCurrent ? "bg-[rgb(var(--brand-primary)/0.055)]" : "",
                ].join(" ")}
                style={{
                  borderBottom: "1px solid rgb(var(--border-subtle))",
                  transition: "background-color 140ms ease-out",
                }}
              >
                <span className="relative h-11 w-11 shrink-0">
                  <ProjectCover
                    seed={s.projectId}
                    gradient={gradientForSeed(s.projectId)}
                    kind={null}
                    showKind={false}
                    shadow="none"
                    radius="8px"
                    className="h-11 w-11"
                  />
                  <button
                    type="button"
                    aria-label={isPlayingHere ? "Pause" : "Play"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePlay(s);
                    }}
                    disabled={!s.audioUrl}
                    className="absolute inset-0 flex items-center justify-center rounded-[8px] text-white disabled:opacity-40"
                  >
                    {isPlayingHere ? (
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
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] leading-tight font-bold text-[rgb(var(--fg-default))]">
                    {s.trackTitle}
                  </span>
                  <span className="block truncate text-[11px] text-[rgb(var(--fg-muted))]">
                    {s.projectTitle}
                  </span>
                  {archivedProjectLabel(s.projectLifecycleStatus) ? (
                    <span className="mt-0.5 block truncate font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                      {archivedProjectLabel(s.projectLifecycleStatus)}
                    </span>
                  ) : null}
                </span>
                <span className="inline-flex shrink-0 items-center rounded-[4px] bg-[rgb(var(--bg-sunken))] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[rgb(var(--fg-default))] uppercase">
                  {s.label}
                </span>
                <span className="shrink-0 font-mono text-[12px] text-[rgb(var(--fg-muted))] tabular-nums">
                  {fmtDuration(s.durationMs)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function EmptyResult({
  hasQuery,
  hasProjects,
  role,
  projectArchiveFilter,
}: {
  hasQuery: boolean;
  hasProjects: boolean;
  role: MusicLibraryRole;
  projectArchiveFilter?: ProjectArchiveFilter;
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
        title="Start a project"
        body="Music lives inside projects. Create one to start uploading tracks."
        cta={{
          href: "/dashboard/clients-projects?action=new",
          label: "Create your first project",
        }}
      />
    );
  }
  if (role === "artist" && projectArchiveFilter) {
    return projectArchiveFilter === "archived" ? (
      <EmptyShell
        title="No archived projects"
        body="Completed and canceled projects will appear here."
      />
    ) : (
      <EmptyShell
        title="No active projects"
        body="Your completed and canceled projects are still available under Archived."
      />
    );
  }
  if (role === "artist") {
    return (
      <EmptyShell
        title="No tracks yet"
        body="Once your producer uploads a mix, it shows up here."
      />
    );
  }
  return (
    <EmptyShell
      title="No tracks yet"
      body="Drop a WAV into any project, your uploads land here."
      cta={{
        href: "/dashboard/clients-projects?action=upload",
        label: "Upload a track",
      }}
    />
  );
}

function EmptyShell({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
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
          className="sk-press mt-4 inline-flex items-center gap-1.5 rounded-[9px] bg-[rgb(var(--brand-primary))] px-4 py-2 text-[12.5px] font-bold text-[rgb(var(--fg-default))]"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
