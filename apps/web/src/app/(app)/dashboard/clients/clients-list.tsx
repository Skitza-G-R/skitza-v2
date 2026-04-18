"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";

import {
  createClientAction,
  removeClientAction,
  sendClientMagicLinkAction,
  updateClientAction,
} from "./actions";

// Phase H.2 — CRM hub. Switches between two views:
//
//   "By Client"     — one row per client with rollup stats
//                     (active/total projects, outstanding $, lifetime $)
//   "All Projects"  — one row per project (flat list across clients)
//
// Search, status filter, sort, and stage filter live in URL query
// params so refreshing the page or sharing the URL preserves state.
// Toggling the view preserves any shared filter (e.g. `status=active`
// carries over into both views).
//
// Mobile-first layout:
//   - Segmented-control toggle at the top (44px min-height)
//   - Filter chips scroll horizontally to avoid wrapping
//   - Desktop tables collapse into stacked cards <md
//   - "+ Add client" is a floating FAB on mobile

// ─── Types ─────────────────────────────────────────────────────────

export type ClientRow = {
  id: string;
  email: string;
  name: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  tags: string[] | null;
  notes: string | null;
  referralSource: string | null;
  activeProjectCount: number;
  totalProjectCount: number;
  outstandingCents: number;
  lifetimeCents: number;
  unresolvedComments: number;
  lastActivity: Date | string;
  needsAttention: boolean;
  isStale: boolean;
};

type Stage =
  | "lead"
  | "booked"
  | "contract_sent"
  | "in_production"
  | "final_review"
  | "paid"
  | "archived";

export type ProjectRow = {
  id: string;
  title: string;
  stage: Stage;
  createdAt: Date | string;
  updatedAt: Date | string;
  clientName: string | null;
  clientEmail: string;
  artistName: string;
  artistEmail: string;
  depositPaid: boolean;
  finalPaid: boolean;
  priceCents: number;
  currency: string;
  outstandingCents: number;
  lifetimeCents: number;
  nextSessionAt: Date | string | null;
  lastActivity: Date | string;
  unresolvedComments: number;
  isActive: boolean;
  client: {
    id: string | null;
    email: string;
    name: string;
    tags: string[] | null;
  };
};

type View = "by-client" | "all-projects";
type StatusId = "all" | "active" | "outstanding" | "archived" | "stale";
type SortId = "activity" | "name" | "active" | "outstanding";

const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  booked: "Booked",
  contract_sent: "Contract sent",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
};

const STAGES: Stage[] = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
];

// ─── Helpers ───────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function formatRelative(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  if (abs < min) return "just now";
  if (abs < hr) return relFmt.format(Math.round(diff / min), "minute");
  if (abs < day) return relFmt.format(Math.round(diff / hr), "hour");
  if (abs < 30 * day) return relFmt.format(Math.round(diff / day), "day");
  return dateFmt.format(d);
}

function formatCents(cents: number, currency = "USD"): string {
  if (cents === 0) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(0)}`;
  }
}

function daysSince(v: Date | string | null | undefined): number {
  const d = toDate(v);
  if (!d) return Infinity;
  return (Date.now() - d.getTime()) / 86_400_000;
}

// ─── Top-level hub ─────────────────────────────────────────────────

export function ClientsHub({
  initialClients,
  initialProjects,
}: {
  initialClients: ClientRow[];
  initialProjects: ProjectRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Read initial state from the URL. This makes refreshes sticky
  // without needing a server round-trip for filter state.
  const urlView: View = searchParams.get("view") === "projects" ? "all-projects" : "by-client";
  const urlStatus = (searchParams.get("status") as StatusId | null) ?? "all";
  const urlSort = (searchParams.get("sort") as SortId | null) ?? "activity";
  const urlStage = searchParams.get("stage");
  const urlQuery = searchParams.get("q") ?? "";

  const [view, setView] = useState<View>(urlView);
  const [query, setQuery] = useState<string>(urlQuery);
  const [status, setStatus] = useState<StatusId>(urlStatus);
  const [sort, setSort] = useState<SortId>(urlSort);
  const [stageFilter, setStageFilter] = useState<Stage | null>(
    STAGES.includes(urlStage as Stage) ? (urlStage as Stage) : null,
  );

  const [clients, setClients] = useState<ClientRow[]>(initialClients);
  const [projects] = useState<ProjectRow[]>(initialProjects);

  // Sync URL with current filter state (replaceState so history doesn't
  // flood with every keystroke).
  useEffect(() => {
    const params = new URLSearchParams();
    if (view === "all-projects") params.set("view", "projects");
    if (status !== "all") params.set("status", status);
    if (sort !== "activity") params.set("sort", sort);
    if (stageFilter) params.set("stage", stageFilter);
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    router.replace(href, { scroll: false });
  }, [view, status, sort, stageFilter, query, pathname, router]);

  // Global `c` shortcut still opens the add sheet from anywhere.
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ClientRow | null>(null);
  const [magicLink, setMagicLink] = useState<{
    clientId: string;
    clientName: string;
    url: string;
    target: "portfolio" | "booking";
  } | null>(null);

  useEffect(() => {
    function open() {
      setAddOpen(true);
    }
    window.addEventListener("skitza:new-client", open);
    return () => {
      window.removeEventListener("skitza:new-client", open);
    };
  }, []);

  // ─── Filter + sort ───────────────────────────────────────────

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = clients.filter((r) => {
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.email.toLowerCase().includes(q) &&
        !(r.tags ?? []).some((t) => t.toLowerCase().includes(q))
      ) {
        return false;
      }
      switch (status) {
        case "active":
          return r.activeProjectCount > 0;
        case "outstanding":
          return r.outstandingCents > 0;
        case "archived":
          return r.totalProjectCount > 0 && r.activeProjectCount === 0;
        case "stale":
          return r.isStale || daysSince(r.lastActivity) > 90;
        default:
          return true;
      }
    });
    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "active":
          return b.activeProjectCount - a.activeProjectCount;
        case "outstanding":
          return b.outstandingCents - a.outstandingCents;
        default: {
          const ad = toDate(a.lastActivity)?.getTime() ?? 0;
          const bd = toDate(b.lastActivity)?.getTime() ?? 0;
          return bd - ad;
        }
      }
    });
    return rows;
  }, [clients, query, status, sort]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = projects.filter((p) => {
      if (
        q &&
        !p.title.toLowerCase().includes(q) &&
        !p.client.name.toLowerCase().includes(q) &&
        !p.client.email.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (stageFilter && p.stage !== stageFilter) return false;
      switch (status) {
        case "active":
          return p.isActive;
        case "outstanding":
          return p.outstandingCents > 0;
        case "archived":
          return p.stage === "archived";
        case "stale":
          return daysSince(p.lastActivity) > 90;
        default:
          return true;
      }
    });
    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case "name":
          return a.title.localeCompare(b.title);
        case "outstanding":
          return b.outstandingCents - a.outstandingCents;
        default: {
          const ad = toDate(a.lastActivity)?.getTime() ?? 0;
          const bd = toDate(b.lastActivity)?.getTime() ?? 0;
          return bd - ad;
        }
      }
    });
    return rows;
  }, [projects, query, status, sort, stageFilter]);

  // ─── Headline metrics ─────────────────────────────────────────

  const totals = useMemo(() => {
    const outstanding = clients.reduce((a, c) => a + c.outstandingCents, 0);
    const lifetime = clients.reduce((a, c) => a + c.lifetimeCents, 0);
    const needsAttention = clients.filter((c) => c.needsAttention).length;
    return { outstanding, lifetime, needsAttention };
  }, [clients]);

  // ─── Handlers ─────────────────────────────────────────────────

  const handleCreated = useCallback((row: ClientRow, existed: boolean) => {
    if (!existed) {
      setClients((prev) => {
        const dedup = prev.filter((p) => p.id !== row.id);
        return [row, ...dedup];
      });
    }
    setAddOpen(false);
  }, []);

  const handleUpdated = useCallback((row: { id: string; name: string; email: string }) => {
    setClients((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, name: row.name, email: row.email } : r)),
    );
    setEditTarget(null);
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setClients((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleMagicLink = useCallback(
    (row: ClientRow, payload: { url: string; target: "portfolio" | "booking" }) => {
      setMagicLink({
        clientId: row.id,
        clientName: row.name,
        url: payload.url,
        target: payload.target,
      });
      const clip = navigator.clipboard as Clipboard | undefined;
      if (clip) {
        void clip.writeText(payload.url).then(
          () => {
            toast(`Link for ${row.name} copied.`, "success");
          },
          () => {
            /* silent */
          },
        );
      }
    },
    [toast],
  );

  // ─── Render ───────────────────────────────────────────────────

  const isEmpty = clients.length === 0 && projects.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="reveal-up flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Clients
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Your people.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Everyone who&apos;s booked you or signed a contract — plus every project
            they&apos;re in. Send a magic link, open their projects, see recent activity.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setAddOpen(true);
          }}
          className="hidden sm:inline-flex"
        >
          + Add client
        </Button>
      </header>

      {magicLink ? (
        <MagicLinkBanner
          data={magicLink}
          onDismiss={() => {
            setMagicLink(null);
          }}
        />
      ) : null}

      {/* Headline metrics — only shown when there's data worth rolling up */}
      {clients.length > 0 && (
        <section className="mt-7 grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Needs attention"
            value={totals.needsAttention.toString()}
            accent={totals.needsAttention > 0 ? "warn" : "muted"}
            hint={totals.needsAttention > 0 ? "Open comments or unpaid active projects" : "All clear"}
          />
          <MetricCard
            label="Outstanding"
            value={formatCents(totals.outstanding)}
            accent={totals.outstanding > 0 ? "brand" : "muted"}
            hint="Across active projects"
          />
          <MetricCard
            label="Lifetime"
            value={formatCents(totals.lifetime)}
            accent="muted"
            hint="Total paid, all clients"
          />
        </section>
      )}

      {/* View toggle — segmented, 44px tall, works on mobile */}
      <div
        role="tablist"
        aria-label="View"
        className="mt-7 inline-flex w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 sm:w-auto"
      >
        <ViewTab current={view} id="by-client" label="By Client" onSelect={setView} />
        <ViewTab current={view} id="all-projects" label="All Projects" onSelect={setView} />
      </div>

      <section className="mt-5 flex flex-col gap-3">
        <div className="flex w-full items-center gap-2 sm:max-w-sm">
          <Input
            type="search"
            inputMode="search"
            placeholder={
              view === "by-client"
                ? "Search name, email, tag…"
                : "Search project, client, email…"
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            aria-label="Search"
          />
        </div>
        <FilterChipsRow
          status={status}
          setStatus={setStatus}
          sort={sort}
          setSort={setSort}
          stage={stageFilter}
          setStage={setStageFilter}
          showStage={view === "all-projects"}
        />
      </section>

      <section className="mt-6 pb-28 sm:pb-8">
        {isEmpty ? (
          <EmptyState
            icon={<PeopleIcon />}
            title="No clients yet."
            description="Clients are auto-added when someone books or signs — or add one now to get started."
            action={
              <Button
                type="button"
                onClick={() => {
                  setAddOpen(true);
                }}
              >
                + Add client
              </Button>
            }
            className="min-h-[50vh] justify-center"
          />
        ) : view === "by-client" ? (
          <ByClientView
            rows={filteredClients}
            totalClients={clients.length}
            onEdit={setEditTarget}
            onDeleted={handleDeleted}
            onMagicLink={handleMagicLink}
          />
        ) : (
          <AllProjectsView rows={filteredProjects} totalProjects={projects.length} />
        )}
      </section>

      {/* Mobile FAB */}
      <button
        type="button"
        aria-label="Add client"
        onClick={() => {
          setAddOpen(true);
        }}
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] shadow-[var(--shadow-lg)] transition-transform active:translate-y-[1px] sm:hidden"
      >
        <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {addOpen ? (
        <ClientSheet
          title="Add client"
          submitLabel="Add client"
          onClose={() => {
            setAddOpen(false);
          }}
          onSubmit={async (values) => {
            const res = await createClientAction(values);
            if (!res.ok) return { ok: false, error: res.error };
            const now = new Date();
            const newRow: ClientRow = {
              id: res.data.id,
              email: res.data.email,
              name: res.data.name,
              firstSeenAt: now,
              lastSeenAt: now,
              tags: null,
              notes: null,
              referralSource: null,
              activeProjectCount: 0,
              totalProjectCount: 0,
              outstandingCents: 0,
              lifetimeCents: 0,
              unresolvedComments: 0,
              lastActivity: now,
              needsAttention: false,
              isStale: false,
            };
            if (res.data.existed) {
              toast(`${res.data.name} is already in your list. Opening their page.`, "info");
              handleCreated(newRow, true);
              router.push(`/dashboard/clients/${res.data.id}`);
            } else {
              toast(`Added ${res.data.name}.`, "success");
              handleCreated(newRow, false);
            }
            return { ok: true };
          }}
        />
      ) : null}

      {editTarget ? (
        <ClientSheet
          title="Edit client"
          submitLabel="Save changes"
          initial={{ name: editTarget.name, email: editTarget.email }}
          onClose={() => {
            setEditTarget(null);
          }}
          onSubmit={async (values) => {
            const res = await updateClientAction({
              id: editTarget.id,
              name: values.name,
              email: values.email,
            });
            if (!res.ok) return { ok: false, error: res.error };
            toast(`Updated ${res.data.name}.`, "success");
            handleUpdated(res.data);
            return { ok: true };
          }}
        />
      ) : null}
    </div>
  );
}

// ─── View toggle tab ───────────────────────────────────────────────

function ViewTab({
  current,
  id,
  label,
  onSelect,
}: {
  current: View;
  id: View;
  label: string;
  onSelect: (v: View) => void;
}) {
  const active = current === id;
  return (
    <button
      role="tab"
      aria-selected={active}
      type="button"
      onClick={() => {
        onSelect(id);
      }}
      className={`flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-medium transition-colors sm:flex-initial ${
        active
          ? "bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] shadow-sm"
          : "text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Metric card ───────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: "brand" | "warn" | "muted";
}) {
  const valueClass =
    accent === "brand"
      ? "text-[rgb(var(--brand-primary))]"
      : accent === "warn"
        ? "text-[rgb(var(--fg-danger))]"
        : "text-[rgb(var(--fg-primary))]";
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3">
      <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p className={`sk-num mt-1 font-display text-2xl leading-none ${valueClass}`}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── Filter chips row (status, sort, stage) ────────────────────────

function FilterChipsRow({
  status,
  setStatus,
  sort,
  setSort,
  stage,
  setStage,
  showStage,
}: {
  status: StatusId;
  setStatus: (s: StatusId) => void;
  sort: SortId;
  setSort: (s: SortId) => void;
  stage: Stage | null;
  setStage: (s: Stage | null) => void;
  showStage: boolean;
}) {
  return (
    <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      <ChipGroup
        label="Status"
        items={[
          { id: "all", label: "All" },
          { id: "active", label: "Active" },
          { id: "outstanding", label: "Outstanding $" },
          { id: "archived", label: "Archived" },
          { id: "stale", label: "3+ mo stale" },
        ]}
        value={status}
        onChange={(v) => {
          setStatus(v as StatusId);
        }}
      />
      {showStage ? (
        <ChipGroup
          label="Stage"
          items={[
            { id: "", label: "Any" },
            ...STAGES.map((s) => ({ id: s, label: STAGE_LABEL[s] })),
          ]}
          value={stage ?? ""}
          onChange={(v) => {
            setStage(v === "" ? null : (v as Stage));
          }}
        />
      ) : null}
      <ChipGroup
        label="Sort"
        items={[
          { id: "activity", label: "Recent" },
          { id: "name", label: "Name" },
          { id: "active", label: "Active #" },
          { id: "outstanding", label: "Outstanding" },
        ]}
        value={sort}
        onChange={(v) => {
          setSort(v as SortId);
        }}
      />
    </div>
  );
}

function ChipGroup({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="shrink-0 font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {items.map((item) => {
          const active = value === item.id;
          return (
            <button
              key={item.id || "any"}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onChange(item.id);
              }}
              className={`h-9 shrink-0 rounded-full px-3 font-mono text-[0.68rem] uppercase tracking-wider transition-colors ${
                active
                  ? "bg-[rgb(var(--fg-primary))] text-[rgb(var(--bg-base))]"
                  : "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── By-client view ────────────────────────────────────────────────

function ByClientView({
  rows,
  totalClients,
  onEdit,
  onDeleted,
  onMagicLink,
}: {
  rows: ClientRow[];
  totalClients: number;
  onEdit: (row: ClientRow) => void;
  onDeleted: (id: string) => void;
  onMagicLink: (
    row: ClientRow,
    payload: { url: string; target: "portfolio" | "booking" },
  ) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={totalClients === 0 ? "No clients yet." : "No matches."}
        description={
          totalClients === 0
            ? "Clients will appear here as soon as anyone books or signs."
            : "Try clearing the filter or search."
        }
      />
    );
  }
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] md:block">
        <table className="w-full text-[13px] leading-[1.3]">
          <thead className="bg-[rgb(var(--bg-elevated))] text-left font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            <tr>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium sk-num">Active</th>
              <th className="px-3 py-2 font-medium sk-num">Outstanding</th>
              <th className="px-3 py-2 font-medium sk-num">Lifetime</th>
              <th className="px-3 py-2 font-medium">Last activity</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DesktopClientRow
                key={row.id}
                row={row}
                onEdit={() => {
                  onEdit(row);
                }}
                onDelete={() => {
                  onDeleted(row.id);
                }}
                onMagicLink={(payload) => {
                  onMagicLink(row, payload);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <MobileClientCard
            key={row.id}
            row={row}
            onEdit={() => {
              onEdit(row);
            }}
            onDelete={() => {
              onDeleted(row.id);
            }}
            onMagicLink={(payload) => {
              onMagicLink(row, payload);
            }}
          />
        ))}
      </ul>
    </>
  );
}

function DesktopClientRow({
  row,
  onEdit,
  onDelete,
  onMagicLink,
}: {
  row: ClientRow;
  onEdit: () => void;
  onDelete: () => void;
  onMagicLink: (payload: { url: string; target: "portfolio" | "booking" }) => void;
}) {
  const router = useRouter();
  return (
    <tr
      className="h-12 cursor-pointer border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] transition-colors duration-[140ms] ease-out hover:bg-[rgb(var(--bg-overlay))]"
      onClick={() => {
        router.push(`/dashboard/clients/${row.id}`);
      }}
    >
      <td className="px-3 py-0">
        <div className="flex items-center gap-2">
          {row.needsAttention ? (
            <span
              aria-label="Needs attention"
              title="Needs attention"
              className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--fg-danger))]"
            />
          ) : null}
          <div className="min-w-0">
            <span className="font-medium text-[rgb(var(--fg-primary))]">{row.name}</span>
            <span className="ml-2 font-mono text-xs text-[rgb(var(--fg-muted))]">
              {row.email}
            </span>
          </div>
          {row.tags && row.tags.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1">
              {row.tags.slice(0, 2).map((t) => (
                <TagPill key={t} label={t} />
              ))}
              {row.tags.length > 2 ? (
                <span className="font-mono text-[0.6rem] text-[rgb(var(--fg-muted))]">
                  +{row.tags.length - 2}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-0 sk-num">
        {row.activeProjectCount > 0 ? (
          <span className="text-[rgb(var(--brand-primary))]">{row.activeProjectCount}</span>
        ) : (
          <span className="text-[rgb(var(--fg-muted))]">0</span>
        )}
      </td>
      <td className="px-3 py-0 sk-num">
        {row.outstandingCents > 0 ? (
          <span className="text-[rgb(var(--fg-primary))]">
            {formatCents(row.outstandingCents)}
          </span>
        ) : (
          <span className="text-[rgb(var(--fg-muted))]">—</span>
        )}
      </td>
      <td className="px-3 py-0 sk-num text-[rgb(var(--fg-secondary))]">
        {formatCents(row.lifetimeCents)}
      </td>
      <td className="px-3 py-0 text-[rgb(var(--fg-secondary))]">
        {formatRelative(row.lastActivity)}
      </td>
      <td className="px-3 py-0 text-right">
        <RowActions
          row={row}
          variant="desktop"
          onEdit={onEdit}
          onDelete={onDelete}
          onMagicLink={onMagicLink}
        />
      </td>
    </tr>
  );
}

function MobileClientCard({
  row,
  onEdit,
  onDelete,
  onMagicLink,
}: {
  row: ClientRow;
  onEdit: () => void;
  onDelete: () => void;
  onMagicLink: (payload: { url: string; target: "portfolio" | "booking" }) => void;
}) {
  return (
    <li className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      <Link href={`/dashboard/clients/${row.id}`} className="block p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {row.needsAttention ? (
                <span
                  aria-label="Needs attention"
                  className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--fg-danger))]"
                />
              ) : null}
              <p className="truncate font-display text-lg leading-tight text-[rgb(var(--fg-primary))]">
                {row.name}
              </p>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-[rgb(var(--fg-secondary))]">
              {row.email}
            </p>
            {row.tags && row.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {row.tags.slice(0, 3).map((t) => (
                  <TagPill key={t} label={t} />
                ))}
                {row.tags.length > 3 ? (
                  <span className="font-mono text-[0.6rem] text-[rgb(var(--fg-muted))]">
                    +{row.tags.length - 3}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {row.activeProjectCount > 0 ? (
            <span className="shrink-0 rounded-full bg-[rgb(var(--brand-primary)/0.14)] px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
              {row.activeProjectCount} active
            </span>
          ) : null}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          <Stat
            label="Outstanding"
            value={
              row.outstandingCents > 0 ? formatCents(row.outstandingCents) : "—"
            }
          />
          <Stat label="Lifetime" value={formatCents(row.lifetimeCents)} />
          <Stat label="Last" value={formatRelative(row.lastActivity)} />
        </dl>
      </Link>
      <div className="flex items-stretch gap-2 border-t border-[rgb(var(--border-subtle))] p-3">
        <RowActions
          row={row}
          variant="mobile"
          onEdit={onEdit}
          onDelete={onDelete}
          onMagicLink={onMagicLink}
        />
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-base))] px-2 py-2">
      <dt className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </dt>
      <dd className="sk-num mt-1 font-display text-sm leading-tight">{value}</dd>
    </div>
  );
}

function TagPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-[rgb(var(--bg-overlay))] px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
      {label}
    </span>
  );
}

// ─── All-projects view ─────────────────────────────────────────────

function AllProjectsView({
  rows,
  totalProjects,
}: {
  rows: ProjectRow[];
  totalProjects: number;
}) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <EmptyState
        title={totalProjects === 0 ? "No projects yet." : "No matches."}
        description={
          totalProjects === 0
            ? "Create a project for a client to see it here."
            : "Try clearing the filter or search."
        }
      />
    );
  }
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] md:block">
        <table className="w-full text-[13px] leading-[1.3]">
          <thead className="bg-[rgb(var(--bg-elevated))] text-left font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            <tr>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium sk-num">Value</th>
              <th className="px-3 py-2 font-medium">Last activity</th>
              <th className="px-3 py-2 text-right font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                className="h-12 cursor-pointer border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] transition-colors duration-[140ms] ease-out hover:bg-[rgb(var(--bg-overlay))]"
                onClick={() => {
                  router.push(`/dashboard/projects/${p.id}`);
                }}
              >
                <td className="px-3 py-0">
                  <span className="font-medium text-[rgb(var(--fg-primary))]">{p.title}</span>
                  {p.unresolvedComments > 0 ? (
                    <span className="ml-2 rounded-full bg-[rgb(var(--fg-danger)/0.12)] px-1.5 py-0.5 font-mono text-[0.6rem] uppercase text-[rgb(var(--fg-danger))]">
                      {p.unresolvedComments} open
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-0">
                  {p.client.id ? (
                    <Link
                      href={`/dashboard/clients/${p.client.id}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                      }}
                      className="text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))] hover:underline"
                    >
                      {p.client.name}
                    </Link>
                  ) : (
                    <span className="text-[rgb(var(--fg-secondary))]">{p.client.name}</span>
                  )}
                </td>
                <td className="px-3 py-0">
                  <StageBadge stage={p.stage} />
                </td>
                <td className="px-3 py-0 sk-num">
                  {p.priceCents > 0
                    ? formatCents(p.priceCents, p.currency)
                    : <span className="text-[rgb(var(--fg-muted))]">—</span>}
                  {p.outstandingCents > 0 ? (
                    <span className="ml-2 font-mono text-[0.65rem] uppercase tracking-wider text-[rgb(var(--fg-danger))]">
                      unpaid
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-0 text-[rgb(var(--fg-secondary))]">
                  {formatRelative(p.lastActivity)}
                </td>
                <td className="px-3 py-0 text-right font-mono text-xs text-[rgb(var(--fg-muted))]">
                  →
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="grid gap-3 md:hidden">
        {rows.map((p) => (
          <li
            key={p.id}
            className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
          >
            <Link href={`/dashboard/projects/${p.id}`} className="block p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg leading-tight text-[rgb(var(--fg-primary))]">
                    {p.title}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-[rgb(var(--fg-secondary))]">
                    {p.client.name}
                  </p>
                </div>
                <StageBadge stage={p.stage} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                <Stat
                  label="Value"
                  value={p.priceCents > 0 ? formatCents(p.priceCents, p.currency) : "—"}
                />
                <Stat
                  label="Open"
                  value={p.unresolvedComments > 0 ? String(p.unresolvedComments) : "—"}
                />
                <Stat label="Last" value={formatRelative(p.lastActivity)} />
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  // Map stage → accent colour. "active" stages use the brand accent,
  // terminal ones (paid/archived) desaturate.
  const accent =
    stage === "paid"
      ? "bg-[rgb(var(--brand-primary)/0.18)] text-[rgb(var(--brand-primary))]"
      : stage === "archived"
        ? "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]"
        : "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-secondary))]";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider ${accent}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

// ─── Row actions ───────────────────────────────────────────────────

function RowActions({
  row,
  variant,
  onEdit,
  onDelete,
  onMagicLink,
}: {
  row: ClientRow;
  variant: "desktop" | "mobile";
  onEdit: () => void;
  onDelete: () => void;
  onMagicLink: (payload: { url: string; target: "portfolio" | "booking" }) => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const issue = useCallback(
    (target: "portfolio" | "booking") => {
      startTransition(async () => {
        const res = await sendClientMagicLinkAction({ id: row.id, target });
        if (res.ok) {
          onMagicLink({ url: res.data.url, target: res.data.target });
        } else {
          toast(res.error, "error");
        }
      });
    },
    [row.id, onMagicLink, toast],
  );

  const remove = useCallback(() => {
    const confirmed = window.confirm(
      `Delete ${row.name}? Their projects and contracts stay — only this contact entry is removed.`,
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await removeClientAction({ id: row.id });
      if (res.ok) {
        toast(`${row.name} removed.`, "info");
        onDelete();
      } else {
        toast(res.error, "error");
      }
    });
  }, [row.id, row.name, onDelete, toast]);

  const stop = useCallback((fn: () => void) => {
    return (ev: React.MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      fn();
    };
  }, []);

  if (variant === "desktop") {
    return (
      <div className="inline-flex items-center gap-1">
        <IconButton
          label="Send magic link"
          disabled={pending}
          onClick={stop(() => {
            issue("booking");
          })}
        >
          <LinkIcon />
        </IconButton>
        <IconButton label="Edit" disabled={pending} onClick={stop(onEdit)}>
          <PencilIcon />
        </IconButton>
        <IconButton label="Delete" disabled={pending} onClick={stop(remove)} danger>
          <TrashIcon />
        </IconButton>
      </div>
    );
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        className="h-11 flex-1"
        disabled={pending}
        onClick={stop(() => {
          issue("booking");
        })}
      >
        <LinkIcon /> Link
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-11 flex-1"
        disabled={pending}
        onClick={stop(onEdit)}
      >
        <PencilIcon /> Edit
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="h-11 flex-1"
        disabled={pending}
        onClick={stop(remove)}
      >
        <TrashIcon /> Delete
      </Button>
    </>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger = false,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-transparent transition-colors ${
        danger
          ? "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--fg-danger)/0.08)] hover:text-[rgb(var(--fg-danger))]"
          : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
      } disabled:pointer-events-none disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

// ─── Add/Edit sheet ────────────────────────────────────────────────

function ClientSheet({
  title,
  submitLabel,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial?: { name: string; email: string };
  onSubmit: (values: {
    name: string;
    email: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function submit(ev: SyntheticEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      setError("Name and email are both required.");
      return;
    }
    startTransition(async () => {
      const res = await onSubmit({ name: trimmedName, email: trimmedEmail });
      if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-sheet-title"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]">
        <div className="flex items-center justify-between">
          <h2 id="client-sheet-title" className="font-display text-xl text-[rgb(var(--fg-primary))]">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={200}
              autoComplete="name"
              required
            />
          </div>
          <div>
            <Label htmlFor="client-email">Email</Label>
            <Input
              id="client-email"
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={pending} className="flex-1 sm:flex-initial">
              {pending ? "Saving…" : submitLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Magic-link banner ─────────────────────────────────────────────

function MagicLinkBanner({
  data,
  onDismiss,
}: {
  data: {
    clientId: string;
    clientName: string;
    url: string;
    target: "portfolio" | "booking";
  };
  onDismiss: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      toast("Link copied.", "success");
    } catch {
      toast("Copy failed — select the URL and copy manually.", "error");
    }
  }, [data.url, toast]);

  return (
    <div className="mt-6 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.07)] p-4 reveal-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
            One-shot link for {data.clientName}
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">
            Copy this URL and send to {data.clientName} via your favourite channel. It routes
            them to your {data.target === "booking" ? "booking page" : "portfolio"}. We don&apos;t
            store the raw token — once you dismiss this, it&apos;s gone.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          readOnly
          value={data.url}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          className="flex-1 truncate rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-xs text-[rgb(var(--fg-primary))]"
        />
        <Button
          type="button"
          size="lg"
          onClick={() => {
            void copy();
          }}
          className="h-11 shrink-0"
        >
          {copied ? "✓ Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────

function PeopleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="3.5" />
      <path d="M3 19c.8-3 3.5-5 6-5s5.2 2 6 5" />
      <circle cx="17" cy="7" r="2.5" />
      <path d="M15.5 14c2.2 0 4.2 1.5 5 4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
