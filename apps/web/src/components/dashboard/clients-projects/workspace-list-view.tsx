"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import {
  ChevronDown,
  FolderKanban,
  LayoutGrid,
  List,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";

import { ProjectRow, type ProjectRowData } from "~/components/dashboard/projects/project-row";
import { ClientCard, type ClientCardData } from "~/components/dashboard/clients/client-card";
import { InviteToAppModal } from "~/components/dashboard/clients/invite-modal";
import { MobileClientRow } from "~/components/dashboard/clients/mobile-client-row";
import { NewClientModal } from "~/components/dashboard/clients/new-client-modal";
import { NewProjectModal } from "~/components/dashboard/clients/new-project-modal";
import { EditClientModal } from "~/components/dashboard/clients/edit-client-modal";
import { ClientArchiveConfirmModal } from "~/components/dashboard/clients/client-archive-confirm-modal";
import { StatTile } from "~/components/dashboard/common/stat-tile";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import { ClientCompactRow } from "~/components/dashboard/clients/client-compact-row";

import { ClientsTableHeader } from "./clients-table-header";
import { ProjectsTableHeader } from "./projects-table-header";
// Sort order options (in display order). `custom` defaults — the user
// last-set order, persisted via the reorder mutations. `recent` is the
// most-recently-updated. `name` is alphabetical. Everything else
// targets a specific column.
import { SORT_OPTIONS, type SortValue } from "./sort-value";

// Project filter chips — `all` is implicit (no filter applied).
const PROJECT_FILTERS = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Needs attention" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
] as const;

type ProjectFilter = (typeof PROJECT_FILTERS)[number]["value"];

// Client archive state is a relationship-level list placement. It is
// intentionally independent from project lifecycle and artist access.
const CLIENT_FILTERS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const;

// Returns the row's ISO timestamp as ms, or 0 if missing/invalid. Used
// to sort newer-first; rows with no timestamp sink to the bottom.
function isoMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

// Same as isoMs but returns +Infinity for missing values so rows
// without a deadline sink to the BOTTOM of an ascending sort.
function isoMsOrPosInf(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

type ClientFilter = (typeof CLIENT_FILTERS)[number]["value"];

type Tab = "projects" | "clients";
type Layout = "cards" | "table";

export interface WorkspaceKPIs {
  /** Total earnings in cents; null while purchase payments are unavailable. */
  earnings: number | null;
  /** Outstanding balance in cents; null while purchase payments are unavailable. */
  outstanding: number | null;
  /** Count of projects currently flagged as "needs attention". */
  needsAttention: number;
  /** Human-formatted next deadline string e.g. "3d" or "May 28". */
  nextDeadline: string;
  /** Optional sub-line on the Next deadline tile — the project name
   *  whose deadline we surfaced (matches the HTML mockup where the
   *  tile reads "Oct 15 / Noa Kirel — Debut Album"). */
  nextDeadlineLabel?: string;
  /** Currency code — defaults to USD. */
  currency?: string;
}

export interface WorkspaceListViewProps {
  projects: ProjectRowData[];
  clients: ClientCardData[];
  kpis: WorkspaceKPIs;
  /** Producer slug — used to build the invite URL inside the modal. */
  producerSlug: string;
  /** When true, opens the NewProjectModal on mount. Set by the page
   *  when `?newProject=1` is present in the URL — the legacy /new
   *  route redirects here with that flag (G7). */
  initialNewProjectOpen?: boolean;
  /** Optional callback fired when the user drags rows into a new order.
   *  Returning a Promise lets the page wire a Server Action — the
   *  component never awaits the result (drag is optimistic). */
  onReorderProjects?: (orderedIds: string[]) => unknown;
  onReorderClients?: (orderedIds: string[]) => unknown;
}

// Shared pill-CTA styling for the header buttons. Extracted so the
// JSX between the `tab === "clients"` branch and the visible label
// stays readable (and source-grep tests can find the label close to
// the conditional).
//
// Sizing + shadow tuned to match the HTML mockup's "+ New client" pill
// (px-5 py-2.5, layered amber elevation, Emil-style press feedback).
// The custom strong ease-out curve (cubic-bezier(0.23, 1, 0.32, 1))
// makes the hover lift feel intentional, not springy. active:scale
// gives the "pressed-down" tactile beat per emil-design-eng.
const HEADER_CTA_CLASS =
  "inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-[var(--radius-lg)] px-4 py-2.5 text-[13px] font-semibold shadow-[0_8px_20px_-6px_rgb(var(--brand-primary)/0.45),0_2px_6px_-2px_rgb(var(--brand-primary)/0.35)] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-[1.02] hover:shadow-[0_12px_26px_-6px_rgb(var(--brand-primary)/0.55),0_3px_8px_-2px_rgb(var(--brand-primary)/0.4)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 sm:min-h-0 sm:self-auto";

const HEADER_CTA_STYLE = {
  background: "rgb(var(--brand-primary))",
  color: "rgb(var(--bg-sidebar))",
} as const;

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

function compareNullableNumbersDesc(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

export function WorkspaceListView({
  projects,
  clients,
  kpis,
  producerSlug,
  initialNewProjectOpen,
  onReorderProjects,
  onReorderClients,
}: WorkspaceListViewProps) {
  // When the page hydrates with `?newProject=1` (the redirect target
  // from the deleted /new route), default to the Projects tab AND
  // open the modal — that's where the legacy route landed the user.
  const [tab, setTab] = useState<Tab>(initialNewProjectOpen ? "projects" : "clients");
  const [sort, setSort] = useState<SortValue>("custom");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [clientFilter, setClientFilter] = useState<ClientFilter>("active");
  const [layout, setLayout] = useState<Layout>("cards");
  const [clientSearch, setClientSearch] = useState("");
  const deferredClientSearch = useDeferredValue(clientSearch.trim().toLowerCase());

  // Locally-mutable order — drag flushes back to the parent via the
  // reorder callback, but the visual update is optimistic.
  const [orderedProjects, setOrderedProjects] = useState(projects);
  const [orderedClients, setOrderedClients] = useState(clients);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Server actions revalidate this route. Mirror new server props into
  // the optimistic lists so edits and archive moves appear immediately
  // after router.refresh() instead of leaving stale initial useState data.
  useEffect(() => {
    setOrderedProjects(projects);
  }, [projects]);
  useEffect(() => {
    setOrderedClients(clients);
  }, [clients]);

  // Invite-to-App modal state. The modal mounts once at the bottom of
  // the view and opens whenever a LinkPill "Invite to app" button is
  // clicked on any ClientCard. inviteTarget = null hides the modal.
  const [inviteTarget, setInviteTarget] = useState<ClientCardData | null>(null);
  const [editTarget, setEditTarget] = useState<ClientCardData | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ClientCardData | null>(null);
  const handleInviteClient = (client: ClientCardData) => {
    setInviteTarget(client);
  };
  const closeInvite = () => {
    setInviteTarget(null);
  };

  // New Client modal state (G6). Opens from the "+ New client" CTA on
  // the Clients tab. Replaces the previous routing-based flow (which
  // sent the producer to the new-project form with a client-first
  // query flag). DESIGN.md §6.1 / BUILD-NOTES §7.1.
  const [newClientOpen, setNewClientOpen] = useState(false);

  // New Project modal state (G7). Opens from the "+ New project" CTA on
  // the Projects tab. Replaces the previous `<Link href="/.../new">`
  // route — Gili spotted that the legacy page was still wired up to
  // the CTA during QA. DESIGN.md §6.2 / BUILD-NOTES §7.2.
  // Initial state from the page's searchParams (?newProject=1) so the
  // legacy /new redirect lands the producer directly in the modal.
  const [newProjectOpen, setNewProjectOpen] = useState(initialNewProjectOpen ?? false);

  const currency = kpis.currency ?? "USD";

  const filteredProjects = useMemo(() => {
    const base =
      projectFilter === "all"
        ? orderedProjects
        : orderedProjects.filter((p) => {
            if (projectFilter === "urgent") return p.statusTone === "danger";
            if (projectFilter === "active") {
              return p.statusTone === "warn" || p.statusTone === "ok";
            }
            // done
            return p.statusTone === "neutral";
          });

    if (sort === "custom") return base;
    // Sort is non-mutating — return a fresh sorted copy so React sees
    // the change and re-renders. The base list above is already a new
    // array from filter() (or the orderedProjects reference when
    // unfiltered, which we copy here).
    const sorted = base.slice();
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "balance":
        // Highest known balance first; unavailable projections retain
        // their upstream order at the bottom.
        sorted.sort((a, b) => compareNullableNumbersDesc(a.balance, b.balance));
        break;
      case "progress":
        // Most progressed first.
        sorted.sort((a, b) => compareNullableNumbersDesc(a.progress, b.progress));
        break;
      case "recent":
        // Most recently updated first. Rows without a timestamp sink
        // to the bottom of the list.
        sorted.sort((a, b) => isoMs(b.updatedAtIso) - isoMs(a.updatedAtIso));
        break;
      case "deadline":
        // Soonest deadline first. Rows without a deadline sink to the
        // bottom (Number.POSITIVE_INFINITY).
        sorted.sort((a, b) => isoMsOrPosInf(a.deadlineAtIso) - isoMsOrPosInf(b.deadlineAtIso));
        break;
    }
    return sorted;
  }, [orderedProjects, projectFilter, sort]);

  const filteredClients = useMemo(() => {
    const base = orderedClients.filter((c) =>
      clientFilter === "archived" ? c.archived : !c.archived,
    );
    const searched = deferredClientSearch
      ? base.filter((c) => {
          const haystack = [c.name, c.email ?? "", c.phone ?? "", ...c.tags]
            .join("\n")
            .toLowerCase();
          return haystack.includes(deferredClientSearch);
        })
      : base;

    if (sort === "custom") return searched;
    const sorted = searched.slice();
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "balance":
        sorted.sort((a, b) => compareNullableNumbersDesc(a.owed, b.owed));
        break;
      case "progress":
        // No per-client progress signal; fall back to "most active
        // projects" as a reasonable proxy so the dropdown stays useful
        // on the Clients tab.
        sorted.sort((a, b) => b.projects - a.projects);
        break;
      case "recent":
        sorted.sort((a, b) => isoMs(b.lastActivityIso) - isoMs(a.lastActivityIso));
        break;
      case "joined":
        // Newest-joined first (descending firstSeenAt). Rows without
        // a joined timestamp sink to the bottom.
        sorted.sort((a, b) => isoMs(b.joinedAtIso) - isoMs(a.joinedAtIso));
        break;
      case "deadline":
        // Clients have no individual deadline. Keep current order
        // (matching the upstream listWithProjects ordering).
        break;
    }
    return sorted;
  }, [orderedClients, clientFilter, deferredClientSearch, sort]);

  const handleProjectDragStart = (_e: DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id);
  };
  const handleProjectDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };
  const handleProjectDrop = (_e: DragEvent<HTMLDivElement>, targetId: string) => {
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
    // Fire-and-forget: the server persists the new order, but we
    // already updated local state optimistically above.
    void onReorderProjects?.(next.map((p) => p.id));
  };

  const handleClientDragStart = (_e: DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id);
  };
  const handleClientDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };
  const handleClientDrop = (_e: DragEvent<HTMLDivElement>, targetId: string) => {
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
    // Fire-and-forget — local state has the new order already.
    void onReorderClients?.(next.map((c) => c.id));
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span
            className="hidden text-[10.5px] font-bold tracking-[0.14em] uppercase sm:block"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            Workspace
          </span>
          <h1
            className="font-syne text-[26px] leading-[0.98] font-extrabold tracking-[-0.035em] sm:text-[38px] lg:text-[42px]"
            style={{ color: "rgb(var(--fg-default))" }}
          >
            Clients &amp; Projects
          </h1>
          {/* Sub-line under the H1: at-a-glance counts that match the
              HTML mockup's "6 projects · 4 active · 5 clients ·
              $2,250 outstanding". Each datum is dot-separated; the
              outstanding figure flips to danger color when non-zero
              so the producer can scan urgency without reading. */}
          <p className="mt-1 text-[12.5px]" style={{ color: "rgb(var(--fg-muted))" }}>
            <span data-testid="workspace-subline-projects">
              {orderedProjects.length} {orderedProjects.length === 1 ? "project" : "projects"}
            </span>
            <span aria-hidden> &middot; </span>
            <span>
              {
                orderedProjects.filter(
                  (p) =>
                    p.statusTone === "warn" || p.statusTone === "ok" || p.statusTone === "danger",
                ).length
              }{" "}
              active
            </span>
            <span aria-hidden> &middot; </span>
            <span>
              {orderedClients.length} {orderedClients.length === 1 ? "client" : "clients"}
            </span>
            {kpis.outstanding === null ? (
              <>
                <span aria-hidden> &middot; </span>
                <span className="font-semibold">Commercial totals unavailable</span>
              </>
            ) : kpis.outstanding > 0 ? (
              <>
                <span aria-hidden> &middot; </span>
                <span
                  style={{ color: "rgb(var(--fg-danger))" }}
                  className="font-semibold tabular-nums"
                >
                  {formatMoney(kpis.outstanding, currency)} outstanding
                </span>
              </>
            ) : null}
          </p>
        </div>
        {tab === "clients" ? (
          <button
            type="button"
            onClick={() => {
              setNewClientOpen(true);
            }}
            className={HEADER_CTA_CLASS}
            style={HEADER_CTA_STYLE}
          >
            <Plus size={14} strokeWidth={2.4} />
            New client
          </button>
        ) : null}
        {tab === "projects" ? (
          <button
            type="button"
            onClick={() => {
              setNewProjectOpen(true);
            }}
            className={HEADER_CTA_CLASS}
            style={HEADER_CTA_STYLE}
          >
            <Plus size={14} strokeWidth={2.4} />
            New project
          </button>
        ) : null}
      </header>

      {/* KPI strip, mobile (<md) — SK-54: the full StatTiles (22px Syne
          value + sub-line + px-5 padding) read as dead space stacked
          2-up on a phone. Compact tiles: label + value only, tight
          padding; the sub-line context lives on desktop. */}
      <div className="grid grid-cols-2 gap-2 md:hidden">
        <MobileKpiTile
          label="Earnings"
          value={kpis.earnings === null ? "Unavailable" : formatMoney(kpis.earnings, currency)}
        />
        <MobileKpiTile
          label="Outstanding"
          value={
            kpis.outstanding === null
              ? "Unavailable"
              : kpis.outstanding > 0
                ? formatMoney(kpis.outstanding, currency)
                : "—"
          }
          tone={kpis.outstanding !== null && kpis.outstanding > 0 ? "danger" : "default"}
        />
        <MobileKpiTile
          label="Needs attention"
          value={String(kpis.needsAttention)}
          tone={kpis.needsAttention > 0 ? "danger" : "default"}
        />
        <MobileKpiTile label="Next deadline" value={kpis.nextDeadline} />
      </div>

      {/* KPI strip — 4 cards across, full bleed. Labels include the
          implied time window ("This month") and each tile carries an
          explanatory sub-line so the producer can scan with full
          context (mockup-match — every tile has "headline + meaning").
          Desktop-only since SK-54 (compact strip above owns <md). */}
      <div className="hidden gap-3 md:grid md:grid-cols-4">
        <StatTile
          dense
          label="Earnings · this month"
          value={kpis.earnings === null ? "Unavailable" : formatMoney(kpis.earnings, currency)}
          sub={kpis.earnings === null ? "Purchase payment projection pending" : "Across purchases"}
        />
        <StatTile
          dense
          label="Outstanding"
          value={
            kpis.outstanding === null
              ? "Unavailable"
              : kpis.outstanding > 0
                ? formatMoney(kpis.outstanding, currency)
                : "—"
          }
          variant={kpis.outstanding !== null && kpis.outstanding > 0 ? "danger" : "default"}
          glow={kpis.outstanding !== null && kpis.outstanding > 0 ? "danger" : "none"}
          sub={
            kpis.outstanding === null
              ? "Purchase payment projection pending"
              : kpis.outstanding > 0
                ? `${String(kpis.needsAttention)} ${kpis.needsAttention === 1 ? "project needs" : "projects need"} a nudge`
                : "All settled"
          }
        />
        <StatTile
          dense
          label="Needs your attention"
          value={kpis.needsAttention}
          variant={kpis.needsAttention > 0 ? "danger" : "default"}
          sub={kpis.needsAttention > 0 ? "Overdue or awaiting reply" : "You're all caught up"}
        />
        <StatTile
          dense
          label="Next deadline"
          value={kpis.nextDeadline}
          glow={kpis.nextDeadlineLabel ? "brand" : "none"}
          sub={kpis.nextDeadlineLabel ?? "Upcoming work"}
        />
      </div>

      {tab === "clients" ? (
        <label className="relative block w-full max-w-[560px]">
          <span className="sr-only">Find client</span>
          <Search
            size={17}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[rgb(var(--fg-muted))]"
          />
          <input
            type="search"
            value={clientSearch}
            onChange={(event) => {
              setClientSearch(event.target.value);
            }}
            placeholder="Find client"
            className="min-h-11 w-full rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] py-2.5 pr-11 pl-10 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:border-[rgb(var(--brand-primary))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.22)] focus:outline-none"
            style={{ borderColor: "rgb(var(--border-subtle))" }}
          />
          {clientSearch.length > 0 ? (
            <button
              type="button"
              aria-label="Clear client search"
              onClick={() => {
                setClientSearch("");
              }}
              className="absolute top-1/2 right-1.5 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
            >
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </label>
      ) : null}

      {/* Toolbar — single row, mockup-match alignment.
          Layout: [tab seg] [filter chips] (flex-1 spacer) [layout] [sort]
          All controls live on ONE row in the HTML mockup, separated
          only by whitespace. Wraps on narrow viewports (flex-wrap).
          G20: tab pill uses white-on-beige (paper-on-beige) — amber
          is reserved for the page CTA, the tab selection is a softer
          signal.
          G21: active filter chip uses solid-ink (fg-default bg + light
          text), stronger "filter on" signal without competing with
          the brand CTA.
          G22: the Needs-attention chip carries a pulsing red dot at
          all times (not only when active) so the producer sees urgency
          at a glance even when other filters are selected. */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Tab segmented control with icons (Users + FolderKanban),
            matching the HTML mockup's iconified pill. The icon
            tightens the at-a-glance scan — even before reading the
            label you know which surface you're switching to.
            SK-54 mobile re-flow (CSS order, DOM untouched): row 1 =
            seg + right cluster, row 2 = filter chips as a horizontal
            scroller. md+ keeps the mockup's single wrapping row. */}
        <div
          className="order-1 inline-flex items-center gap-1 rounded-[var(--radius-lg)] border p-1 md:order-none"
          style={{
            background: "rgb(var(--bg-background))",
            borderColor: "rgb(var(--border-subtle))",
          }}
          role="tablist"
          aria-label="Workspace tab"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "clients"}
            onClick={() => {
              setTab("clients");
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-[12px] font-semibold transition-[transform,background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] sm:min-h-0 sm:py-1.5"
            style={{
              background: tab === "clients" ? "rgb(var(--bg-elevated))" : "transparent",
              color: tab === "clients" ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
              boxShadow: tab === "clients" ? "0 1px 2px rgba(17,16,9,0.08)" : "none",
            }}
          >
            <Users size={12} strokeWidth={2.3} aria-hidden />
            Clients
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "projects"}
            onClick={() => {
              setTab("projects");
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-[12px] font-semibold transition-[transform,background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] sm:min-h-0 sm:py-1.5"
            style={{
              background: tab === "projects" ? "rgb(var(--bg-elevated))" : "transparent",
              color: tab === "projects" ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
              boxShadow: tab === "projects" ? "0 1px 2px rgba(17,16,9,0.08)" : "none",
            }}
          >
            <FolderKanban size={12} strokeWidth={2.3} aria-hidden />
            Projects
          </button>
        </div>

        {/* Filter chips, inline with the tab seg on the same row.
            'Needs attention' carries the pulsing red dot on both
            tabs (mockup-match). On phones the chips become one
            non-wrapping horizontal scroller (Spotify/Maps chip-bar
            pattern) instead of a ragged two-line wrap. */}
        <div className="order-3 flex w-full flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] md:order-none md:w-auto md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden">
          {tab === "projects"
            ? PROJECT_FILTERS.map((f) => {
                const active = projectFilter === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => {
                      setProjectFilter(f.value);
                    }}
                    aria-pressed={active}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] border px-3 py-2.5 text-[12px] font-medium whitespace-nowrap transition-[transform,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[rgb(var(--border-strong))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] focus-visible:outline-none active:scale-[0.97] sm:min-h-0 sm:py-1.5"
                    style={{
                      background: active ? "rgb(var(--fg-default))" : "rgb(var(--bg-elevated))",
                      borderColor: active ? "rgb(var(--fg-default))" : "rgb(var(--border-subtle))",
                      color: active ? "rgb(var(--bg-elevated))" : "rgb(var(--fg-muted))",
                    }}
                  >
                    {f.value === "urgent" ? (
                      <span
                        aria-hidden
                        className="inline-block h-1.5 w-1.5 rounded-full motion-safe:animate-[skitza-pulse-glow_2s_ease-in-out_infinite]"
                        style={{ background: "rgb(var(--fg-danger))" }}
                      />
                    ) : null}
                    {f.label}
                  </button>
                );
              })
            : CLIENT_FILTERS.map((f) => {
                const active = clientFilter === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => {
                      setClientFilter(f.value);
                    }}
                    aria-pressed={active}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] border px-3 py-2.5 text-[12px] font-medium whitespace-nowrap transition-[transform,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[rgb(var(--border-strong))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] focus-visible:outline-none active:scale-[0.97] sm:min-h-0 sm:py-1.5"
                    style={{
                      background: active ? "rgb(var(--fg-default))" : "rgb(var(--bg-elevated))",
                      borderColor: active ? "rgb(var(--fg-default))" : "rgb(var(--border-subtle))",
                      color: active ? "rgb(var(--bg-elevated))" : "rgb(var(--fg-muted))",
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
        </div>

        {/* Right cluster — layout switcher + sort.
            ml-auto pushes them to the right edge on wide rows. On
            phones the layout toggle is hidden (cards and table render
            the same compact rows there — Gili, round 2), so the
            cluster is just the sort pill and shares row 1 with the
            tab seg; the chips scroller owns row 2. */}
        <div className="order-2 ml-auto flex items-center gap-2 md:order-none">
          {/* G18 — Layout switcher available on BOTH tabs. Projects:
              cards = vertical ProjectRow stack, table = same stack
              with a sortable ProjectsTableHeader on top. Clients:
              cards = 3-col ClientCard grid, table = ClientsTableHeader
              + ClientCompactRow stack. */}
          <div
            // hidden <md (SK-58): on phones both layouts render the
            // same compact rows, so the toggle was two buttons doing
            // one thing. Display class branches per element — never
            // stack `hidden` with a base `inline-flex`.
            className="hidden items-center gap-0.5 rounded-[var(--radius-lg)] border p-0.5 md:inline-flex"
            style={{
              background: "rgb(var(--bg-elevated))",
              borderColor: "rgb(var(--border-subtle))",
            }}
            role="group"
            aria-label="Layout"
          >
            <button
              type="button"
              onClick={() => {
                setLayout("cards");
              }}
              aria-pressed={layout === "cards"}
              aria-label="Card layout"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-1.5 transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] focus-visible:outline-none active:scale-[0.92] sm:min-h-0 sm:min-w-0"
              style={{
                background: layout === "cards" ? "rgb(var(--brand-primary)/0.15)" : "transparent",
                color: layout === "cards" ? "rgb(var(--brand-primary))" : "rgb(var(--fg-muted))",
              }}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setLayout("table");
              }}
              aria-pressed={layout === "table"}
              aria-label="Table layout"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-1.5 transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] focus-visible:outline-none active:scale-[0.92] sm:min-h-0 sm:min-w-0"
              style={{
                background: layout === "table" ? "rgb(var(--brand-primary)/0.15)" : "transparent",
                color: layout === "table" ? "rgb(var(--brand-primary))" : "rgb(var(--fg-muted))",
              }}
            >
              <List size={14} />
            </button>
          </div>
          <label className="relative inline-flex items-center">
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortValue);
              }}
              className="min-h-[44px] appearance-none rounded-[var(--radius-lg)] border bg-transparent py-2.5 pr-7 pl-3 text-[12px] font-medium focus:outline-none sm:min-h-0 sm:py-1.5"
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

      {/* List-header eyebrow — mockup-match "CLIENTS · 5" / "PROJECTS · 5"
          tiny uppercase label above the list. Reads as a quiet
          breadcrumb between the toolbar and the rows: tells the
          producer "what list am I scanning" + the count, without
          competing with the KPI tiles for attention. */}
      <p
        className="mt-2 -mb-1 text-[10.5px] font-bold tracking-[0.14em] uppercase"
        style={{ color: "rgb(var(--fg-muted))" }}
        data-testid="workspace-list-header"
      >
        {tab === "projects"
          ? `Projects · ${String(filteredProjects.length)}`
          : `Clients · ${String(filteredClients.length)}`}
      </p>

      {/* The list — G18 wires layout switching for both tabs */}
      {tab === "projects" ? (
        <div className="flex flex-col gap-2">
          {layout === "table" ? <ProjectsTableHeader sort={sort} onSortChange={setSort} /> : null}
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
      ) : filteredClients.length === 0 ? (
        <ClientEmptyState
          kind={
            deferredClientSearch.length > 0
              ? "search"
              : clientFilter === "archived"
                ? "archived"
                : "active"
          }
          onClearSearch={() => {
            setClientSearch("");
          }}
          onAddClient={() => {
            setNewClientOpen(true);
          }}
        />
      ) : layout === "table" ? (
        // Unified table container — mockup-match. Header + rows live
        // inside ONE rounded card with no inter-row margins. Hairlines
        // between rows are rendered by ClientCompactRow's border-b.
        // overflow-hidden clips the row's rounded-corner fill against
        // the container's outer radius so the seam is invisible.
        <div
          className="overflow-hidden rounded-[var(--radius-md)] border"
          style={{
            background: "rgb(var(--bg-elevated))",
            borderColor: "rgb(var(--border-subtle))",
          }}
        >
          <ClientsTableHeader sort={sort} onSortChange={setSort} />
          <div className="flex flex-col" data-testid="clients-table-body">
            {filteredClients.map((c) => (
              <ClientCompactRow
                key={c.id}
                client={c}
                onInvite={handleInviteClient}
                onEdit={setEditTarget}
                onArchive={setArchiveTarget}
                onDragStart={handleClientDragStart}
                onDragOver={handleClientDragOver}
                onDrop={handleClientDrop}
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* SK-54 mobile (<md): one hairline-divided card of compact
              two-line rows — the desktop ClientCard (with its 3-column
              stat box) stretched full-width reads as dead space on a
              phone. Drag-reorder stays desktop-only (SK-47 precedent). */}
          <div
            className="overflow-hidden rounded-[var(--radius-md)] border md:hidden"
            style={{
              background: "rgb(var(--bg-elevated))",
              borderColor: "rgb(var(--border-subtle))",
            }}
          >
            {filteredClients.map((c, i) => (
              <MobileClientRow
                key={c.id}
                client={c}
                onInvite={handleInviteClient}
                onEdit={setEditTarget}
                onArchive={setArchiveTarget}
                divider={i < filteredClients.length - 1}
              />
            ))}
          </div>
          <div className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-3">
            {filteredClients.map((c) => (
              <ClientCard
                key={c.id}
                client={c}
                onInvite={handleInviteClient}
                onEdit={setEditTarget}
                onArchive={setArchiveTarget}
                onDragStart={handleClientDragStart}
                onDragOver={handleClientDragOver}
                onDrop={handleClientDrop}
              />
            ))}
          </div>
        </>
      )}

      {inviteTarget ? (
        <InviteToAppModal
          open={true}
          onClose={closeInvite}
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
          open={true}
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
        />
      ) : null}

      {archiveTarget ? (
        <ClientArchiveConfirmModal
          open={true}
          onClose={() => {
            setArchiveTarget(null);
          }}
          client={{
            id: archiveTarget.id,
            name: archiveTarget.name,
            archived: archiveTarget.archived,
          }}
          blockedReason={archiveTarget.archiveBlockedReason ?? null}
        />
      ) : null}

      <NewClientModal
        open={newClientOpen}
        onClose={() => {
          setNewClientOpen(false);
        }}
        onCreated={() => {
          // Server-driven refresh — createClientAction calls
          // revalidatePath, the modal also calls router.refresh, so
          // the new client appears on the next render without a
          // hard reload.
          setNewClientOpen(false);
        }}
      />

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => {
          setNewProjectOpen(false);
        }}
        clients={clients
          .filter((c) => !c.archived && c.email !== null && c.email !== "")
          .map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email ?? "",
          }))}
        onCreated={() => {
          // Same pattern as the new-client wiring above — the Server
          // Action revalidates + the modal calls router.refresh.
          setNewProjectOpen(false);
        }}
      />
    </div>
  );
}

// SK-54 — compact KPI tile for the phone strip. The shared StatTile
// (Syne 22px value + sub-line + px-5 padding, used by 5 surfaces)
// stays untouched; this is the <md-only sibling with label + value
// and nothing else.
function MobileKpiTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] border px-3 py-2.5"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <span
        className="block text-[9px] font-bold tracking-widest uppercase"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {label}
      </span>
      <span
        className="font-syne mt-1 block truncate text-[17px] leading-none font-extrabold tracking-[-0.02em] tabular-nums"
        style={{
          color: tone === "danger" ? "rgb(var(--fg-danger))" : "rgb(var(--fg-default))",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ClientEmptyState({
  kind,
  onClearSearch,
  onAddClient,
}: {
  kind: "active" | "archived" | "search";
  onClearSearch: () => void;
  onAddClient: () => void;
}) {
  const title =
    kind === "search"
      ? "No clients match your search"
      : kind === "archived"
        ? "No archived clients"
        : "No active clients yet";
  const body =
    kind === "search"
      ? "Try a name, email, phone number, or tag."
      : kind === "archived"
        ? "Clients you archive will appear here and can be restored."
        : "Add your first client to keep their work and history together.";

  return (
    <div
      role="status"
      className="rounded-[var(--radius-lg)] border border-dashed px-5 py-10 text-center"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        background: "rgb(var(--bg-elevated))",
      }}
    >
      <Users
        size={24}
        aria-hidden
        className="mx-auto text-[rgb(var(--fg-muted))]"
      />
      <h2 className="font-syne mt-3 text-[18px] font-bold text-[rgb(var(--fg-default))]">
        {title}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-[rgb(var(--fg-muted))]">{body}</p>
      {kind === "search" ? (
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border px-4 py-2.5 text-[13px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        >
          Clear search
        </button>
      ) : kind === "active" ? (
        <button
          type="button"
          onClick={onAddClient}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2.5 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:outline-none"
          style={{ background: "rgb(var(--brand-primary))" }}
        >
          <Plus size={14} aria-hidden />
          New client
        </button>
      ) : null}
    </div>
  );
}
