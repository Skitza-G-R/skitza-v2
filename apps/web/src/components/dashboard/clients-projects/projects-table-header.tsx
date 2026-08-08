"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type ProjectListSort = "oldest" | "newest" | "phase" | "project";

interface ProjectsTableHeaderProps {
  sort: ProjectListSort;
  onSortChange: (next: ProjectListSort) => void;
}

function SortIcon({ active, descending = false }: { active: boolean; descending?: boolean }) {
  if (!active) return <ArrowUpDown size={12} strokeWidth={2.1} aria-hidden />;
  return descending ? (
    <ArrowDown size={12} strokeWidth={2.1} aria-hidden />
  ) : (
    <ArrowUp size={12} strokeWidth={2.1} aria-hidden />
  );
}

function sortableHeaderClass(active: boolean): string {
  return [
    "inline-flex min-h-11 items-center gap-1.5 text-left text-[11px] font-bold tracking-[0.1em] uppercase",
    "focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
    active
      ? "text-[rgb(var(--fg-default))]"
      : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
  ].join(" ");
}

/** Five-column semantic table header for the producer's root Projects list. */
export function ProjectsTableHeader({ sort, onSortChange }: ProjectsTableHeaderProps) {
  const startedActive = sort === "oldest" || sort === "newest";

  return (
    <tr className="border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.72)]">
      <th
        scope="col"
        aria-sort={sort === "project" ? "ascending" : "none"}
        className="px-4 py-1 text-left"
      >
        <button
          type="button"
          onClick={() => {
            onSortChange("project");
          }}
          className={sortableHeaderClass(sort === "project")}
        >
          Project
          <SortIcon active={sort === "project"} />
        </button>
      </th>
      <th
        scope="col"
        className="px-4 py-1 text-left text-[11px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase"
      >
        Client
      </th>
      <th
        scope="col"
        aria-sort={startedActive ? (sort === "newest" ? "descending" : "ascending") : "none"}
        className="px-4 py-1 text-left"
      >
        <button
          type="button"
          onClick={() => {
            onSortChange(sort === "oldest" ? "newest" : "oldest");
          }}
          className={sortableHeaderClass(startedActive)}
        >
          Started
          <SortIcon active={startedActive} descending={sort === "newest"} />
        </button>
      </th>
      <th
        scope="col"
        aria-sort={sort === "phase" ? "ascending" : "none"}
        className="px-4 py-1 text-left"
      >
        <button
          type="button"
          onClick={() => {
            onSortChange("phase");
          }}
          className={sortableHeaderClass(sort === "phase")}
        >
          Phase
          <SortIcon active={sort === "phase"} />
        </button>
      </th>
      <th
        scope="col"
        className="px-3 py-1 text-right text-[11px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase"
      >
        Actions
      </th>
    </tr>
  );
}
