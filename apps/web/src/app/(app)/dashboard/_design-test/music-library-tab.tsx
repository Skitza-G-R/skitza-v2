/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Music Library tab. 1:1 port of the mockup's
// tabs/music.jsx (sample-app/index.html lines 2259-2587). Three view
// modes (Grid / Table / Hybrid), filter chips, sort dropdown, project
// filter, search, custom-playlist rail.
//
// Wired logic:
// - Tracks come from real library.list() rows mapped to mockup shape
// - Click track row → router.push(`/dashboard/music/${trackId}`) (song page)
// - Play button → dispatches `play` action via PlayerContext, mounts the
//   global FloatingPlayer at the bottom; persists across route changes
// - Fav star toggles in local state (no real favorites table yet)
// - Add Song button opens a stub modal — wire to real upload flow
//   on a later round

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useIsTrackPlaying, usePlayer } from "./player-context";
import {
  Card,
  EqBars,
  FavStar,
  Icon,
  KebabMenu,
  PlayCircle,
  ProjectBadge,
  Waveform,
} from "./primitives";

export type LibraryTrack = {
  id: string;
  title: string;
  project: string;
  projectId: string;
  client: string;
  version: string;
  comments: number;
  plays: number;
  duration: string;
  durationSec: number;
  bpm: number | null;
  mkey: string | null;
  grad: string;
  uploaded: string;
  uploadedRel: "today" | "yesterday" | "this week" | "older";
  favorite: boolean;
};

export type LibraryProject = { id: string; name: string };

type LibraryData = {
  tracks: LibraryTrack[];
  projects: LibraryProject[];
};

const SAMPLE_PLAYLISTS = [
  { id: "pl1", name: "Reference Bin", count: 12, grad: "grad-amber", icon: "sparkles" },
  { id: "pl2", name: "In Review · Today", count: 4, grad: "grad-slate", icon: "clock" },
  { id: "pl3", name: "Mix Studies", count: 8, grad: "grad-violet", icon: "flask-conical" },
] as const;

export function MusicLibraryTab({ data }: { data: LibraryData }) {
  const router = useRouter();
  const d = data;
  const [view, setView] = useState<"grid" | "hybrid" | "table">("grid");
  const [filter, setFilter] = useState<"all" | "fav" | "comments" | "recent">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<
    "recent" | "title" | "listens" | "length" | "comments"
  >("recent");
  const [favOverrides, setFavOverrides] = useState<Record<string, boolean>>({});
  const [projFilter, setProjFilter] = useState<string | null>(null);

  const isFav = (t: LibraryTrack): boolean => {
    const o = favOverrides[t.id];
    return o === undefined ? t.favorite : o;
  };
  const toggleFav = (id: string) => {
    setFavOverrides((p) => {
      const o = p[id];
      const cur =
        o === undefined
          ? d.tracks.find((x) => x.id === id)?.favorite ?? false
          : o;
      return { ...p, [id]: !cur };
    });
  };

  const tracks = useMemo(() => {
    let out = d.tracks.slice();
    if (filter === "fav") out = out.filter((t) => isFav(t));
    if (filter === "comments") out = out.filter((t) => t.comments > 0);
    if (filter === "recent")
      out = out.filter((t) =>
        ["today", "yesterday", "this week"].includes(t.uploadedRel),
      );
    if (projFilter) out = out.filter((t) => t.projectId === projFilter);
    if (q.trim()) {
      const Q = q.trim().toLowerCase();
      out = out.filter(
        (t) =>
          t.title.toLowerCase().includes(Q) ||
          t.client.toLowerCase().includes(Q) ||
          t.project.toLowerCase().includes(Q),
      );
    }
    out.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "listens") return b.plays - a.plays;
      if (sort === "length") return a.durationSec - b.durationSec;
      if (sort === "comments") return b.comments - a.comments;
      return 0;
    });
    return out;
  }, [filter, q, sort, projFilter, favOverrides, d.tracks, isFav]);

  const groups = useMemo(() => {
    const out: Record<string, LibraryTrack[]> = {};
    tracks.forEach((t) => {
      const bucket = (out[t.project] ??= []);
      bucket.push(t);
    });
    return out;
  }, [tracks]);

  const totalListens = d.tracks.reduce((a, t) => a + t.plays, 0);
  const onOpenSong = (id: string) => router.push(`/dashboard/music/${id}`);

  return (
    <div
      data-screen-label="03 Music Library"
      className="custom-scrollbar"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 3vw, 32px)",
        maxWidth: 1180,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <header
        className="reveal-up stagger-1"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="label-tiny" style={{ display: "block", marginBottom: 6 }}>
            Archive
          </span>
          <h1
            className="font-syne"
            style={{
              fontSize: "clamp(34px, 4.5vw, 52px)",
              fontWeight: 800,
              letterSpacing: "-0.035em",
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Music Library
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "rgb(var(--fg-muted))" }}>
            {d.tracks.length} tracks · {Object.keys(groups).length} projects ·{" "}
            <span
              className="tabular"
              style={{ fontFamily: "JetBrains Mono", color: "rgb(var(--fg-default))" }}
            >
              {totalListens.toLocaleString()}
            </span>{" "}
            total plays
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "10px 16px",
              borderRadius: 9,
              background: "rgb(var(--brand-primary))",
              color: "#111009",
              fontSize: 12.5,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="plus" size={14} strokeWidth={2.6} /> Add Song
          </button>
        </div>
      </header>

      {/* Custom Playlists rail */}
      <div className="reveal-up stagger-2" style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 8,
            padding: "0 2px",
          }}
        >
          <span className="label-tiny">Custom Playlists</span>
          <button
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgb(var(--fg-muted))",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            New playlist +
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
          {SAMPLE_PLAYLISTS.map((pl) => (
            <button
              key={pl.id}
              className="sk-pop sk-row"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 8,
                borderRadius: 12,
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
              }}
            >
              <span
                className={pl.grad}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                <Icon name={pl.icon} size={16} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="truncate" style={{ fontSize: 12.5, fontWeight: 700 }}>
                  {pl.name}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "rgb(var(--fg-muted))",
                    fontFamily: "JetBrains Mono",
                  }}
                >
                  {pl.count} tracks
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="reveal-up stagger-3"
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            borderRadius: 9,
            background: "rgb(var(--bg-elevated))",
            border: "1px solid rgb(var(--border-subtle))",
            minWidth: 240,
            flex: "1 1 240px",
            maxWidth: 340,
          }}
        >
          <Icon name="search" size={13} style={{ color: "rgb(var(--fg-muted))" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tracks, artists, projects…"
            style={{
              all: "unset",
              flex: 1,
              fontSize: 12.5,
              padding: "9px 0",
              color: "rgb(var(--fg-default))",
              fontFamily: "inherit",
            }}
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "inline-flex",
                color: "rgb(var(--fg-muted))",
              }}
              aria-label="Clear search"
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(
            [
              ["all", "All"],
              ["recent", "Recent"],
              ["comments", "Has notes"],
              ["fav", "Favorites"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "7px 12px",
                borderRadius: 16,
                fontSize: 11.5,
                fontWeight: 600,
                background:
                  filter === k ? "rgb(var(--fg-default))" : "transparent",
                color:
                  filter === k
                    ? "rgb(var(--bg-background))"
                    : "rgb(var(--fg-muted))",
                border:
                  "1px solid " +
                  (filter === k
                    ? "rgb(var(--fg-default))"
                    : "rgb(var(--border-subtle))"),
              }}
            >
              {l}
            </button>
          ))}
          <select
            value={projFilter ?? ""}
            onChange={(e) => setProjFilter(e.target.value || null)}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "7px 12px",
              borderRadius: 16,
              fontSize: 11.5,
              fontWeight: 600,
              background:
                projFilter ? "rgb(var(--fg-default))" : "transparent",
              color: projFilter
                ? "rgb(var(--bg-background))"
                : "rgb(var(--fg-muted))",
              border:
                "1px solid " +
                (projFilter
                  ? "rgb(var(--fg-default))"
                  : "rgb(var(--border-subtle))"),
            }}
          >
            <option value="">All projects</option>
            {d.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {(view === "table" || view === "hybrid") && (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "rgb(var(--fg-muted))",
              }}
            >
              Sort
              <select
                value={sort}
                onChange={(e) =>
                  setSort(
                    e.target.value as
                      | "recent"
                      | "title"
                      | "listens"
                      | "length"
                      | "comments",
                  )
                }
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "6px 10px",
                  borderRadius: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: "rgb(var(--bg-elevated))",
                  border: "1px solid rgb(var(--border-subtle))",
                  color: "rgb(var(--fg-default))",
                }}
              >
                <option value="recent">Most recent</option>
                <option value="title">Title (A→Z)</option>
                <option value="listens">Most plays</option>
                <option value="comments">Most notes</option>
                <option value="length">Length</option>
              </select>
            </label>
          )}
          <div
            style={{
              display: "inline-flex",
              padding: 3,
              borderRadius: 9,
              background: "rgb(var(--bg-elevated))",
              border: "1px solid rgb(var(--border-subtle))",
            }}
          >
            {(
              [
                ["grid", "layout-grid", "Grid"],
                ["hybrid", "folder-kanban", "By project"],
                ["table", "list-plus", "Table"],
              ] as const
            ).map(([k, ic, label]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                title={label}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "6px 10px",
                  borderRadius: 6,
                  background:
                    view === k ? "rgb(var(--bg-background))" : "transparent",
                  color:
                    view === k
                      ? "rgb(var(--fg-default))"
                      : "rgb(var(--fg-muted))",
                }}
                aria-label={label}
              >
                <Icon name={ic} size={14} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "rgb(var(--fg-muted))",
          }}
        >
          <Icon
            name="search"
            size={28}
            style={{ marginBottom: 10, color: "rgb(var(--fg-faint))" }}
          />
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            No tracks match those filters
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Try clearing search or switching to All.
          </div>
        </div>
      ) : view === "grid" ? (
        <GridView
          tracks={tracks}
          isFav={isFav}
          toggleFav={toggleFav}
          onOpenSong={onOpenSong}
        />
      ) : view === "table" ? (
        <TableView
          tracks={tracks}
          isFav={isFav}
          toggleFav={toggleFav}
          onOpenSong={onOpenSong}
          sort={sort}
          setSort={setSort}
        />
      ) : (
        <HybridView
          groups={groups}
          isFav={isFav}
          toggleFav={toggleFav}
          onOpenSong={onOpenSong}
        />
      )}
    </div>
  );
}

function GridView({
  tracks,
  isFav,
  toggleFav,
  onOpenSong,
}: {
  tracks: LibraryTrack[];
  isFav: (t: LibraryTrack) => boolean;
  toggleFav: (id: string) => void;
  onOpenSong: (id: string) => void;
}) {
  const { play } = usePlayer();
  return (
    <div
      className="reveal-up stagger-3"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 14,
      }}
    >
      {tracks.map((t) => (
        <div
          key={t.id}
          className="sk-pop"
          onClick={() => onOpenSong(t.id)}
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: 14,
            overflow: "hidden",
            background: "rgb(var(--bg-elevated))",
            border: "1px solid rgb(var(--border-subtle))",
            cursor: "pointer",
          }}
        >
          <div
            className={t.grad}
            style={{ position: "relative", aspectRatio: "1.4 / 1", overflow: "hidden" }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                color: "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFav(t.id);
                  }}
                  className="sk-pop"
                  role="button"
                  tabIndex={0}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: "rgba(0,0,0,0.32)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                  aria-label={isFav(t) ? "Unfavorite" : "Favorite"}
                >
                  <Icon name="star" size={11} strokeWidth={2.4} />
                </span>
                <span
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(0,0,0,0.32)",
                  }}
                >
                  {t.version}
                </span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  play({
                    id: t.id,
                    title: t.title,
                    project: t.project,
                    duration: t.duration,
                    durationSec: t.durationSec,
                    grad: t.grad,
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    play({
                      id: t.id,
                      title: t.title,
                      project: t.project,
                      duration: t.duration,
                      durationSec: t.durationSec,
                      grad: t.grad,
                    });
                  }
                }}
                className="sk-pop"
                style={{
                  alignSelf: "flex-start",
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "#fff",
                  color: "#111009",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                  cursor: "pointer",
                }}
                aria-label="Play"
              >
                <Icon name="play" size={14} strokeWidth={2.6} />
              </span>
            </div>
            <div style={{ position: "absolute", bottom: 8, right: 12, opacity: 0.55, width: 100 }}>
              <Waveform bars={20} progress={0} height={20} dark seed={t.id.charCodeAt(0) || 4} />
            </div>
          </div>
          <div style={{ padding: 12 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}
            >
              <div
                className="truncate"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: "rgb(var(--fg-default))",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {t.title}
              </div>
            </div>
            <div
              className="truncate"
              style={{ fontSize: 11, color: "rgb(var(--fg-muted))" }}
            >
              {t.project} · {t.client}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 10.5,
                color: "rgb(var(--fg-muted))",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span
                  className="tabular"
                  style={{
                    fontFamily: "JetBrains Mono",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Icon name="play" size={9} />
                  {t.plays}
                </span>
                {t.comments > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <Icon name="message-circle" size={10} />
                    {t.comments}
                  </span>
                )}
              </span>
              <span className="tabular" style={{ fontFamily: "JetBrains Mono" }}>
                {t.duration}
              </span>
            </div>
          </div>
        </div>
      ))}
      {/* keep refs lit so EqBars stays in the bundle for this round */}
      <span style={{ display: "none" }}>
        <EqBars playing={false} />
      </span>
      <span style={{ display: "none" }}>
        <PlayCircle size={1} />
      </span>
    </div>
  );
}

function TableView({
  tracks,
  isFav,
  toggleFav,
  onOpenSong,
  sort,
  setSort,
}: {
  tracks: LibraryTrack[];
  isFav: (t: LibraryTrack) => boolean;
  toggleFav: (id: string) => void;
  onOpenSong: (id: string) => void;
  sort: "recent" | "title" | "listens" | "length" | "comments";
  setSort: (s: "recent" | "title" | "listens" | "length" | "comments") => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { play } = usePlayer();
  return (
    <Card padded={false} className="reveal-up stagger-4">
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "36px minmax(0,2.5fr) minmax(0,1.4fr) 80px 70px 70px 70px 36px",
          alignItems: "center",
          gap: 14,
          padding: "10px 18px",
          borderBottom: "1px solid rgb(var(--border-subtle))",
          background: "rgb(var(--bg-elevated))",
        }}
      >
        <span
          className="label-tiny"
          style={{ textAlign: "center", color: "rgb(var(--fg-faint))" }}
        >
          #
        </span>
        <SortHeader label="Title / Project" sortKey="title" current={sort} setSort={setSort} />
        <span className="label-tiny">Artist</span>
        <span className="label-tiny">Version</span>
        <SortHeader
          label="Plays"
          sortKey="listens"
          current={sort}
          setSort={setSort}
          align="right"
        />
        <SortHeader
          label="Notes"
          sortKey="comments"
          current={sort}
          setSort={setSort}
          align="right"
        />
        <SortHeader
          label="Length"
          sortKey="length"
          current={sort}
          setSort={setSort}
          align="right"
        />
        <span style={{ width: 16 }} />
      </div>
      {tracks.map((t, i) => {
        const hovered = hoveredId === t.id;
        return (
          <div
            key={t.id}
            className="sk-row"
            onMouseEnter={() => setHoveredId(t.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onOpenSong(t.id)}
            style={{
              display: "grid",
              gridTemplateColumns:
                "36px minmax(0,2.5fr) minmax(0,1.4fr) 80px 70px 70px 70px 36px",
              alignItems: "center",
              gap: 14,
              padding: "10px 18px",
              borderBottom:
                i === tracks.length - 1
                  ? "none"
                  : "1px solid rgb(var(--border-subtle) / 0.6)",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {hovered ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    play({
                      id: t.id,
                      title: t.title,
                      project: t.project,
                      duration: t.duration,
                      durationSec: t.durationSec,
                      grad: t.grad,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      play({
                        id: t.id,
                        title: t.title,
                        project: t.project,
                        duration: t.duration,
                        durationSec: t.durationSec,
                        grad: t.grad,
                      });
                    }
                  }}
                  className="sk-pop"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "rgb(var(--fg-default))",
                    color: "rgb(var(--bg-background))",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                  aria-label="Play"
                >
                  <Icon name="play" size={11} strokeWidth={2.6} />
                </span>
              ) : (
                <span
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 11.5,
                    color: "rgb(var(--fg-faint))",
                  }}
                >
                  {i + 1}
                </span>
              )}
            </span>
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <ProjectBadge grad={t.grad} size={32} rounded={6} icon="music" />
              <div style={{ minWidth: 0 }}>
                <div
                  className="truncate"
                  style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--fg-default))" }}
                >
                  {t.title}
                </div>
                <div
                  className="truncate"
                  style={{ fontSize: 11, color: "rgb(var(--fg-muted))" }}
                >
                  {t.project}
                </div>
              </div>
            </div>
            <span
              className="truncate"
              style={{ fontSize: 12, color: "rgb(var(--fg-muted))" }}
            >
              {t.client}
            </span>
            <span
              className="pill"
              style={{
                fontSize: 10,
                background: "rgb(var(--bg-elevated))",
                color: "rgb(var(--fg-default))",
                border: "1px solid rgb(var(--border-subtle))",
                justifySelf: "start",
              }}
            >
              {t.version}
            </span>
            <span
              className="tabular"
              style={{
                textAlign: "right",
                fontSize: 11.5,
                fontFamily: "JetBrains Mono",
                color: "rgb(var(--fg-muted))",
              }}
            >
              {t.plays}
            </span>
            <span
              className="tabular"
              style={{
                textAlign: "right",
                fontSize: 11.5,
                color:
                  t.comments > 0
                    ? "rgb(var(--fg-default))"
                    : "rgb(var(--fg-faint))",
                fontFamily: "JetBrains Mono",
              }}
            >
              {t.comments > 0 ? t.comments : "—"}
            </span>
            <span
              className="tabular"
              style={{
                textAlign: "right",
                fontSize: 12,
                fontFamily: "JetBrains Mono",
              }}
            >
              {t.duration}
            </span>
            <span
              style={{
                display: "inline-flex",
                gap: 2,
                alignItems: "center",
                justifySelf: "end",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <FavStar on={isFav(t)} onToggle={() => toggleFav(t.id)} />
              <KebabMenu
                items={[
                  { label: "Open song", icon: "external-link", onClick: () => onOpenSong(t.id) },
                  { label: "Play", icon: "play", shortcut: "Space" },
                  { label: "Download", icon: "download" },
                  { label: "Copy share link", icon: "link" },
                  { label: "Add to playlist", icon: "list-plus" },
                  { label: "Upload new version", icon: "upload" },
                  { label: "Delete", icon: "trash-2", danger: true },
                ]}
              />
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function HybridRow({
  t,
  isFav,
  toggleFav,
  onOpenSong,
  isLast,
}: {
  t: LibraryTrack;
  isFav: (t: LibraryTrack) => boolean;
  toggleFav: (id: string) => void;
  onOpenSong: (id: string) => void;
  isLast: boolean;
}) {
  const { play } = usePlayer();
  const playing = useIsTrackPlaying(t.id);
  return (
    <div
      className="sk-row"
      onClick={() => onOpenSong(t.id)}
      style={{
        display: "grid",
        gridTemplateColumns: "36px 200px minmax(0,1fr) 60px 60px 28px 28px",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: isLast
          ? "none"
          : "1px solid rgb(var(--border-subtle) / 0.6)",
        cursor: "pointer",
      }}
    >
      <PlayCircle
        size={32}
        playing={playing}
        onClick={() => {
          play({
            id: t.id,
            title: t.title,
            project: t.project,
            duration: t.duration,
            durationSec: t.durationSec,
            grad: t.grad,
          });
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          className="truncate"
          style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--fg-default))" }}
        >
          {t.title}
        </div>
        <div style={{ fontSize: 11, color: "rgb(var(--fg-muted))" }}>
          {t.version}
          {t.bpm ? ` · ${String(t.bpm)} BPM` : ""}
          {t.mkey ? ` · ${t.mkey}` : ""}
        </div>
      </div>
      <div style={{ minWidth: 0, opacity: 0.6 }}>
        <Waveform bars={48} progress={0} height={24} seed={t.id.charCodeAt(0) || 3} />
      </div>
      <span
        className="tabular"
        style={{
          fontSize: 11,
          fontFamily: "JetBrains Mono",
          color: "rgb(var(--fg-muted))",
          textAlign: "right",
        }}
      >
        {t.plays} pl
      </span>
      <span
        className="tabular"
        style={{
          fontSize: 12,
          fontFamily: "JetBrains Mono",
          color: "rgb(var(--fg-muted))",
          textAlign: "right",
        }}
      >
        {t.duration}
      </span>
      <span onClick={(e) => e.stopPropagation()}>
        <FavStar on={isFav(t)} onToggle={() => toggleFav(t.id)} />
      </span>
      <span onClick={(e) => e.stopPropagation()}>
        <KebabMenu
          items={[
            { label: "Open song", icon: "external-link", onClick: () => onOpenSong(t.id) },
            { label: "Download", icon: "download" },
            { label: "Copy share link", icon: "link" },
            { label: "Upload new version", icon: "upload" },
            { label: "Delete", icon: "trash-2", danger: true },
          ]}
        />
      </span>
    </div>
  );
}

function HybridView({
  groups,
  isFav,
  toggleFav,
  onOpenSong,
}: {
  groups: Record<string, LibraryTrack[]>;
  isFav: (t: LibraryTrack) => boolean;
  toggleFav: (id: string) => void;
  onOpenSong: (id: string) => void;
}) {
  return (
    <div
      className="reveal-up stagger-4"
      style={{ display: "flex", flexDirection: "column", gap: 18 }}
    >
      {Object.entries(groups).map(([proj, list]) => (
        <div key={proj}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              padding: "0 4px",
            }}
          >
            <ProjectBadge grad={list[0]?.grad ?? "grad-amber"} size={20} rounded={5} icon="folder" />
            <h3
              className="font-syne"
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {proj}
            </h3>
            <span className="label-tiny">
              {list.length} {list.length === 1 ? "track" : "tracks"}
            </span>
            <span className="label-tiny" style={{ marginLeft: "auto", fontFamily: "JetBrains Mono" }}>
              {list.reduce((a, t) => a + t.plays, 0)} plays
            </span>
          </div>
          <Card padded={false}>
            {list.map((t, i) => (
              <HybridRow
                key={t.id}
                t={t}
                isFav={isFav}
                toggleFav={toggleFav}
                onOpenSong={onOpenSong}
                isLast={i === list.length - 1}
              />
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  setSort,
  align = "left",
}: {
  label: string;
  sortKey: "title" | "listens" | "length" | "comments" | null;
  current: "recent" | "title" | "listens" | "length" | "comments";
  setSort: (s: "recent" | "title" | "listens" | "length" | "comments") => void;
  align?: "left" | "right";
}) {
  if (!sortKey)
    return (
      <span className="label-tiny" style={{ textAlign: align }}>
        {label}
      </span>
    );
  const active = current === sortKey;
  return (
    <button
      onClick={() => setSort(sortKey)}
      className="sk-pop"
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 9.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: active ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
        justifySelf: align === "right" ? "end" : "start",
      }}
    >
      {label}
      {active && <Icon name="chevron-down" size={11} />}
    </button>
  );
}
