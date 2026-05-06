"use client";

// Combined "Clients & Projects" workspace surface.
// Replaces the prior `<ProjectsList />` as the entry point for
// /dashboard/projects. Owns:
//   - The page heading (title + subtitle counts + "+ New" CTA)
//   - The view toggle (Projects | Clients)
//   - A shared search input
//   - Per-view filter chips + sort select
//   - The list/grid render
//   - Bulk selection for Projects only (preserved from the prior list)
//
// The `state` URL param (live/done/archived) is still read by the
// server page and threaded down so deep-links continue to work.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  BulkActionBar,
  useBulkSelection,
  useEscClearsSelection,
} from "~/components/ui/bulk-action-bar";
import {
  ListSearchInput,
  useListSearch,
} from "~/components/ui/list-search";
import { useToast } from "~/components/ui/toast";
import {
  PROJECT_STATES,
  stageToState,
  type ProjectState,
} from "~/lib/projects/states";
import { bulkSetProjectStage } from "~/app/(app)/dashboard/projects/actions";

import { ClientsGrid, type ClientRow } from "./clients-grid";
import {
  ProjectTableRow,
  type ProjectTableRowData,
} from "./project-table-row";

export type ProjectsViewRow = ProjectTableRowData;

type View = "projects" | "clients";

export function ClientsAndProjectsView({
  projects,
  clients,
  activeState,
  currency,
  totalOutstandingCents,
}: {
  projects: ProjectsViewRow[];
  clients: ClientRow[];
  activeState: ProjectState | null;
  // Producer's display currency. Same code applies to both the table
  // (Balance column) and grid (Lifetime / Owed stats).
  currency: string;
  // Pre-summed across all projects — drives the "$X owed" tagline in
  // the page subtitle. Computed server-side to avoid summing again on
  // the client.
  totalOutstandingCents: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isBulkPending, startBulkTransition] = useTransition();
  const { value: q, setValue: setQ, inputRef } = useListSearch();
  const { toast } = useToast();
  const tP = useTranslations("projects");
  const tState = useTranslations("projects.state");
  const tBulk = useTranslations("projects.bulk");

  const [view, setView] = useState<View>("projects");
  const { selection, toggle, setMany, clear } = useBulkSelection();
  useEscClearsSelection(selection.size > 0, clear);

  // ─── Derived: filtered + grouped projects ─────────────────────────
  const projectStats = useMemo(() => {
    const total = projects.length;
    const active = projects.filter((p) => stageToState(p.stage) === "live").length;
    return { total, active };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const query = q.trim().toLowerCase();
    return projects.filter((p) => {
      // 1. State filter (URL-driven)
      if (activeState !== null && stageToState(p.stage) !== activeState) {
        return false;
      }
      // 2. Search filter
      if (!query) return true;
      return (
        p.title.toLowerCase().includes(query) ||
        p.artistName.toLowerCase().includes(query)
      );
    });
  }, [projects, activeState, q]);

  // Grouped by state for sectioned render — only matters when no
  // explicit state filter is active.
  const groupedProjects = useMemo(() => {
    const out: Record<ProjectState, ProjectsViewRow[]> = {
      live: [],
      done: [],
      archived: [],
    };
    for (const p of filteredProjects) {
      out[stageToState(p.stage)].push(p);
    }
    return out;
  }, [filteredProjects]);

  // ─── Bulk select helpers (projects only) ──────────────────────────
  const visibleIds: string[] = useMemo(
    () => filteredProjects.map((p) => p.id),
    [filteredProjects],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) setMany(visibleIds, false);
    else setMany(visibleIds, true);
  };

  const runBulkStage = (stage: "archived" | "paid") => {
    const ids = Array.from(selection);
    if (ids.length === 0) return;
    startBulkTransition(async () => {
      const res = await bulkSetProjectStage({ ids, stage });
      if (res.ok) {
        toast(
          `${stage === "archived" ? tBulk("archived") : tBulk("markedDone")} · ${String(ids.length)} project${
            ids.length === 1 ? "" : "s"
          }.`,
          "success",
        );
        clear();
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  };

  // ─── State chip select (URL param) ────────────────────────────────
  const selectState = (next: ProjectState | null) => {
    const query = next ? `?state=${next}` : "";
    startTransition(() => {
      router.replace(`/dashboard/projects${query}`, { scroll: false });
    });
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      {/* Page header — title, subtitle counts, "+ New" CTA */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Workspace
          </p>
          <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-[rgb(var(--fg-primary))] sm:text-5xl">
            Clients &amp; Projects
          </h1>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            <span className="sk-num font-mono tabular-nums">
              {projectStats.total.toString()}
            </span>{" "}
            project{projectStats.total === 1 ? "" : "s"} ·{" "}
            <span className="sk-num font-mono tabular-nums">
              {projectStats.active.toString()}
            </span>{" "}
            active ·{" "}
            <span className="sk-num font-mono tabular-nums">
              {clients.length.toString()}
            </span>{" "}
            client{clients.length === 1 ? "" : "s"}
            {totalOutstandingCents > 0 ? (
              <>
                {" "}
                ·{" "}
                <span
                  className="sk-num font-mono font-bold tabular-nums"
                  style={{ color: "rgb(var(--fg-danger))" }}
                >
                  {formatMoneyShort(totalOutstandingCents, currency)}
                </span>{" "}
                outstanding
              </>
            ) : null}
          </p>
        </div>
        <Link
          href={view === "clients" ? "/dashboard/projects/new" : "/dashboard/projects/new"}
          className="sk-pop inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--bg-base))] shadow-sm transition-transform hover:brightness-110"
        >
          <PlusIcon /> New {view === "clients" ? "client" : "project"}
        </Link>
      </header>

      {/* Toolbar: toggle + search + filter chips */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div
            role="tablist"
            aria-label="Switch between projects and clients"
            className="inline-flex rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-0.5 shadow-sm"
          >
            <ToggleButton
              icon={<KanbanIcon />}
              label="Projects"
              active={view === "projects"}
              onClick={() => {
                setView("projects");
                clear();
              }}
            />
            <ToggleButton
              icon={<UsersIcon />}
              label="Clients"
              active={view === "clients"}
              onClick={() => {
                setView("clients");
                clear();
              }}
            />
          </div>

          {/* Search */}
          <div className="min-w-[220px] flex-1 sm:max-w-sm">
            <ListSearchInput
              value={q}
              onChange={setQ}
              inputRef={inputRef}
              placeholder={
                view === "projects"
                  ? "Search projects, clients…"
                  : "Search clients…"
              }
              ariaLabel="Search"
            />
          </div>
        </div>

        {/* Per-view filter chips (Projects state filter) */}
        {view === "projects" ? (
          <nav
            aria-label="Filter by state"
            className="-mx-4 sm:mx-0"
          >
            <div className="sk-scroll-x flex gap-2 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:overflow-visible sm:px-0">
              <StateChip
                label={tState("all")}
                count={projects.length}
                active={activeState === null}
                disabled={isPending}
                onClick={() => {
                  selectState(null);
                }}
              />
              {PROJECT_STATES.map((state) => (
                <StateChip
                  key={state}
                  label={tState(state)}
                  count={
                    projects.filter((p) => stageToState(p.stage) === state).length
                  }
                  active={activeState === state}
                  disabled={isPending}
                  onClick={() => {
                    selectState(state);
                  }}
                />
              ))}
            </div>
          </nav>
        ) : null}
      </div>

      {/* Body */}
      {view === "projects" ? (
        <ProjectsTable
          rows={filteredProjects}
          grouped={groupedProjects}
          activeState={activeState}
          search={q}
          tP={tP}
          tState={tState}
          selection={selection}
          onToggleRow={toggle}
          allVisibleSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAll}
          visibleCount={visibleIds.length}
          totalCount={projects.length}
        />
      ) : (
        <ClientsGrid clients={clients} query={q} currency={currency} />
      )}

      {/* Bulk action bar (projects only) */}
      {view === "projects" ? (
        <BulkActionBar
          count={selection.size}
          onDismiss={clear}
          actions={[
            {
              id: "mark-done",
              label: tBulk("markDone"),
              tone: "primary",
              disabled: isBulkPending,
              onClick: () => {
                runBulkStage("paid");
              },
            },
            {
              id: "archive",
              label: tBulk("archive"),
              tone: "destructive",
              disabled: isBulkPending,
              onClick: () => {
                runBulkStage("archived");
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}

// ─── Projects table (sub-component) ────────────────────────────────

function ProjectsTable({
  rows,
  grouped,
  activeState,
  search,
  tP,
  tState,
  selection,
  onToggleRow,
  allVisibleSelected,
  onToggleSelectAll,
  visibleCount,
  totalCount,
}: {
  rows: ProjectsViewRow[];
  grouped: Record<ProjectState, ProjectsViewRow[]>;
  activeState: ProjectState | null;
  search: string;
  // ReturnType of useTranslations — typed loosely to keep the file
  // self-contained without adding an i18n type import.
  tP: (k: string) => string;
  tState: (k: string) => string;
  selection: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  allVisibleSelected: boolean;
  onToggleSelectAll: () => void;
  visibleCount: number;
  totalCount: number;
}) {
  // Empty-state #1: no projects at all.
  if (totalCount === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]">
          <FolderIcon />
        </div>
        <h3 className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]">
          {tP("empty.title")}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-[rgb(var(--fg-secondary))]">
          {tP("empty.description")}
        </p>
        <Link
          href="/dashboard/projects/new"
          className="mt-6 inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--bg-base))] hover:brightness-110"
        >
          {tP("empty.cta")}
        </Link>
      </div>
    );
  }

  // Empty-state #2: search hides everything.
  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
      >
        {tP("noMatches")} “{search}”.
      </div>
    );
  }

  const statesToRender: readonly ProjectState[] = activeState
    ? [activeState]
    : (["live", "done", "archived"] as const);

  return (
    <div className="reveal-up surface-card flex flex-col overflow-hidden">
      {/* Column header bar */}
      <div className="flex items-center gap-3 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 sm:gap-4">
        <label className="flex shrink-0 cursor-pointer items-center pe-1">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={onToggleSelectAll}
            aria-label={tP("selectAll")}
            className="h-4 w-4 cursor-pointer rounded border-[rgb(var(--border-subtle))] text-[rgb(var(--brand-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
        </label>
        <ColumnHeader className="w-10 shrink-0" label="" />
        <ColumnHeader className="flex-[2.2]" label="Project / Stage" />
        <ColumnHeader className="hidden flex-[1.2] md:block" label="Client" />
        <ColumnHeader
          className="hidden w-28 shrink-0 lg:block"
          label="Progress"
        />
        <ColumnHeader
          className="hidden w-20 shrink-0 text-right md:block"
          label="Balance"
        />
        <ColumnHeader
          className="hidden w-20 shrink-0 text-right md:block"
          label="Deadline"
        />
        <span aria-hidden="true" className="w-6 shrink-0" />
      </div>

      {/* Sectioned rows */}
      {statesToRender.map((state) => {
        const stateRows = grouped[state];
        if (stateRows.length === 0) {
          // When a single state filter is active, show empty section
          // with a fallback link; otherwise quietly skip.
          if (activeState) {
            return (
              <div
                key={state}
                className="border-b border-[rgb(var(--border-subtle))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
              >
                {tP("emptyState")}{" "}
                <Link
                  href="/dashboard/projects"
                  className="text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
                  scroll={false}
                >
                  {tP("showAll")}
                </Link>
              </div>
            );
          }
          return null;
        }
        return (
          <section key={state} aria-labelledby={`state-${state}-heading`}>
            {!activeState ? (
              <div className="flex items-baseline gap-2 bg-[rgb(var(--bg-overlay))] px-4 py-2">
                <h2
                  id={`state-${state}-heading`}
                  className="font-display text-sm font-bold tracking-tight text-[rgb(var(--fg-primary))]"
                >
                  {tState(state)}
                </h2>
                <span className="sk-num font-mono text-[0.62rem] text-[rgb(var(--fg-muted))]">
                  {stateRows.length.toString()}
                </span>
              </div>
            ) : null}
            <ul role="list" className="flex flex-col">
              {stateRows.map((row, i) => (
                <ProjectTableRow
                  key={row.id}
                  row={row}
                  index={i}
                  selected={selection.has(row.id)}
                  onToggle={() => {
                    onToggleRow(row.id);
                  }}
                  stateLabelOverride={tState(state)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* Footer — visible count summary, useful when a search is on */}
      {visibleCount > 0 && visibleCount < totalCount ? (
        <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 text-[0.72rem] text-[rgb(var(--fg-muted))]">
          Showing {visibleCount.toString()} of {totalCount.toString()}{" "}
          project{totalCount === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function ColumnHeader({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={[
        "text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function ToggleButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "sk-pop inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[0.72rem] font-bold transition-colors",
        active
          ? "bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] shadow-sm"
          : "bg-transparent text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

function StateChip({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors sm:min-h-0 sm:h-8",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
        active
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <span
        className={[
          "sk-num font-mono text-[0.66rem]",
          active ? "text-[rgb(var(--brand-primary))]" : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        {count.toString()}
      </span>
    </button>
  );
}

// Compact money formatter (shared with ClientsGrid). $3.4k for thousands.
function formatMoneyShort(cents: number, currency: string): string {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(dollars);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);
}

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function KanbanIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="6" height="14" rx="1" />
      <rect x="11" y="3" width="6" height="9" rx="1" />
      <rect x="19" y="3" width="2" height="6" rx="0.5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M7 5V3h6v2" />
      <path d="M2.5 10h19" />
    </svg>
  );
}
