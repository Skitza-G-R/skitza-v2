"use client";

import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import { ChevronDown, LayoutGrid, List } from "lucide-react";

import {
  ProjectRow,
  type ProjectRowData,
} from "~/components/dashboard/projects/project-row";
import {
  ClientCard,
  type ClientCardData,
} from "~/components/dashboard/clients/client-card";
import { StatTile } from "~/components/dashboard/common/stat-tile";

// Sort order options (in display order). `custom` defaults — the user
// last-set order, persisted via the reorder mutations. `recent` is the
// most-recently-updated. `name` is alphabetical. Everything else
// targets a specific column.
const SORT_OPTIONS = [
  { value: "custom", label: "Custom" },
  { value: "recent", label: "Recent" },
  { value: "deadline", label: "Deadline" },
  { value: "balance", label: "Balance" },
  { value: "progress", label: "Progress" },
  { value: "name", label: "Name" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

// Project filter chips — `all` is implicit (no filter applied).
const PROJECT_FILTERS = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
] as const;

type ProjectFilter = (typeof PROJECT_FILTERS)[number]["value"];

// Client filter chips.
const CLIENT_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "balance", label: "Balance" },
] as const;

type ClientFilter = (typeof CLIENT_FILTERS)[number]["value"];

type Tab = "projects" | "clients";
type Layout = "cards" | "table";

export interface WorkspaceKPIs {
  /** Total earnings in cents (lifetime or rolling window — caller's call). */
  earnings: number;
  /** Outstanding balance in cents across all active projects. */
  outstanding: number;
  /** Count of projects currently flagged as "needs attention". */
  needsAttention: number;
  /** Human-formatted next deadline string e.g. "3d" or "May 28". */
  nextDeadline: string;
  /** Currency code — defaults to USD. */
  currency?: string;
}

export interface WorkspaceListViewProps {
  projects: ProjectRowData[];
  clients: ClientCardData[];
  kpis: WorkspaceKPIs;
  /** Optional callback fired when the user drags rows into a new order. */
  onReorderProjects?: (orderedIds: string[]) => void;
  onReorderClients?: (orderedIds: string[]) => void;
  /** Fired when the user clicks a LinkPill's "Invite to app" button. */
  onInviteClient?: (client: ClientCardData) => void;
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export function WorkspaceListView({
  projects,
  clients,
  kpis,
  onReorderProjects,
  onReorderClients,
  onInviteClient,
}: WorkspaceListViewProps) {
  const [tab, setTab] = useState<Tab>("projects");
  const [sort, setSort] = useState<SortValue>("custom");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [clientFilter, setClientFilter] = useState<ClientFilter>("all");
  const [layout, setLayout] = useState<Layout>("cards");

  // Locally-mutable order — drag flushes back to the parent via the
  // reorder callback, but the visual update is optimistic.
  const [orderedProjects, setOrderedProjects] = useState(projects);
  const [orderedClients, setOrderedClients] = useState(clients);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const currency = kpis.currency ?? "USD";

  const filteredProjects = useMemo(() => {
    if (projectFilter === "all") return orderedProjects;
    return orderedProjects.filter((p) => {
      if (projectFilter === "urgent") return p.statusTone === "danger";
      if (projectFilter === "active") {
        return p.statusTone === "warn" || p.statusTone === "ok";
      }
      // done
      return p.statusTone === "neutral";
    });
  }, [orderedProjects, projectFilter]);

  const filteredClients = useMemo(() => {
    if (clientFilter === "all") return orderedClients;
    return orderedClients.filter((c) => {
      if (clientFilter === "active") return c.projects > 0;
      // balance
      return c.owed > 0;
    });
  }, [orderedClients, clientFilter]);

  const handleProjectDragStart = (
    _e: DragEvent<HTMLDivElement>,
    id: string,
  ) => {
    setDraggingId(id);
  };
  const handleProjectDragOver = (
    e: DragEvent<HTMLDivElement>,
    _id: string,
  ) => {
    e.preventDefault();
  };
  const handleProjectDrop = (
    _e: DragEvent<HTMLDivElement>,
    targetId: string,
  ) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const next = [...orderedProjects];
    const fromIdx = next.findIndex((p) => p.id === draggingId);
    const toIdx = next.findIndex((p) => p.id === targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggingId(null);
      return;
    }
    const [moved] = next.splice(fromIdx, 1);
    if (moved) next.splice(toIdx, 0, moved);
    setOrderedProjects(next);
    setDraggingId(null);
    // Drag flips sort back to "custom" — that's how the user signals
    // "this is the order I want, don't auto-sort over it".
    setSort("custom");
    onReorderProjects?.(next.map((p) => p.id));
  };

  const handleClientDragStart = (
    _e: DragEvent<HTMLDivElement>,
    id: string,
  ) => {
    setDraggingId(id);
  };
  const handleClientDragOver = (
    e: DragEvent<HTMLDivElement>,
    _id: string,
  ) => {
    e.preventDefault();
  };
  const handleClientDrop = (
    _e: DragEvent<HTMLDivElement>,
    targetId: string,
  ) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const next = [...orderedClients];
    const fromIdx = next.findIndex((c) => c.id === draggingId);
    const toIdx = next.findIndex((c) => c.id === targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggingId(null);
      return;
    }
    const [moved] = next.splice(fromIdx, 1);
    if (moved) next.splice(toIdx, 0, moved);
    setOrderedClients(next);
    setDraggingId(null);
    setSort("custom");
    onReorderClients?.(next.map((c) => c.id));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* KPI strip — 4 cards across, full bleed */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Earnings"
          value={formatMoney(kpis.earnings, currency)}
        />
        <StatTile
          label="Outstanding"
          value={
            kpis.outstanding > 0
              ? formatMoney(kpis.outstanding, currency)
              : "—"
          }
          variant={kpis.outstanding > 0 ? "danger" : "default"}
        />
        <StatTile
          label="Needs attention"
          value={kpis.needsAttention}
          variant={kpis.needsAttention > 0 ? "danger" : "default"}
        />
        <StatTile label="Next deadline" value={kpis.nextDeadline} />
      </div>

      {/* Tab segmented control */}
      <div
        className="inline-flex items-center gap-1 self-start rounded-full border p-1"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
        role="tablist"
        aria-label="Workspace tab"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "projects"}
          onClick={() => setTab("projects")}
          className="rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            background:
              tab === "projects"
                ? "rgb(var(--brand-primary))"
                : "transparent",
            color:
              tab === "projects"
                ? "rgb(var(--bg-sidebar))"
                : "rgb(var(--fg-muted))",
          }}
        >
          Projects
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "clients"}
          onClick={() => setTab("clients")}
          className="rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            background:
              tab === "clients"
                ? "rgb(var(--brand-primary))"
                : "transparent",
            color:
              tab === "clients"
                ? "rgb(var(--bg-sidebar))"
                : "rgb(var(--fg-muted))",
          }}
        >
          Clients
        </button>
      </div>

      {/* Toolbar — filter chips + layout switcher + sort dropdown */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tab === "projects"
            ? PROJECT_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setProjectFilter(f.value)}
                  className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                  style={{
                    background:
                      projectFilter === f.value
                        ? "rgb(var(--brand-primary)/0.15)"
                        : "rgb(var(--bg-elevated))",
                    borderColor:
                      projectFilter === f.value
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--border-subtle))",
                    color:
                      projectFilter === f.value
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--fg-muted))",
                  }}
                >
                  {f.label}
                </button>
              ))
            : CLIENT_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setClientFilter(f.value)}
                  className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                  style={{
                    background:
                      clientFilter === f.value
                        ? "rgb(var(--brand-primary)/0.15)"
                        : "rgb(var(--bg-elevated))",
                    borderColor:
                      clientFilter === f.value
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--border-subtle))",
                    color:
                      clientFilter === f.value
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--fg-muted))",
                  }}
                >
                  {f.label}
                </button>
              ))}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="inline-flex items-center gap-0.5 rounded-full border p-0.5"
            style={{
              background: "rgb(var(--bg-elevated))",
              borderColor: "rgb(var(--border-subtle))",
            }}
            role="group"
            aria-label="Layout"
          >
            <button
              type="button"
              onClick={() => setLayout("cards")}
              aria-pressed={layout === "cards"}
              aria-label="Card layout"
              className="rounded-full p-1.5"
              style={{
                background:
                  layout === "cards"
                    ? "rgb(var(--brand-primary)/0.15)"
                    : "transparent",
                color:
                  layout === "cards"
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--fg-muted))",
              }}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setLayout("table")}
              aria-pressed={layout === "table"}
              aria-label="Table layout"
              className="rounded-full p-1.5"
              style={{
                background:
                  layout === "table"
                    ? "rgb(var(--brand-primary)/0.15)"
                    : "transparent",
                color:
                  layout === "table"
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--fg-muted))",
              }}
            >
              <List size={14} />
            </button>
          </div>
          <label className="relative inline-flex items-center">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortValue)}
              className="appearance-none rounded-full border bg-transparent py-1.5 pl-3 pr-7 text-[12px] font-medium focus:outline-none"
              style={{
                background: "rgb(var(--bg-elevated))",
                borderColor: "rgb(var(--border-subtle))",
                color: "rgb(var(--fg-default))",
              }}
              aria-label="Sort"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="pointer-events-none absolute right-2"
              style={{ color: "rgb(var(--fg-muted))" }}
              aria-hidden
            />
          </label>
        </div>
      </div>

      {/* The list */}
      {tab === "projects" ? (
        <div className="flex flex-col gap-2">
          {filteredProjects.map((p) => (
            <ProjectRow
              key={p.id}
              row={p}
              onDragStart={handleProjectDragStart}
              onDragOver={handleProjectDragOver}
              onDrop={handleProjectDrop}
            />
          ))}
        </div>
      ) : (
        <div
          className={
            layout === "cards"
              ? "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
              : "flex flex-col gap-2"
          }
        >
          {filteredClients.map((c) =>
            onInviteClient ? (
              <ClientCard
                key={c.id}
                client={c}
                onInvite={onInviteClient}
                onDragStart={handleClientDragStart}
                onDragOver={handleClientDragOver}
                onDrop={handleClientDrop}
              />
            ) : (
              <ClientCard
                key={c.id}
                client={c}
                onDragStart={handleClientDragStart}
                onDragOver={handleClientDragOver}
                onDrop={handleClientDrop}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
