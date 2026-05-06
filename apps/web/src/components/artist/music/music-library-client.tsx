"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

// Polished Music Library — mirrors the locked design's:
//   - Hero headline ("Music." with brand accent dot)
//   - Avatar producer-filter rail (only when 2+ studios)
//   - Filter chips (All / Recent / With comments)
//   - Card list with per-row subtle metadata
//
// Pure client UI — the parent server component fetches and passes the
// already-shaped projects array. We just filter + sort in memory.

export type MusicProjectRow = {
  projectId: string;
  title: string;
  producerId: string;
  producerName: string;
  producerSlug: string;
  latestTrackTitle: string | null;
  latestTrackUploadedAt: Date | null;
  trackCount: number;
};

export type StudioOption = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

type Filter = "all" | "recent" | "with_tracks";

export function MusicLibraryClient({
  projects,
  studios,
}: {
  projects: MusicProjectRow[];
  studios: StudioOption[];
}) {
  const [producerFilter, setProducerFilter] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (producerFilter !== "all" && p.producerId !== producerFilter)
        return false;
      if (filter === "with_tracks" && p.trackCount === 0) return false;
      if (filter === "recent") {
        // "Recent" = uploaded within the last 14 days. If a project
        // has never had an upload, it's never recent.
        if (!p.latestTrackUploadedAt) return false;
        const ageDays =
          (Date.now() - p.latestTrackUploadedAt.getTime()) /
          (1000 * 60 * 60 * 24);
        if (ageDays > 14) return false;
      }
      return true;
    });
  }, [projects, producerFilter, filter]);

  const totalProducers = studios.length;
  const totalTracks = projects.reduce((acc, p) => acc + p.trackCount, 0);

  return (
    <div className="reveal-up space-y-4">
      {/* Hero */}
      <header className="px-1">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          Music
          <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
        </h1>
        <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
          {totalTracks} tracks across {totalProducers}{" "}
          {totalProducers === 1 ? "producer" : "producers"}
        </p>
      </header>

      {/* Producer avatar rail — only when 2+ studios */}
      {studios.length > 1 ? (
        <div
          className="no-scrollbar flex gap-2.5 overflow-x-auto px-1 py-1"
          aria-label="Filter by producer"
          role="tablist"
        >
          <ProducerChip
            label="All"
            initials="All"
            active={producerFilter === "all"}
            onClick={() => {
              setProducerFilter("all");
            }}
          />
          {studios.map((s) => (
            <ProducerChip
              key={s.producerId}
              label={s.name}
              initials={initialsOf(s.name)}
              active={producerFilter === s.producerId}
              onClick={() => {
                setProducerFilter(s.producerId);
              }}
            />
          ))}
        </div>
      ) : null}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 px-1">
        <FilterChip
          label="All"
          active={filter === "all"}
          onClick={() => {
            setFilter("all");
          }}
        />
        <FilterChip
          label="Recent"
          active={filter === "recent"}
          onClick={() => {
            setFilter("recent");
          }}
        />
        <FilterChip
          label="With tracks"
          active={filter === "with_tracks"}
          onClick={() => {
            setFilter("with_tracks");
          }}
        />
      </div>

      {/* Project list */}
      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]">
          {projects.length === 0
            ? "No tracks yet. Your producer will upload your mixes here once work begins."
            : "Nothing matches that filter. Try All."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => (
            <li key={p.projectId}>
              <ProjectRow project={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProducerChip({
  label,
  initials,
  active,
  onClick,
}: {
  label: string;
  initials: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className="sk-press flex shrink-0 flex-col items-center gap-1.5"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full border font-display text-[13px] font-extrabold transition-colors"
        style={{
          background: active
            ? "rgb(var(--bg-sidebar))"
            : "rgb(var(--bg-elevated))",
          color: active
            ? "rgb(var(--brand-primary))"
            : "rgb(var(--fg-muted))",
          borderColor: active
            ? "rgb(var(--bg-sidebar))"
            : "rgb(var(--border-subtle))",
        }}
      >
        {initials}
      </span>
      <span
        className="max-w-[60px] truncate text-[10px] font-medium"
        style={{
          color: active
            ? "rgb(var(--fg-default))"
            : "rgb(var(--fg-muted))",
          fontWeight: active ? 700 : 500,
        }}
      >
        {label}
      </span>
    </button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sk-press rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
      style={{
        background: active
          ? "rgb(var(--bg-sidebar))"
          : "rgb(var(--bg-elevated))",
        color: active
          ? "rgb(var(--fg-onsidebar))"
          : "rgb(var(--fg-secondary))",
        borderColor: active
          ? "rgb(var(--bg-sidebar))"
          : "rgb(var(--border-subtle))",
      }}
    >
      {label}
    </button>
  );
}

function ProjectRow({ project }: { project: MusicProjectRow }) {
  const subtitle = project.latestTrackTitle
    ? project.latestTrackTitle
    : "No tracks yet";
  return (
    <Link
      href={`/artist/music/${project.projectId}`}
      className="sk-lift sk-row flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3"
    >
      {/* Visual marker — small initial-tile so the producer association
          is glanceable even on a long mixed-producer list. */}
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-display text-sm font-extrabold text-[rgb(var(--fg-onsidebar))]"
        style={{
          background:
            "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
        }}
      >
        {initialsOf(project.producerName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-bold text-[rgb(var(--fg-default))]">
          {project.title}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {project.producerName} · {subtitle}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {project.trackCount}{" "}
        {project.trackCount === 1 ? "track" : "tracks"}
      </span>
    </Link>
  );
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}
