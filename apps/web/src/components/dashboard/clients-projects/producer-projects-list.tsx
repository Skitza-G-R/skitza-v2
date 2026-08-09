"use client";

import Link from "next/link";
import { ChevronDown, FolderKanban, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { useDeferredValue, useMemo, useRef } from "react";
import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import { useRouter } from "next/navigation";

import {
  ProjectActionControls,
  type ProjectActionProject,
} from "~/components/dashboard/projects/project-action-controls";
import type { ProjectRowData } from "~/components/dashboard/projects/project-row";

import { ProjectsTableHeader, type ProjectListSort } from "./projects-table-header";

export type ProjectListView = "current" | "archived";

const PHASE_ORDER: Record<ProjectRowData["workflowStage"], number> = {
  brief: 0,
  production: 1,
  mixing: 2,
  mastering: 3,
  done: 4,
};

export function projectPhaseLabel(stage: ProjectRowData["workflowStage"]): string {
  if (stage === "brief") return "Guide";
  if (stage === "production") return "Production";
  if (stage === "mixing") return "Mixing";
  if (stage === "mastering") return "Mastering";
  return "Done";
}

export function isArchivedProject(project: Pick<ProjectRowData, "lifecycleStatus">): boolean {
  return project.lifecycleStatus === "completed" || project.lifecycleStatus === "canceled";
}

function createdAtMs(project: Pick<ProjectRowData, "createdAtIso">): number | null {
  if (!project.createdAtIso) return null;
  const parsed = Date.parse(project.createdAtIso);
  return Number.isNaN(parsed) ? null : parsed;
}

function titleTieBreak(left: ProjectRowData, right: ProjectRowData): number {
  return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

export function sortProjectRows(
  projects: readonly ProjectRowData[],
  sort: ProjectListSort,
): ProjectRowData[] {
  return projects.slice().sort((left, right) => {
    if (sort === "project") return titleTieBreak(left, right);
    if (sort === "phase") {
      const byPhase = PHASE_ORDER[left.workflowStage] - PHASE_ORDER[right.workflowStage];
      if (byPhase !== 0) return byPhase;
      return titleTieBreak(left, right);
    }

    const leftStarted = createdAtMs(left);
    const rightStarted = createdAtMs(right);
    if (leftStarted === null) return rightStarted === null ? titleTieBreak(left, right) : 1;
    if (rightStarted === null) return -1;
    const byStarted = sort === "newest" ? rightStarted - leftStarted : leftStarted - rightStarted;
    return byStarted === 0 ? titleTieBreak(left, right) : byStarted;
  });
}

function formatStartedDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function projectState(
  lifecycleStatus: ProjectRowData["lifecycleStatus"],
): { label: string; className: string } | null {
  if (lifecycleStatus === "active") return null;
  if (lifecycleStatus === "waiting_for_payment") {
    return {
      label: "Waiting for payment",
      className:
        "border-[rgb(var(--fg-warning)/0.32)] bg-[rgb(var(--fg-warning)/0.09)] text-[rgb(var(--fg-warning))]",
    };
  }
  if (lifecycleStatus === "paused") {
    return {
      label: "Paused",
      className:
        "border-[rgb(var(--fg-warning)/0.32)] bg-[rgb(var(--fg-warning)/0.09)] text-[rgb(var(--fg-warning))]",
    };
  }
  if (lifecycleStatus === "completed") {
    return {
      label: "Completed",
      className:
        "border-[rgb(var(--fg-success)/0.28)] bg-[rgb(var(--fg-success)/0.08)] text-[rgb(var(--fg-success))]",
    };
  }
  return {
    label: "Canceled",
    className:
      "border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.07)] text-[rgb(var(--fg-danger-text))]",
  };
}

function StateLabel({ lifecycleStatus }: { lifecycleStatus: ProjectRowData["lifecycleStatus"] }) {
  const state = projectState(lifecycleStatus);
  if (!state) return null;
  return (
    <span
      data-project-state={lifecycleStatus}
      className={`inline-flex shrink-0 items-center rounded-[6px] border px-2 py-0.5 text-[10px] leading-4 font-bold tracking-[0.06em] uppercase ${state.className}`}
    >
      {state.label}
    </span>
  );
}

function toActionProject(row: ProjectRowData): ProjectActionProject {
  return {
    id: row.id,
    title: row.title,
    clientName: row.client,
    lifecycleStatus: row.lifecycleStatus,
    workflowStage: row.workflowStage,
    deadlineAtIso: row.deadlineAtIso ?? null,
    canDeleteEmptyDraft: row.canPermanentlyDelete,
  };
}

function ProjectActionsDisclosure({
  project,
  lifecycleSuccessFocusRef,
}: {
  project: ProjectRowData;
  lifecycleSuccessFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const actionProject = toActionProject(project);

  return (
    <details
      data-tab-swipe-ignore
      className="group/actions relative inline-flex"
      onClick={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <summary
        role="button"
        aria-label={`Actions for ${project.title}`}
        className="sk-press inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal size={18} strokeWidth={2.2} aria-hidden />
      </summary>
      <div
        role="dialog"
        aria-label={`Actions for ${project.title}`}
        className="absolute top-[calc(100%+4px)] right-0 z-40 w-[min(280px,calc(100vw-2.5rem))] rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-2 shadow-[var(--shadow-lg)]"
      >
        <ProjectActionControls
          project={actionProject}
          className="flex-col items-stretch"
          lifecycleSuccessFocusRef={lifecycleSuccessFocusRef}
          onDeleted={() => {
            lifecycleSuccessFocusRef.current?.focus();
          }}
        />
      </div>
    </details>
  );
}

interface ProducerProjectsListProps {
  projects: ProjectRowData[];
  view: ProjectListView;
  sort: ProjectListSort;
  search: string;
  onViewChange: (next: ProjectListView) => void;
  onSortChange: (next: ProjectListSort) => void;
  onSearchChange: (next: string) => void;
  onNewProject: () => void;
}

export function ProducerProjectsList({
  projects,
  view,
  sort,
  search,
  onViewChange,
  onSortChange,
  onSearchChange,
  onNewProject,
}: ProducerProjectsListProps) {
  const router = useRouter();
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const currentViewButtonRef = useRef<HTMLButtonElement>(null);

  const visibleProjects = useMemo(() => {
    const inView = projects.filter((project) =>
      view === "archived" ? isArchivedProject(project) : !isArchivedProject(project),
    );
    const searched = deferredSearch
      ? inView.filter((project) =>
          `${project.title}\n${project.client}`.toLocaleLowerCase().includes(deferredSearch),
        )
      : inView;
    return sortProjectRows(searched, sort);
  }, [deferredSearch, projects, sort, view]);

  const openProject = (projectId: string) => {
    router.push(`/dashboard/clients-projects/${encodeURIComponent(projectId)}`);
  };

  const handleDesktopRowKey = (event: KeyboardEvent<HTMLTableRowElement>, projectId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openProject(projectId);
  };

  const handleDesktopRowClick = (event: MouseEvent<HTMLTableRowElement>, projectId: string) => {
    if (event.defaultPrevented) return;
    openProject(projectId);
  };

  const hasSearch = search.trim().length > 0;

  return (
    <section aria-label="Projects" className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          role="group"
          aria-label="Project view"
          className="inline-flex w-fit items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-1"
        >
          <button
            ref={currentViewButtonRef}
            type="button"
            aria-pressed={view === "current"}
            onClick={() => {
              onViewChange("current");
            }}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9"
            style={{
              background: view === "current" ? "rgb(var(--fg-default))" : "transparent",
              color: view === "current" ? "rgb(var(--bg-background))" : "rgb(var(--fg-muted))",
            }}
          >
            Current
          </button>
          <button
            type="button"
            aria-pressed={view === "archived"}
            onClick={() => {
              onViewChange("archived");
            }}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9"
            style={{
              background: view === "archived" ? "rgb(var(--fg-default))" : "transparent",
              color: view === "archived" ? "rgb(var(--bg-background))" : "rgb(var(--fg-muted))",
            }}
          >
            Archived
          </button>
        </div>

        <div className="relative min-w-0 flex-1 sm:max-w-[520px]">
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <Search
            size={17}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[rgb(var(--fg-muted))]"
          />
          <input
            id="project-search"
            type="search"
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value.slice(0, 120));
            }}
            maxLength={120}
            placeholder="Search projects or clients"
            className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] py-2.5 pr-11 pl-10 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[14px]"
          />
          {search.length > 0 ? (
            <button
              type="button"
              aria-label="Clear project search"
              onClick={() => {
                onSearchChange("");
              }}
              className="absolute top-1/2 right-0 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              <X size={16} aria-hidden />
            </button>
          ) : null}
        </div>

        <label className="relative inline-flex items-center md:hidden">
          <span className="sr-only">Sort projects</span>
          <select
            aria-label="Sort projects"
            value={sort}
            onChange={(event) => {
              onSortChange(event.target.value as ProjectListSort);
            }}
            className="min-h-11 appearance-none rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] py-2.5 pr-9 pl-3 text-[13px] font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
          >
            <option value="oldest">Oldest</option>
            <option value="newest">Newest</option>
            <option value="phase">Phase</option>
            <option value="project">Project name</option>
          </select>
          <ChevronDown
            size={14}
            aria-hidden
            className="pointer-events-none absolute right-3 text-[rgb(var(--fg-muted))]"
          />
        </label>
      </div>

      <p className="mt-4 mb-2 text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
        {view === "current" ? "Current" : "Archived"} · {visibleProjects.length}
      </p>

      {visibleProjects.length === 0 ? (
        <ProjectListEmptyState
          view={view}
          hasSearch={hasSearch}
          onClearSearch={() => {
            onSearchChange("");
          }}
          onNewProject={onNewProject}
        />
      ) : (
        <>
          <div className="hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)] md:block">
            <table
              className="w-full table-fixed border-collapse"
              aria-label={`${view === "current" ? "Current" : "Archived"} projects`}
            >
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[24%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <ProjectsTableHeader sort={sort} onSortChange={onSortChange} />
              </thead>
              <tbody>
                {visibleProjects.map((project) => (
                  <tr
                    key={project.id}
                    data-project-id={project.id}
                    tabIndex={0}
                    aria-label={`Open project ${project.title}`}
                    onClick={(event) => {
                      handleDesktopRowClick(event, project.id);
                    }}
                    onKeyDown={(event) => {
                      handleDesktopRowKey(event, project.id);
                    }}
                    className="group cursor-pointer border-b border-[rgb(var(--border-subtle))] transition-colors last:border-b-0 hover:bg-[rgb(var(--bg-overlay))] focus-visible:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <td className="min-w-0 px-4 py-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-[14px] font-bold text-[rgb(var(--fg-default))]">
                          {project.title}
                        </span>
                        <StateLabel lifecycleStatus={project.lifecycleStatus} />
                      </div>
                    </td>
                    <td className="min-w-0 px-4 py-3 text-[13px] text-[rgb(var(--fg-secondary))]">
                      <span className="block truncate">{project.client}</span>
                    </td>
                    <td className="px-4 py-3 text-[13px] whitespace-nowrap text-[rgb(var(--fg-muted))] tabular-nums">
                      {formatStartedDate(project.createdAtIso)}
                    </td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                      {projectPhaseLabel(project.workflowStage)}
                    </td>
                    <td className="px-3 py-1 text-right">
                      <ProjectActionsDisclosure
                        project={project}
                        lifecycleSuccessFocusRef={currentViewButtonRef}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul
            aria-label={`${view === "current" ? "Current" : "Archived"} projects`}
            className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)] md:hidden"
          >
            {visibleProjects.map((project) => (
              <li
                key={project.id}
                data-mobile-project-id={project.id}
                className="relative min-w-0 border-b border-[rgb(var(--border-subtle))] last:border-b-0"
              >
                <Link
                  href={`/dashboard/clients-projects/${encodeURIComponent(project.id)}`}
                  aria-label={`Open project ${project.title}`}
                  className="block min-w-0 px-4 py-3.5 pr-16 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-[15px] font-bold text-[rgb(var(--fg-default))]">
                      {project.title}
                    </span>
                    <StateLabel lifecycleStatus={project.lifecycleStatus} />
                  </span>
                  <span className="mt-1 block min-w-0 truncate text-[13px] text-[rgb(var(--fg-secondary))]">
                    {project.client}
                  </span>
                  <span className="mt-2 grid min-w-0 grid-cols-2 gap-3 text-[12px]">
                    <span className="min-w-0">
                      <span className="block text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Phase
                      </span>
                      <span className="mt-0.5 block truncate font-semibold text-[rgb(var(--fg-default))]">
                        {projectPhaseLabel(project.workflowStage)}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Started
                      </span>
                      <span className="mt-0.5 block truncate text-[rgb(var(--fg-secondary))] tabular-nums">
                        {formatStartedDate(project.createdAtIso)}
                      </span>
                    </span>
                  </span>
                </Link>
                <div className="absolute top-2 right-2">
                  <ProjectActionsDisclosure
                    project={project}
                    lifecycleSuccessFocusRef={currentViewButtonRef}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ProjectListEmptyState({
  view,
  hasSearch,
  onClearSearch,
  onNewProject,
}: {
  view: ProjectListView;
  hasSearch: boolean;
  onClearSearch: () => void;
  onNewProject: () => void;
}) {
  const title = hasSearch
    ? "No projects match your search"
    : view === "archived"
      ? "No archived projects"
      : "No current projects";

  return (
    <div
      role="status"
      className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-10 text-center"
    >
      <FolderKanban size={24} aria-hidden className="mx-auto text-[rgb(var(--fg-muted))]" />
      <h2 className="font-syne mt-3 text-[18px] font-bold text-[rgb(var(--fg-default))]">
        {title}
      </h2>
      {hasSearch ? (
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          Clear search
        </button>
      ) : view === "current" ? (
        <button
          type="button"
          onClick={onNewProject}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          <Plus size={14} aria-hidden />
          New project
        </button>
      ) : null}
    </div>
  );
}
