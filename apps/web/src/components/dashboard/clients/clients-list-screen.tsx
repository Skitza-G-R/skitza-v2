"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Chips } from "~/components/ui/chips";
import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";
import { formatRelativeTime } from "~/lib/time/relative";

// Producer "Clients" view — grid of client cards.
//
// 2026-05-06 redesign — switched from a single-column rows layout to
// the founder's HTML-mockup card grid: each card has a gradient
// avatar, a 3-stat strip (Projects / Lifetime / Owed), and two action
// buttons (Message + Send-invoice/New-project). Search + filter chips
// keep their prior behaviour.
//
// Cards-over-rows reads better at desktop widths (the prior dense row
// list felt cramped above the fold) and gives each client enough room
// to surface the rolled-up stats without an expand-row interaction.

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

      {/* CARD GRID */}
      {filtered.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          {rows.length === 0
            ? "No clients yet — share your link to start booking."
            : "Nothing matches that filter or search."}
        </p>
      ) : (
        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {filtered.map((row) => (
            <li key={row.id}>
              <ClientCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClientCard({ row }: { row: ClientsListRow }) {
  const owed = row.outstandingCents;
  const lifetime = row.lifetimeCents;
  const lastActivity = new Date(row.lastActivityIso);

  return (
    <article className="sk-press flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 transition-colors hover:border-[rgb(var(--border-strong))]">
      {/* Header — avatar, name, email, status pills */}
      <Link
        href={`/dashboard/clients-projects/clients/${row.id}`}
        className="flex items-start gap-3 rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
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
            {row.email}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
            Last active {formatRelativeTime(lastActivity)}
          </p>
        </div>
      </Link>

      {/* 3-stat strip */}
      <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3">
        <Stat label="Projects" value={row.totalProjectCount.toString()} />
        <Stat
          label="Lifetime"
          value={lifetime > 0 ? formatMoney(lifetime, row.currency) : "—"}
        />
        <Stat
          label="Owed"
          value={owed > 0 ? formatMoney(owed, row.currency) : "—"}
          tone={owed > 0 ? "danger" : "muted"}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Link
          href={`mailto:${row.email}`}
          className="sk-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-[11.5px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--border-strong))]"
        >
          <MailIcon /> Message
        </Link>
        {owed > 0 ? (
          <Link
            href={`/dashboard/clients-projects/clients/${row.id}`}
            className="sk-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[rgb(var(--fg-default))] px-3 py-2 text-[11.5px] font-semibold text-[rgb(var(--bg-base))] transition-transform hover:brightness-110"
          >
            <DocIcon /> Send invoice
          </Link>
        ) : (
          <Link
            href="/dashboard/clients-projects/new"
            className="sk-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-[11.5px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--border-strong))]"
          >
            <PlusIcon /> New project
          </Link>
        )}
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "danger";
}) {
  const color =
    tone === "danger"
      ? "rgb(var(--fg-danger))"
      : tone === "muted"
        ? "rgb(var(--fg-muted))"
        : "rgb(var(--fg-default))";
  return (
    <div className="min-w-0">
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="sk-num mt-1 truncate font-mono text-[13px] font-extrabold tabular-nums"
        style={{ color }}
      >
        {value}
      </p>
    </div>
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

function MailIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
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
