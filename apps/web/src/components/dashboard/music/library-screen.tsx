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
import {
  playerPlay,
  playerToggle,
  useNowPlaying,
} from "~/components/audio/persistent-player";

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
  clientName: string | null;
  uploadedAtIso: string;
  audioUrl: string | null;
  durationMs: number | null;
  unreadComments: number;
  plays: number;
}

// One row per PROJECT, derived client-side from `MusicLibraryRow[]`.
interface ProjectAggregate {
  id: string;
  title: string;
  artistLabel: string;
  trackCount: number;
  durationMs: number;
  kind: ProjectKind;
  gradient: GradientClass;
  unreadComments: number;
  firstTrack: MusicLibraryRow | null;
}

type Mode = "projects" | "songs";
type View = "grid" | "table";
type SongSort = "recent" | "title" | "plays" | "notes" | "length";

const SORT_LABEL: Record<SongSort, string> = {
  recent: "Most recent",
  title: "Title A → Z",
  plays: "Most plays",
  notes: "Most notes",
  length: "Length",
};

// ─── Public component ────────────────────────────────────────────────

export function MusicLibraryScreen({ tracks }: { tracks: MusicLibraryRow[] }) {
  // "all" is the sentinel for "no artist filter" — any other string is
  // a literal client/artist name from the artist filter pill.
  const [mode, setMode] = useState<Mode>("projects");
  const [view, setView] = useState<View>("grid");
  const [search, setSearch] = useState("");
  const [artist, setArtist] = useState<string>("all");
  const [sort, setSort] = useState<SongSort>("recent");

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
      const hay = [
        t.trackTitle,
        t.trackArtist ?? "",
        t.clientName ?? "",
        t.projectTitle,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tracks, search, artist]);

  // Project aggregation — one entry per projectId, with track count,
  // total duration, kind, and a stable gradient picked by hashing the
  // projectId so the same project always lands on the same palette.
  const projects = useMemo<ProjectAggregate[]>(() => {
    const byId = new Map<string, ProjectAggregate & { tracks: MusicLibraryRow[] }>();
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
          firstTrack: null,
          tracks: [],
        };
        byId.set(t.projectId, agg);
      }
      agg.tracks.push(t);
    }
    const items: ProjectAggregate[] = [];
    for (const agg of byId.values()) {
      const trackCount = agg.tracks.length;
      const durationMs = sumDurations(agg.tracks.map((t) => t.durationMs));
      const unreadComments = agg.tracks.reduce(
        (acc, t) => acc + t.unreadComments,
        0,
      );
      items.push({
        id: agg.id,
        title: agg.title,
        artistLabel: agg.artistLabel,
        trackCount,
        durationMs,
        kind: kindFromTrackCount(trackCount),
        gradient: agg.gradient,
        unreadComments,
        firstTrack: agg.tracks[0] ?? null,
      });
    }
    // Sort projects by most recent track upload (the first track is the
    // newest because filteredTracks inherits the server's desc order).
    items.sort((a, b) => {
      const at = a.firstTrack ? Date.parse(a.firstTrack.uploadedAtIso) : 0;
      const bt = b.firstTrack ? Date.parse(b.firstTrack.uploadedAtIso) : 0;
      return bt - at;
    });
    return items;
  }, [filteredTracks]);

  // Header counts — surface the raw-tracks totals, not the filtered
  // version, so the meta line reads as a stable library summary.
  const totalTracks = tracks.length;
  const totalProjects = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tracks) seen.add(t.projectId);
    return seen.size;
  }, [tracks]);
  const totalUnread = useMemo(
    () => tracks.reduce((acc, t) => acc + t.unreadComments, 0),
    [tracks],
  );

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
        arr.sort(
          (a, b) =>
            Date.parse(b.uploadedAtIso) - Date.parse(a.uploadedAtIso),
        );
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
            className="font-display font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]"
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
              <span className="text-[rgb(var(--fg-success))]">
                all notes answered
              </span>
            )}
          </p>
        </div>
        {/* Upload track CTA — placeholder route until upload UX wires up
            its own page. Routes to clients-projects?action=upload like
            the prior screen so click never goes nowhere. */}
        <Link
          href="/dashboard/clients-projects?action=upload"
          className="sk-press inline-flex items-center gap-1.5 rounded-[9px] bg-[rgb(var(--brand-primary))] px-[15px] py-[9px] text-[12.5px] font-bold text-[rgb(var(--fg-default))] shadow-[0_2px_12px_rgb(var(--brand-primary)/0.22)]"
        >
          <Upload size={13} strokeWidth={2.4} />
          Upload track
        </Link>
      </header>

      {/* Toolbar — fully-opaque elevated surface with a confident border
          so it reads as the lid of the library section, not a floating
          translucent strip. */}
      <div
        className="flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-strong))",
        }}
      >
        {/* Search — focus-within ring brightens the pill so the
            keyboardable surface is visible without a heavy outline. */}
        <div
          className="sk-trans flex min-w-[220px] max-w-[320px] flex-1 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.18)]"
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
              className="sk-press rounded-[var(--radius-lg)] p-0.5 text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        {/* Artist filter pill */}
        <ArtistFilterPill
          options={artistOptions}
          value={artist}
          onChange={setArtist}
        />

        {/* Mode toggle (Projects / Songs) — pushed to the right */}
        <div className="ml-auto flex">
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

      {/* Body — single panel that both toggles control via aria-controls. */}
      <div id={RESULTS_PANEL_ID} role="tabpanel" aria-label="Library results">
        {filteredTracks.length === 0 ? (
          <EmptyResult
            hasQuery={Boolean(search.trim()) || artist !== "all"}
            hasProjects={totalProjects > 0}
          />
        ) : mode === "projects" ? (
          view === "grid" ? (
            <ProjectsGrid projects={projects} />
          ) : (
            <ProjectsTable projects={projects} />
          )
        ) : view === "grid" ? (
          <SongsGrid songs={filteredTracks} />
        ) : (
          <SongsTable songs={sortedSongs} />
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

function ModeToggle({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
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

function ViewToggle({
  value,
  onChange,
}: {
  value: View;
  onChange: (v: View) => void;
}) {
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
        "sk-press inline-flex items-center gap-1.5 rounded-[7px] font-bold sk-trans",
        iconOnly ? "px-[9px] py-[6px]" : "px-[11px] py-[6px]",
        "text-[11.5px]",
        active
          ? "bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : "bg-transparent text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
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
        "sk-press sk-trans relative inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-1.5 text-[12px] font-semibold",
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
        "sk-trans relative inline-flex items-center gap-1.5 rounded-[9px] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-[11.5px] font-semibold",
        disabled
          ? "cursor-not-allowed text-[rgb(var(--fg-faint))]"
          : "sk-press text-[rgb(var(--fg-default))]",
      ].join(" ")}
      style={{ border: "1px solid rgb(var(--border-subtle))" }}
      aria-disabled={disabled}
      title={disabled ? "Sort applies to Songs · Table view" : undefined}
    >
      <span className="pointer-events-none text-[rgb(var(--fg-muted))]">
        Sort
      </span>
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

function ProjectsGrid({ projects }: { projects: ProjectAggregate[] }) {
  // Featured layout: when the library has more than 6 projects the
  // first card spans 2 columns. Breaks the "every card identical" grid
  // monotony without inventing a new component. Below that threshold a
  // single oversized card would just look lopsided, so we stay in the
  // uniform grid.
  const FEATURED_THRESHOLD = 6;
  const useFeatured = projects.length > FEATURED_THRESHOLD;
  return (
    <ul
      role="list"
      className="grid gap-[22px]"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))" }}
    >
      {projects.map((p, i) => (
        <li
          key={p.id}
          className="sk-stagger-item"
          style={
            {
              "--i": String(i),
              gridColumn: useFeatured && i === 0 ? "span 2" : undefined,
            } as React.CSSProperties
          }
        >
          <ProjectCard project={p} />
        </li>
      ))}
    </ul>
  );
}

function ProjectCard({ project }: { project: ProjectAggregate }) {
  return (
    <Link
      href={`/dashboard/music/project/${project.id}`}
      className="sk-lift group flex flex-col gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]"
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
          className="pointer-events-none absolute bottom-3 right-3 flex h-11 w-11 translate-y-1.5 scale-90 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-default))] opacity-0 shadow-[0_6px_14px_rgba(17,16,9,0.32)] group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100"
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
          className="truncate font-display text-[15px] font-bold leading-tight text-[rgb(var(--fg-default))]"
          style={{ letterSpacing: "-0.02em" }}
        >
          {project.title}
        </p>
        {project.artistLabel ? (
          <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
            {project.artistLabel}
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

function ProjectsTable({ projects }: { projects: ProjectAggregate[] }) {
  return (
    <div
      className="overflow-hidden rounded-[12px] border"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      {/* Header */}
      <div
        className="grid items-center gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
        style={{
          gridTemplateColumns:
            "44px minmax(0,2.2fr) minmax(0,1.4fr) 90px 70px 80px 70px",
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
              href={`/dashboard/music/project/${p.id}`}
              className="grid items-center gap-3 px-4 py-2.5 hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:bg-[rgb(var(--bg-overlay))] active:bg-[rgb(var(--bg-overlay))] active:scale-[0.992]"
              style={{
                gridTemplateColumns:
                  "44px minmax(0,2.2fr) minmax(0,1.4fr) 90px 70px 80px 70px",
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
              <span className="truncate font-display text-[14px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                {p.title}
              </span>
              <span className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
                {p.artistLabel}
              </span>
              <span>
                <span className="inline-flex items-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-2 py-0.5 font-mono text-[10px] font-bold text-[rgb(var(--fg-default))]">
                  {p.kind}
                </span>
              </span>
              <span className="text-right font-mono text-[11.5px] tabular-nums text-[rgb(var(--fg-muted))]">
                {String(p.trackCount)}
              </span>
              <span className="text-right font-mono text-[11.5px] tabular-nums text-[rgb(var(--fg-muted))]">
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
  );
}

function SongsGrid({ songs }: { songs: MusicLibraryRow[] }) {
  const nowPlaying = useNowPlaying();
  return (
    <ul
      role="list"
      className="grid gap-[22px]"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))" }}
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
          />
        </li>
      ))}
    </ul>
  );
}

function SongCard({ song, isPlaying }: { song: MusicLibraryRow; isPlaying: boolean }) {
  const gradient = gradientForSeed(song.projectId);
  const subtitle = [song.projectTitle, song.clientName ?? song.trackArtist]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href={`/dashboard/music/${song.id}`}
      className="sk-lift group flex flex-col gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]"
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
        <span className="absolute right-2.5 top-2.5 z-10 rounded-[4px] bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
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
            className="absolute bottom-3 right-3 z-10 inline-flex h-[18px] w-[18px] items-center justify-center text-white"
            style={{ opacity: 0.92 }}
          >
            <EqBars playing size={13} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <p
          className="truncate font-display text-[13px] font-bold leading-tight text-[rgb(var(--fg-default))]"
          style={{ letterSpacing: "-0.01em" }}
        >
          {song.trackTitle}
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[11px] text-[rgb(var(--fg-muted))]">
            {subtitle}
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

function SongsTable({ songs }: { songs: MusicLibraryRow[] }) {
  const nowPlaying = useNowPlaying();
  // 9 columns now: play/idx, cover thumb, title, artist, version, plays,
  // notes, length, actions. The 40px cover sits between the play column
  // and the title — same pattern Spotify + Apple Music use in their
  // table view (small album art next to track title for visual identity).
  const cols =
    "44px 40px minmax(0,2fr) minmax(0,1fr) 70px 64px 60px 64px 36px";

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
    <div
      className="overflow-hidden rounded-[12px] border"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <div
        className="grid items-center gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
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
                href={`/dashboard/music/${s.id}`}
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
                      "sk-press inline-flex h-7 w-7 items-center justify-center rounded-full sk-trans disabled:opacity-40",
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
                      "pointer-events-none absolute font-mono text-[11px] tabular-nums text-[rgb(var(--fg-faint))] transition",
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
                <span className="min-w-0 block">
                  <p className="truncate text-[13.5px] font-bold leading-tight text-[rgb(var(--fg-default))]">
                    {s.trackTitle}
                  </p>
                  <p className="truncate text-[11px] text-[rgb(var(--fg-muted))]">
                    {s.projectTitle}
                  </p>
                </span>

                <span className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
                  {s.clientName ?? s.trackArtist ?? ""}
                </span>

                <span>
                  <span className="inline-flex items-center rounded-[4px] bg-[rgb(var(--bg-sunken))] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-[rgb(var(--fg-default))]">
                    {s.label}
                  </span>
                </span>

                <span
                  className="text-right font-mono text-[11px] tabular-nums text-[rgb(var(--fg-muted))]"
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

                <span className="text-right font-mono text-[12px] tabular-nums text-[rgb(var(--fg-muted))]">
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
                    className="sk-press sk-trans rounded-[var(--radius-lg)] p-1 text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]"
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
  );
}

function EmptyResult({
  hasQuery,
  hasProjects,
}: {
  hasQuery: boolean;
  hasProjects: boolean;
}) {
  // Three states:
  //   1. Filter active   → tell the user to clear it
  //   2. No projects yet → send them to create one (uploads need a
  //                        project to live inside)
  //   3. Has projects, no tracks → show the upload hint
  if (hasQuery) {
    return (
      <EmptyShell
        title="Nothing matches"
        body="Clear the search or the artist filter to see everything."
      />
    );
  }
  if (!hasProjects) {
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
