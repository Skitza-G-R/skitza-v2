"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Chips } from "~/components/ui/chips";
import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";
import { formatRelativeTime } from "~/lib/time/relative";

// Phase 4 — Clients list screen.
//
// Mirrors `notes/producer-screens.jsx` ClientsList:
//   • Search bar (client-side substring match on name + email).
//   • Filter chips: All / Active / With balance.
//   • Each client row — gradient avatar + name (+ inactive pill when
//     stale) + "X projects · last active <relative>" subtitle, plus
//     a right-aligned balance (in copper) when owed, or lifetime
//     amount (muted) when settled.
//   • Click row → links to /dashboard/clients-projects/<email-as-id>
//     which the existing ClientsPanel resolves to a detail surface
//     once it's restored. Today the link works as a no-op safe href.
//
// Renders as a read-only browse list — the existing add/edit/remove
// CRUD flows in ClientsPanel are not yet exposed in this new screen
// (the design drop's ProducerClientsScreen has no inline CRUD; that
// behaviour is a follow-up). Documented in the Phase 4 handoff.

export interface ClientsListRow {
  id: string;
  email: string;
  name: string;
  totalProjectCount: number;
  activeProjectCount: number;
  outstandingCents: number;
  lifetimeCents: number;
  /** Default currency the client transacts in (USD if mixed). */
  currency: string;
  isStale: boolean;
  needsAttention: boolean;
  lastActivityIso: string;
}

type FilterKey = "all" | "active" | "balance";

export function ClientsListScreen({ rows }: { rows: ClientsListRow[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "active" && r.isStale) return false;
      if (filter === "balance" && r.outstandingCents <= 0) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [rows, filter, query]);

  // Filter chip counts — render the All-tab count, plus the Active /
  // Balance counts where they help producers triage. We compute
  // these once over the unfiltered set so the chip badges reflect
  // the universe, not just the current visible slice.
  const counts = useMemo(() => {
    const active = rows.filter((r) => !r.isStale).length;
    const balance = rows.filter((r) => r.outstandingCents > 0).length;
    return { all: rows.length, active, balance };
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      {/* SEARCH */}
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search clients"
          aria-label="Search clients"
          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-muted))]"
        />
      </div>

      {/* FILTER CHIPS */}
      <Chips<FilterKey>
        ariaLabel="Filter clients"
        items={[
          { value: "all", label: "All", count: counts.all },
          { value: "active", label: "Active", count: counts.active },
          { value: "balance", label: "With balance", count: counts.balance },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {/* CLIENT ROWS */}
      {filtered.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          {rows.length === 0
            ? "No clients yet — share your link to start booking."
            : "Nothing matches that filter or search."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((row) => (
            <li key={row.id}>
              <ClientRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClientRow({ row }: { row: ClientsListRow }) {
  const lastActivity = new Date(row.lastActivityIso);
  return (
    <Link
      href={`/dashboard/clients-projects/clients/${row.id}`}
      className="sk-press flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-3"
    >
      <ClientAvatar name={row.name} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[13.5px] font-bold leading-tight text-[rgb(var(--fg-default))]">
            {row.name}
          </p>
          {row.isStale ? <span className="pill pill-neutral">inactive</span> : null}
          {row.needsAttention ? (
            <span className="pill pill-warning">needs you</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {row.totalProjectCount}{" "}
          {row.totalProjectCount === 1 ? "project" : "projects"} · last active{" "}
          {formatRelativeTime(lastActivity)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {row.outstandingCents > 0 ? (
          <>
            <p className="font-mono text-[13px] font-extrabold text-[rgb(var(--brand-copper))] tabular-nums">
              {formatMoney(row.outstandingCents, row.currency)}
            </p>
            <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">owed</p>
          </>
        ) : (
          <p className="font-mono text-[11px] text-[rgb(var(--fg-muted))] tabular-nums">
            {formatMoney(row.lifetimeCents, row.currency)}
          </p>
        )}
      </div>
    </Link>
  );
}

// — Helpers —

function ClientAvatar({ name, size }: { name: string; size: number }) {
  const initials = producerInitials(name);
  const gradient = producerGradient(name);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-display font-extrabold text-white"
      style={{
        width: size,
        height: size,
        background: gradient,
        fontSize,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[rgb(var(--fg-muted))]"
    >
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3 3" />
    </svg>
  );
}
