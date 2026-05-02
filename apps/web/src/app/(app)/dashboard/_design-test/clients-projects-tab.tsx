/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Clients & Projects tab. 1:1 port of the
// mockup's tabs/clients-projects.jsx (sample-app/index.html lines
// 1559-1836). Includes ClientsProjectsTab + ProjectsTable + ClientsGrid
// + ClientCard. Pure DOM/CSS preserved verbatim from the mockup.
//
// Wired-logic tweaks:
// - data.projects[].id click → router.push(`/dashboard/projects/${id}`)
//   instead of the mockup's internal openProject state
// - "New Project / New Client" button → router.push(`/dashboard/projects/new`)
//   for the projects view (existing route); placeholder for clients
//   since there's no /dashboard/clients/new yet
// - Pin state is local-component state — survives interaction inside
//   the tab but resets on route change (matches mockup behavior)

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Avatar,
  Card,
  Icon,
  KebabMenu,
  PinStar,
  ProjectBadge,
  StatusPill,
  fmtMoney,
} from "./primitives";
import type { MockupTagType } from "./data-mapping";

export type ProjectRow = {
  id: string;
  name: string;
  client: string;
  stage: string;
  status: string;
  tag: string;
  tagType: MockupTagType;
  grad: string;
  progress: number;
  paid: number;
  total: number;
  songs: number;
  sessions: number;
  deadline: string;
  deadlineDays: number;
};

export type ClientRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  projects: number;
  balance: number;
  totalLifetime: number;
};

type ClientsProjectsData = {
  projects: ProjectRow[];
  clients: ClientRow[];
};

export function ClientsProjectsTab({ data }: { data: ClientsProjectsData }) {
  const router = useRouter();
  const d = data;
  const [view, setView] = useState<"projects" | "clients">("projects");
  const [filter, setFilter] = useState<
    "all" | "urgent" | "active" | "done" | "pinned"
  >("all");
  const [clientFilter, setClientFilter] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<
    "recent" | "deadline" | "balance" | "progress" | "name"
  >("recent");
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const togglePin = (id: string) =>
    setPinned((p) => ({ ...p, [id]: !p[id] }));

  const projects = useMemo(() => {
    let out = d.projects.slice();
    if (filter === "urgent")
      out = out.filter(
        (p) => p.tagType === "danger" || p.tagType === "warning",
      );
    else if (filter === "active") out = out.filter((p) => p.progress < 100);
    else if (filter === "done") out = out.filter((p) => p.progress === 100);
    else if (filter === "pinned") out = out.filter((p) => pinned[p.id]);
    if (clientFilter) out = out.filter((p) => p.client === clientFilter);
    if (q.trim()) {
      const Q = q.trim().toLowerCase();
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(Q) || p.client.toLowerCase().includes(Q),
      );
    }
    out.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "balance") return b.total - b.paid - (a.total - a.paid);
      if (sort === "progress") return b.progress - a.progress;
      if (sort === "deadline") return a.deadlineDays - b.deadlineDays;
      return 0;
    });
    out.sort((a, b) => (pinned[b.id] ? 1 : 0) - (pinned[a.id] ? 1 : 0));
    return out;
  }, [filter, clientFilter, q, sort, pinned, d.projects]);

  const totalOutstanding = d.projects.reduce(
    (a, p) => a + (p.total - p.paid),
    0,
  );
  const activeCount = d.projects.filter((p) => p.progress < 100).length;

  return (
    <div
      data-screen-label="02 Clients & Projects"
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
            Workspace
          </span>
          <h1
            className="font-syne"
            style={{
              fontFamily: "Syne",
              fontSize: "clamp(34px, 4.5vw, 52px)",
              fontWeight: 800,
              letterSpacing: "-0.035em",
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Clients & Projects
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13.5,
              color: "rgb(var(--fg-muted))",
            }}
          >
            {d.projects.length} projects · {activeCount} active ·{" "}
            {d.clients.length} clients ·{" "}
            <span
              className="tabular"
              style={{
                fontFamily: "JetBrains Mono",
                color:
                  totalOutstanding > 0
                    ? "rgb(var(--fg-danger))"
                    : "rgb(var(--fg-default))",
              }}
            >
              {fmtMoney(totalOutstanding)}
            </span>{" "}
            outstanding
          </p>
        </div>
        <button
          onClick={() =>
            view === "clients"
              ? router.push("/dashboard/projects")
              : router.push("/dashboard/projects/new")
          }
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
          <Icon name="plus" size={14} strokeWidth={2.6} /> New{" "}
          {view === "clients" ? "Client" : "Project"}
        </button>
      </header>

      <div
        className="reveal-up stagger-2"
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
            padding: 3,
            borderRadius: 9,
            background: "rgb(var(--bg-elevated))",
            border: "1px solid rgb(var(--border-subtle))",
          }}
        >
          {(
            [
              ["projects", "Projects", "folder-kanban"],
              ["clients", "Clients", "users"],
            ] as const
          ).map(([k, l, ic]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "7px 14px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                background:
                  view === k
                    ? "rgb(var(--bg-background))"
                    : "transparent",
                color:
                  view === k
                    ? "rgb(var(--fg-default))"
                    : "rgb(var(--fg-muted))",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                boxShadow:
                  view === k ? "0 1px 2px rgba(17,16,9,0.06)" : "none",
              }}
            >
              <Icon name={ic} size={12} />
              {l}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            borderRadius: 9,
            background: "rgb(var(--bg-elevated))",
            border: "1px solid rgb(var(--border-subtle))",
            flex: "1 1 220px",
            minWidth: 220,
            maxWidth: 320,
          }}
        >
          <Icon name="search" size={13} style={{ color: "rgb(var(--fg-muted))" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              view === "projects"
                ? "Search projects, clients…"
                : "Search clients…"
            }
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

        {view === "projects" && (
          <>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(
                [
                  ["all", "All"],
                  ["urgent", "Needs attention"],
                  ["active", "Active"],
                  ["done", "Done"],
                  ["pinned", "Pinned"],
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
                      filter === k
                        ? "rgb(var(--fg-default))"
                        : "transparent",
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
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "7px 28px 7px 12px",
                  borderRadius: 16,
                  fontSize: 11.5,
                  fontWeight: 600,
                  background:
                    clientFilter
                      ? "rgb(var(--fg-default))"
                      : "transparent",
                  color: clientFilter
                    ? "rgb(var(--bg-background))"
                    : "rgb(var(--fg-muted))",
                  border:
                    "1px solid " +
                    (clientFilter
                      ? "rgb(var(--fg-default))"
                      : "rgb(var(--border-subtle))"),
                }}
              >
                <option value="">All clients</option>
                {d.clients.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <label
              style={{
                marginLeft: "auto",
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
                      | "deadline"
                      | "balance"
                      | "progress"
                      | "name",
                  )
                }
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "6px 24px 6px 10px",
                  borderRadius: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: "rgb(var(--bg-elevated))",
                  border: "1px solid rgb(var(--border-subtle))",
                  color: "rgb(var(--fg-default))",
                }}
              >
                <option value="recent">Most recent</option>
                <option value="deadline">Soonest deadline</option>
                <option value="balance">Largest balance</option>
                <option value="progress">Most complete</option>
                <option value="name">Name (A→Z)</option>
              </select>
            </label>
          </>
        )}
      </div>

      {view === "projects" ? (
        <ProjectsTable
          rows={projects}
          onOpen={(id) => router.push(`/dashboard/projects/${id}`)}
          pinned={pinned}
          togglePin={togglePin}
        />
      ) : (
        <ClientsGrid
          clients={d.clients}
          q={q}
          onSelectClient={(name) => {
            setClientFilter(name);
            setView("projects");
          }}
        />
      )}
    </div>
  );
}

function ProjectsTable({
  rows,
  onOpen,
  pinned,
  togglePin,
}: {
  rows: ProjectRow[];
  onOpen: (id: string) => void;
  pinned: Record<string, boolean>;
  togglePin: (id: string) => void;
}) {
  if (rows.length === 0)
    return (
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
          No projects match those filters
        </div>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          Try clearing search or switching to All.
        </div>
      </div>
    );

  return (
    <Card padded={false} className="reveal-up stagger-3">
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "24px 44px minmax(0,2.2fr) minmax(0,1.2fr) 110px 100px 90px 36px 24px",
          alignItems: "center",
          gap: 14,
          padding: "10px 18px",
          borderBottom: "1px solid rgb(var(--border-subtle))",
          background: "rgb(var(--bg-elevated))",
        }}
      >
        <span></span>
        <span></span>
        <span className="label-tiny">Project / Stage</span>
        <span className="label-tiny">Client</span>
        <span className="label-tiny">Progress</span>
        <span className="label-tiny" style={{ textAlign: "right" }}>
          Balance
        </span>
        <span className="label-tiny" style={{ textAlign: "right" }}>
          Deadline
        </span>
        <span></span>
        <span></span>
      </div>

      {rows.map((p, i) => {
        const overdue = p.deadlineDays < 0;
        const close = p.deadlineDays >= 0 && p.deadlineDays <= 7;
        const balance = p.total - p.paid;
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onOpen(p.id);
            }}
            className="sk-row"
            style={{
              display: "grid",
              gridTemplateColumns:
                "24px 44px minmax(0,2.2fr) minmax(0,1.2fr) 110px 100px 90px 36px 24px",
              alignItems: "center",
              gap: 14,
              padding: "12px 18px",
              borderBottom:
                i === rows.length - 1
                  ? "none"
                  : "1px solid rgb(var(--border-subtle) / 0.6)",
              cursor: "pointer",
              background: pinned[p.id]
                ? "rgb(var(--brand-primary) / 0.04)"
                : "transparent",
            }}
          >
            <PinStar on={!!pinned[p.id]} onToggle={() => togglePin(p.id)} />
            <ProjectBadge grad={p.grad} size={40} rounded={8} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 2,
                }}
              >
                <span
                  className="truncate"
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {p.name}
                </span>
                <StatusPill tagType={p.tagType} label={p.tag} />
              </div>
              <div
                className="truncate"
                style={{ fontSize: 11, color: "rgb(var(--fg-muted))" }}
              >
                <span
                  style={{
                    textTransform: "capitalize",
                    color: "rgb(var(--fg-default))",
                    fontWeight: 600,
                  }}
                >
                  {p.stage}
                </span>{" "}
                · {p.songs} {p.songs === 1 ? "song" : "songs"} · {p.sessions}{" "}
                sessions
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                className="truncate"
                style={{ fontSize: 12.5, fontWeight: 600 }}
              >
                {p.client}
              </div>
              <div style={{ fontSize: 10.5, color: "rgb(var(--fg-faint))" }}>
                Last activity {p.deadlineDays < 0 ? "today" : "2d ago"}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 3,
                  background: "rgb(var(--border-subtle))",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${String(p.progress)}%`,
                    height: "100%",
                    background:
                      p.progress === 100
                        ? "rgb(var(--fg-success))"
                        : "rgb(var(--fg-default))",
                    borderRadius: 3,
                  }}
                />
              </div>
              <span
                className="tabular"
                style={{
                  fontSize: 10.5,
                  fontFamily: "JetBrains Mono",
                  fontWeight: 700,
                  minWidth: 28,
                  textAlign: "right",
                }}
              >
                {p.progress}%
              </span>
            </div>

            <span
              className="tabular"
              style={{
                textAlign: "right",
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: "JetBrains Mono",
                color:
                  balance > 0
                    ? "rgb(var(--fg-danger))"
                    : "rgb(var(--fg-muted))",
              }}
            >
              {balance > 0 ? fmtMoney(balance) : "—"}
            </span>

            <span
              style={{
                textAlign: "right",
                fontSize: 11,
                fontFamily: "JetBrains Mono",
                color: overdue
                  ? "rgb(var(--fg-danger))"
                  : close
                    ? "rgb(var(--fg-warning))"
                    : "rgb(var(--fg-muted))",
                fontWeight: overdue || close ? 700 : 500,
              }}
            >
              {overdue
                ? `${String(Math.abs(p.deadlineDays))}d late`
                : close
                  ? `${String(p.deadlineDays)}d`
                  : p.deadline}
            </span>

            <span onClick={(e) => e.stopPropagation()}>
              <KebabMenu
                items={[
                  {
                    label: "Open project",
                    icon: "external-link",
                    onClick: () => onOpen(p.id),
                  },
                  { label: "Share project link", icon: "link" },
                  { label: "Send invoice", icon: "file-text" },
                  { label: "Schedule session", icon: "calendar" },
                  { label: "Duplicate", icon: "copy" },
                  { label: "Archive", icon: "archive" },
                  { label: "Delete", icon: "trash-2", danger: true },
                ]}
              />
            </span>

            <Icon
              name="chevron-right"
              size={15}
              style={{ color: "rgb(var(--fg-faint))" }}
            />
          </div>
        );
      })}
    </Card>
  );
}

function ClientsGrid({
  clients,
  q,
  onSelectClient,
}: {
  clients: ClientRow[];
  q: string;
  onSelectClient: (name: string) => void;
}) {
  const [sort, setSort] = useState<
    "recent" | "lifetime" | "balance" | "projects" | "name"
  >("recent");
  const [filter, setFilter] = useState<"all" | "active" | "balance">("all");
  const list = useMemo(() => {
    let out = clients.slice();
    if (filter === "balance") out = out.filter((c) => c.balance > 0);
    else if (filter === "active") out = out.filter((c) => c.projects > 0);
    if (q.trim()) {
      const Q = q.trim().toLowerCase();
      out = out.filter(
        (c) =>
          c.name.toLowerCase().includes(Q) ||
          c.email.toLowerCase().includes(Q),
      );
    }
    out.sort((a, b) => {
      if (sort === "lifetime") return b.totalLifetime - a.totalLifetime;
      if (sort === "balance") return b.balance - a.balance;
      if (sort === "projects") return b.projects - a.projects;
      if (sort === "name") return a.name.localeCompare(b.name);
      return 0;
    });
    return out;
  }, [clients, q, sort, filter]);

  return (
    <div className="reveal-up stagger-3">
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {(
          [
            ["all", "All"],
            ["active", "Active"],
            ["balance", "With balance"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "6px 12px",
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
        <label
          style={{
            marginLeft: "auto",
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
                  | "lifetime"
                  | "balance"
                  | "projects"
                  | "name",
              )
            }
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "6px 24px 6px 10px",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 600,
              background: "rgb(var(--bg-elevated))",
              border: "1px solid rgb(var(--border-subtle))",
              color: "rgb(var(--fg-default))",
            }}
          >
            <option value="recent">Most recent</option>
            <option value="lifetime">Highest lifetime</option>
            <option value="balance">Largest balance</option>
            <option value="projects">Most projects</option>
            <option value="name">Name (A→Z)</option>
          </select>
        </label>
      </div>

      {list.length === 0 ? (
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
            No clients match those filters
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
            gap: 12,
          }}
        >
          {list.map((c) => (
            <ClientCard key={c.id} c={c} onClick={() => onSelectClient(c.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientCard({ c, onClick }: { c: ClientRow; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="surface-card sk-row"
      style={{
        padding: 16,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Avatar initials={c.initials} grad="grad-slate" size={42} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              className="truncate"
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                flex: 1,
                minWidth: 0,
              }}
            >
              {c.name}
            </div>
            <span onClick={(e) => e.stopPropagation()}>
              <KebabMenu
                items={[
                  { label: "View profile", icon: "user" },
                  { label: "Send message", icon: "message-circle" },
                  { label: "Send invoice", icon: "file-text" },
                  { label: "New project", icon: "plus" },
                  { label: "Archive", icon: "archive", danger: true },
                ]}
              />
            </span>
          </div>
          <div
            className="truncate"
            style={{ fontSize: 11, color: "rgb(var(--fg-muted))" }}
          >
            {c.email}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgb(var(--bg-elevated))",
          border: "1px solid rgb(var(--border-subtle))",
        }}
      >
        <div>
          <div className="label-tiny" style={{ marginBottom: 2 }}>
            Projects
          </div>
          <div
            className="tabular"
            style={{
              fontSize: 14,
              fontWeight: 800,
              fontFamily: "JetBrains Mono",
            }}
          >
            {c.projects}
          </div>
        </div>
        <div>
          <div className="label-tiny" style={{ marginBottom: 2 }}>
            Lifetime
          </div>
          <div
            className="tabular"
            style={{
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "JetBrains Mono",
            }}
          >
            ${(c.totalLifetime / 1000).toFixed(1)}k
          </div>
        </div>
        <div>
          <div className="label-tiny" style={{ marginBottom: 2 }}>
            Owed
          </div>
          <div
            className="tabular"
            style={{
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "JetBrains Mono",
              color:
                c.balance > 0
                  ? "rgb(var(--fg-danger))"
                  : "rgb(var(--fg-muted))",
            }}
          >
            {c.balance > 0 ? fmtMoney(c.balance) : "—"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button
          className="sk-pop"
          style={{
            all: "unset",
            cursor: "pointer",
            flex: 1,
            textAlign: "center",
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 11.5,
            fontWeight: 600,
            background: "rgb(var(--bg-background))",
            border: "1px solid rgb(var(--border-subtle))",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
          }}
        >
          <Icon name="message-circle" size={12} />
          Message
        </button>
        <button
          className="sk-pop"
          style={{
            all: "unset",
            cursor: "pointer",
            flex: 1,
            textAlign: "center",
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 11.5,
            fontWeight: 600,
            background:
              c.balance > 0
                ? "rgb(var(--fg-default))"
                : "rgb(var(--bg-background))",
            color:
              c.balance > 0
                ? "rgb(var(--bg-background))"
                : "rgb(var(--fg-default))",
            border:
              "1px solid " +
              (c.balance > 0
                ? "rgb(var(--fg-default))"
                : "rgb(var(--border-subtle))"),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
          }}
        >
          <Icon name="file-text" size={12} />
          {c.balance > 0 ? "Send invoice" : "New project"}
        </button>
      </div>
    </div>
  );
}
