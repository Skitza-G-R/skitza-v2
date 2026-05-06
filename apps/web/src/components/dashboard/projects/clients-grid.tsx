"use client";

// Clients view — grid of client cards. Toggleable from the
// Projects view inside `<ClientsAndProjectsView />`. Backed by
// `clientContacts.listWithProjects({ view: "by-client" })`, which
// returns one row per contact with rolled-up stats (active count,
// total count, outstanding cents, lifetime cents, last activity).
//
// Each card shows:
//   - Avatar (deterministic gradient, initials)
//   - Name + email + 3-dot kebab
//   - 3-stat strip (Projects / Lifetime / Owed)
//   - 2 action buttons (Message / Send invoice OR New project)
//
// Search is owned by the parent (so it can be shared with the
// Projects view); filter + sort are local.

import Link from "next/link";
import { useMemo, useState } from "react";

import { gradientCss, gradientFor } from "~/lib/project-gradient";

export type ClientRow = {
  id: string;
  email: string;
  name: string;
  activeProjectCount: number;
  totalProjectCount: number;
  outstandingCents: number;
  lifetimeCents: number;
  unresolvedComments: number;
  // ISO string — server marshals Dates to strings across the RSC
  // boundary. We don't render the timestamp on the card today, but
  // the parent uses it for the default sort.
  lastActivityIso: string | null;
};

type Filter = "all" | "active" | "balance";
type Sort = "recent" | "lifetime" | "balance" | "projects" | "name";

export function ClientsGrid({
  clients,
  query,
  currency,
}: {
  clients: ClientRow[];
  query: string;
  // Default display currency for the producer. Same code used across
  // the dashboard; see PRD §27.
  currency: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");

  const list = useMemo(() => {
    let out = [...clients];
    if (filter === "active") {
      out = out.filter((c) => c.activeProjectCount > 0);
    } else if (filter === "balance") {
      out = out.filter((c) => c.outstandingCents > 0);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
      );
    }
    out.sort((a, b) => {
      if (sort === "lifetime") return b.lifetimeCents - a.lifetimeCents;
      if (sort === "balance") return b.outstandingCents - a.outstandingCents;
      if (sort === "projects") return b.totalProjectCount - a.totalProjectCount;
      if (sort === "name") return a.name.localeCompare(b.name);
      // recent — falls through; relies on server's lastActivity desc.
      const aMs = a.lastActivityIso ? Date.parse(a.lastActivityIso) : 0;
      const bMs = b.lastActivityIso ? Date.parse(b.lastActivityIso) : 0;
      return bMs - aMs;
    });
    return out;
  }, [clients, query, filter, sort]);

  return (
    <div className="reveal-up flex flex-col gap-3">
      {/* Filter chips + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" active={filter === "all"} onClick={() => { setFilter("all"); }} />
        <FilterChip label="Active" active={filter === "active"} onClick={() => { setFilter("active"); }} />
        <FilterChip label="With balance" active={filter === "balance"} onClick={() => { setFilter("balance"); }} />
        <label className="ms-auto inline-flex items-center gap-2 text-[0.7rem] text-[rgb(var(--fg-muted))]">
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
            }}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1 text-[0.72rem] font-medium text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
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
        <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] py-16 text-center">
          <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
            No clients match those filters
          </p>
          <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
            Try clearing search or switching to All.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => (
            <ClientCard key={c.id} client={c} currency={currency} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "sk-pop inline-flex h-7 items-center rounded-full border px-3 text-[0.72rem] font-semibold transition-colors",
        active
          ? "border-[rgb(var(--fg-primary))] bg-[rgb(var(--fg-primary))] text-[rgb(var(--fg-inverse))]"
          : "border-[rgb(var(--border-subtle))] bg-transparent text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ClientCard({
  client,
  currency,
}: {
  client: ClientRow;
  currency: string;
}) {
  const initials = computeInitials(client.name);
  const grad = gradientFor(client.id);
  const owed = client.outstandingCents;
  const lifetime = client.lifetimeCents;

  return (
    <article className="surface-card sk-lift flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold text-white"
          style={{
            background: gradientCss(grad),
            boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18)",
          }}
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight text-[rgb(var(--fg-primary))]">
            {client.name}
          </p>
          <p className="truncate text-[0.72rem] text-[rgb(var(--fg-muted))]">
            {client.email}
          </p>
        </div>
      </div>

      {/* 3-stat strip */}
      <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3">
        <Stat label="Projects" value={client.totalProjectCount.toString()} />
        <Stat
          label="Lifetime"
          value={lifetime > 0 ? formatMoneyShort(lifetime, currency) : "—"}
        />
        <Stat
          label="Owed"
          value={owed > 0 ? formatMoneyShort(owed, currency) : "—"}
          tone={owed > 0 ? "danger" : "muted"}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Link
          href={`mailto:${client.email}`}
          className="sk-pop inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-[0.72rem] font-semibold text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))]"
        >
          <MailIcon /> Message
        </Link>
        {owed > 0 ? (
          <Link
            href={`/dashboard/projects?clientFilter=${encodeURIComponent(client.email)}`}
            className="sk-pop inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[rgb(var(--fg-primary))] px-3 py-2 text-[0.72rem] font-semibold text-[rgb(var(--fg-inverse))] transition-transform hover:brightness-110"
          >
            <DocIcon /> Send invoice
          </Link>
        ) : (
          <Link
            href="/dashboard/projects/new"
            className="sk-pop inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-[0.72rem] font-semibold text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))]"
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
        : "rgb(var(--fg-primary))";
  return (
    <div className="min-w-0">
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="sk-num mt-1 truncate font-mono text-sm font-bold"
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "??";
}

// Short money formatter — "$3.4k" for thousands, "$420" for smaller.
// Keeps the three stat tiles narrow on mobile-width cards.
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
