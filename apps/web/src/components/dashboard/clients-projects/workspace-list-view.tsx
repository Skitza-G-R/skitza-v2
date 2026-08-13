"use client";

import { FolderKanban, Plus, Search, Users, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { ClientArchiveConfirmModal } from "~/components/dashboard/clients/client-archive-confirm-modal";
import type { ClientCardData } from "~/components/dashboard/clients/client-card";
import { ClientCompactRow } from "~/components/dashboard/clients/client-compact-row";
import { EditClientModal } from "~/components/dashboard/clients/edit-client-modal";
import { InviteToAppModal } from "~/components/dashboard/clients/invite-modal";
import { MobileClientRow } from "~/components/dashboard/clients/mobile-client-row";
import { NewClientModal } from "~/components/dashboard/clients/new-client-modal";
import { NewProjectModal } from "~/components/dashboard/clients/new-project-modal";
import type { ProjectRowData } from "~/components/dashboard/projects/project-row";
import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";

import { ClientsTableHeader } from "./clients-table-header";
import { ProducerProjectsList, type ProjectListView } from "./producer-projects-list";
import type { ProjectListSort } from "./projects-table-header";
import { compareClientsByJoined, type SortValue } from "./sort-value";

const CLIENT_FILTERS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const;

type ClientFilter = (typeof CLIENT_FILTERS)[number]["value"];
type Tab = "projects" | "clients";

const WORKSPACE_TABS = ["projects", "clients"] as const;
const PROJECT_SORTS: readonly ProjectListSort[] = ["oldest", "newest", "phase", "project"];

export interface WorkspaceUrlState {
  tab: Tab;
  projectView: ProjectListView;
  projectSort: ProjectListSort;
  clientFilter: ClientFilter;
  clientSort: SortValue;
  search: string;
}

function isProjectSort(value: string | null): value is ProjectListSort {
  return value !== null && PROJECT_SORTS.includes(value as ProjectListSort);
}

export function parseWorkspaceUrlState(search: string): WorkspaceUrlState {
  const params = new URLSearchParams(search);
  const tab: Tab = params.get("tab") === "clients" ? "clients" : "projects";
  const filter = params.get("filter");
  const rawSort = params.get("sort");

  return {
    tab,
    projectView: filter === "archived" ? "archived" : "current",
    projectSort: isProjectSort(rawSort) ? rawSort : "oldest",
    clientFilter: filter === "archived" ? "archived" : "active",
    clientSort: rawSort === "joined" ? "joined" : "recent",
    search: (params.get("search") ?? "").slice(0, 120),
  };
}

export interface WorkspaceListViewProps {
  projects: ProjectRowData[];
  clients: ClientCardData[];
  producerSlug: string;
  initialNewProjectOpen?: boolean;
}

const HEADER_CTA_CLASS =
  "sk-press inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold shadow-[0_8px_20px_-6px_rgb(var(--brand-primary)/0.45),0_2px_6px_-2px_rgb(var(--brand-primary)/0.35)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:self-auto";

function isoMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function WorkspaceListView({
  projects,
  clients,
  producerSlug,
  initialNewProjectOpen = false,
}: WorkspaceListViewProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialUrlState = parseWorkspaceUrlState(searchParams.toString());
  const [tab, setTab] = useState<Tab>(
    initialNewProjectOpen && !searchParams.has("tab") ? "projects" : initialUrlState.tab,
  );
  const [projectView, setProjectView] = useState<ProjectListView>(initialUrlState.projectView);
  const [projectSort, setProjectSort] = useState<ProjectListSort>(initialUrlState.projectSort);
  const [clientFilter, setClientFilter] = useState<ClientFilter>(initialUrlState.clientFilter);
  const [clientSort, setClientSort] = useState<SortValue>(initialUrlState.clientSort);
  const [search, setSearch] = useState(initialUrlState.search);
  const deferredClientSearch = useDeferredValue(search.trim().toLocaleLowerCase());

  useEffect(() => {
    const next = parseWorkspaceUrlState(searchParams.toString());
    setTab(
      searchParams.get("newProject") === "1" && !searchParams.has("tab") ? "projects" : next.tab,
    );
    setProjectView(next.projectView);
    setProjectSort(next.projectSort);
    setClientFilter(next.clientFilter);
    setClientSort(next.clientSort);
    setSearch(next.search);
  }, [searchParams]);

  function replaceUrlState(
    patch: Partial<Record<"tab" | "filter" | "sort" | "search", string | null>>,
  ) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value.slice(0, 120));
    }
    const query = params.toString();
    window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
  }

  function updateTab(next: Tab) {
    setTab(next);
    replaceUrlState({
      tab: next === "projects" ? null : "clients",
      filter:
        next === "projects"
          ? projectView === "current"
            ? null
            : projectView
          : clientFilter === "active"
            ? null
            : clientFilter,
      sort:
        next === "projects"
          ? projectSort === "oldest"
            ? null
            : projectSort
          : clientSort === "recent"
            ? null
            : clientSort,
    });
  }

  function updateProjectView(next: ProjectListView) {
    setProjectView(next);
    replaceUrlState({ filter: next === "current" ? null : next });
  }

  function updateProjectSort(next: ProjectListSort) {
    setProjectSort(next);
    replaceUrlState({ sort: next === "oldest" ? null : next });
  }

  function updateClientFilter(next: ClientFilter) {
    setClientFilter(next);
    replaceUrlState({ filter: next === "active" ? null : next });
  }

  function updateClientSort(next: SortValue) {
    setClientSort(next);
    replaceUrlState({ sort: next === "recent" ? null : next });
  }

  function updateSearch(next: string) {
    const bounded = next.slice(0, 120);
    setSearch(bounded);
    replaceUrlState({ search: bounded || null });
  }

  const tabSwipeHandlers = useTabSwipe({
    items: WORKSPACE_TABS,
    value: tab,
    onChange: updateTab,
  });

  const visibleClients = useMemo(() => {
    const inView = clients.filter((client) =>
      clientFilter === "archived" ? client.archived : !client.archived,
    );
    const searched = deferredClientSearch
      ? inView.filter((client) =>
          [client.name, client.email ?? "", client.phone ?? "", ...client.tags]
            .join("\n")
            .toLocaleLowerCase()
            .includes(deferredClientSearch),
        )
      : inView;
    return searched
      .slice()
      .sort(
        clientSort === "joined"
          ? compareClientsByJoined
          : (left, right) => isoMs(right.lastActivityIso) - isoMs(left.lastActivityIso),
      );
  }, [clientFilter, clientSort, clients, deferredClientSearch]);

  const activeClientCount = clients.filter((client) => !client.archived).length;
  const archivedClientCount = clients.length - activeClientCount;

  const [inviteTarget, setInviteTarget] = useState<ClientCardData | null>(null);
  const [editTarget, setEditTarget] = useState<ClientCardData | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ClientCardData | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(initialNewProjectOpen);
  const clientActionReturnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="hidden text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase sm:block">
            Workspace
          </p>
          <h1
            data-gate1-meaningful-title
            className="font-syne truncate text-[30px] leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:mt-1 sm:text-[42px]"
          >
            {tab === "projects" ? "Projects" : "Clients"}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => {
            if (tab === "projects") setNewProjectOpen(true);
            else setNewClientOpen(true);
          }}
          className={HEADER_CTA_CLASS}
          style={{
            background: "rgb(var(--brand-primary))",
            color: "rgb(var(--bg-sidebar))",
          }}
        >
          <Plus size={15} strokeWidth={2.4} aria-hidden />
          {tab === "projects" ? "New project" : "New client"}
        </button>
      </header>

      <div
        role="group"
        aria-label="Workspace tab"
        className="inline-flex w-fit items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-1"
      >
        <button
          type="button"
          aria-pressed={tab === "projects"}
          onClick={() => {
            updateTab("projects");
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-2 text-[12px] font-semibold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9"
          style={{
            background: tab === "projects" ? "rgb(var(--bg-elevated))" : "transparent",
            color: tab === "projects" ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
            boxShadow: tab === "projects" ? "0 1px 2px rgba(17,16,9,0.08)" : "none",
          }}
        >
          <FolderKanban size={13} strokeWidth={2.3} aria-hidden />
          Projects
        </button>
        <button
          type="button"
          aria-pressed={tab === "clients"}
          onClick={() => {
            updateTab("clients");
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-2 text-[12px] font-semibold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9"
          style={{
            background: tab === "clients" ? "rgb(var(--bg-elevated))" : "transparent",
            color: tab === "clients" ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
            boxShadow: tab === "clients" ? "0 1px 2px rgba(17,16,9,0.08)" : "none",
          }}
        >
          <Users size={13} strokeWidth={2.3} aria-hidden />
          Clients
        </button>
      </div>

      <div
        className="min-w-0 [touch-action:pan-y_pinch-zoom]"
        data-tab-swipe-surface
        {...tabSwipeHandlers}
      >
        <div data-tab-swipe-panel className="min-w-0">
          {tab === "projects" ? (
            <ProducerProjectsList
              projects={projects}
              view={projectView}
              sort={projectSort}
              search={search}
              onViewChange={updateProjectView}
              onSortChange={updateProjectSort}
              onSearchChange={updateSearch}
              onNewProject={() => {
                setNewProjectOpen(true);
              }}
            />
          ) : (
            <section aria-label="Clients" className="min-w-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div
                  role="group"
                  aria-label="Client view"
                  className="inline-flex w-fit items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-1"
                >
                  {CLIENT_FILTERS.map((filter) => {
                    const selected = clientFilter === filter.value;
                    return (
                      <button
                        key={filter.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          updateClientFilter(filter.value);
                        }}
                        className="inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9"
                        style={{
                          background: selected ? "rgb(var(--fg-default))" : "transparent",
                          color: selected ? "rgb(var(--bg-background))" : "rgb(var(--fg-muted))",
                        }}
                      >
                        {filter.label}
                        <span className="ml-1.5 font-mono text-[10px]">
                          {filter.value === "active" ? activeClientCount : archivedClientCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative min-w-0 flex-1 sm:max-w-[520px]">
                  <label htmlFor="client-search" className="sr-only">
                    Find client
                  </label>
                  <Search
                    size={17}
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[rgb(var(--fg-muted))]"
                  />
                  <input
                    id="client-search"
                    type="search"
                    value={search}
                    onChange={(event) => {
                      updateSearch(event.target.value);
                    }}
                    maxLength={120}
                    placeholder="Find client"
                    className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] py-2.5 pr-11 pl-10 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[14px]"
                  />
                  {search.length > 0 ? (
                    <button
                      type="button"
                      aria-label="Clear client search"
                      onClick={() => {
                        updateSearch("");
                      }}
                      className="absolute top-1/2 right-0 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>

              <p className="mt-4 mb-2 text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                Clients · {visibleClients.length}
              </p>

              {visibleClients.length === 0 ? (
                <ClientEmptyState
                  archived={clientFilter === "archived"}
                  hasSearch={deferredClientSearch.length > 0}
                  onClearSearch={() => {
                    updateSearch("");
                  }}
                  onAddClient={() => {
                    setNewClientOpen(true);
                  }}
                  onViewActive={() => {
                    updateClientFilter("active");
                  }}
                />
              ) : (
                <>
                  <div
                    role="list"
                    aria-label="Clients"
                    className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:hidden"
                  >
                    {visibleClients.map((client, index) => (
                      <MobileClientRow
                        key={client.id}
                        client={client}
                        onInvite={setInviteTarget}
                        onEdit={setEditTarget}
                        onArchive={setArchiveTarget}
                        onActionStart={(trigger) => {
                          clientActionReturnFocusRef.current = trigger;
                        }}
                        divider={index < visibleClients.length - 1}
                      />
                    ))}
                  </div>
                  <div className="hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:block">
                    <ClientsTableHeader sort={clientSort} onSortChange={updateClientSort} />
                    <div role="list" aria-label="Clients" className="flex flex-col">
                      {visibleClients.map((client) => (
                        <ClientCompactRow
                          key={client.id}
                          client={client}
                          onInvite={setInviteTarget}
                          onEdit={setEditTarget}
                          onArchive={setArchiveTarget}
                          onActionStart={(trigger) => {
                            clientActionReturnFocusRef.current = trigger;
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>

      {inviteTarget ? (
        <InviteToAppModal
          open
          onClose={() => {
            setInviteTarget(null);
          }}
          client={{
            id: inviteTarget.id,
            name: inviteTarget.name,
            email: inviteTarget.email,
            gradient: producerGradient(inviteTarget.name),
          }}
          producerSlug={producerSlug}
        />
      ) : null}

      {editTarget ? (
        <EditClientModal
          open
          onClose={() => {
            setEditTarget(null);
          }}
          client={{
            id: editTarget.id,
            name: editTarget.name,
            email: editTarget.email ?? "",
            phone: editTarget.phone,
            notes: editTarget.notes,
            tags: editTarget.tags,
          }}
          returnFocusRef={clientActionReturnFocusRef}
        />
      ) : null}

      {archiveTarget ? (
        <ClientArchiveConfirmModal
          open
          onClose={() => {
            setArchiveTarget(null);
          }}
          client={{
            id: archiveTarget.id,
            name: archiveTarget.name,
            archived: archiveTarget.archived,
          }}
          blockedReason={archiveTarget.archiveBlockedReason ?? null}
          returnFocusRef={clientActionReturnFocusRef}
        />
      ) : null}

      <NewClientModal
        open={newClientOpen}
        onClose={() => {
          setNewClientOpen(false);
        }}
        onCreated={() => {
          setNewClientOpen(false);
        }}
      />

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => {
          setNewProjectOpen(false);
        }}
        clients={clients
          .filter((client) => !client.archived && client.email !== null && client.email !== "")
          .map((client) => ({
            id: client.id,
            name: client.name,
            email: client.email ?? "",
          }))}
        onCreated={() => {
          setNewProjectOpen(false);
        }}
      />
    </div>
  );
}

function ClientEmptyState({
  archived,
  hasSearch,
  onClearSearch,
  onAddClient,
  onViewActive,
}: {
  archived: boolean;
  hasSearch: boolean;
  onClearSearch: () => void;
  onAddClient: () => void;
  onViewActive: () => void;
}) {
  const title = hasSearch
    ? "No clients match your search"
    : archived
      ? "No archived clients"
      : "No active clients yet";

  return (
    <div
      role="status"
      className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-10 text-center"
    >
      <Users size={24} aria-hidden className="mx-auto text-[rgb(var(--fg-muted))]" />
      <h2 className="font-syne mt-3 text-[18px] font-bold text-[rgb(var(--fg-default))]">
        {title}
      </h2>
      {hasSearch ? (
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
        >
          Clear search
        </button>
      ) : archived ? (
        <button
          type="button"
          onClick={onViewActive}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
        >
          View active clients
        </button>
      ) : (
        <button
          type="button"
          onClick={onAddClient}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))]"
        >
          <Plus size={14} aria-hidden />
          New client
        </button>
      )}
    </div>
  );
}
