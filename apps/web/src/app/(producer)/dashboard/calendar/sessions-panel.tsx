"use client";

// Sessions tab orchestrator per spec § 5.
//
//   ┌───────────────────────────────────────────────────────────────┐
//   │ [Upcoming · N]  [Past · N]  [All]              [🔍 search…]   │
//   ├───────────────────────────────────────────────────────────────┤
//   │  ◇ session row                                                │
//   │  ◇ session row                                                │
//   └───────────────────────────────────────────────────────────────┘
//
// Filter buckets:
//   - Upcoming → status ∈ {confirmed, pending_*}, startsAt > now
//   - Past     → endsAt ≤ now OR status ∈ {cancelled, rejected}
//   - All      → everything (sorted descending by date)
//
// Search filters by artist name OR package name (case-insensitive).
// The 3 action modals are owned here so they share the bridge between
// the row click and the modal state without prop-drilling.

import { useMemo, useState } from "react";

import { CancelSessionModal } from "./cancel-session-modal";
import { ChangeTimeModal } from "./change-time-modal";
import { SendReminderModal } from "./send-reminder-modal";
import { SessionRow, type SessionListItem } from "./session-row";

type Filter = "upcoming" | "past" | "all";

export function SessionsPanel({
  sessions,
  initialNow,
}: {
  sessions: readonly SessionListItem[];
  initialNow: string;
}) {
  const now = useMemo(() => new Date(initialNow), [initialNow]);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [search, setSearch] = useState("");

  const [activeModal, setActiveModal] = useState<{
    kind: "change" | "remind" | "cancel";
    session: SessionListItem;
  } | null>(null);

  const buckets = useMemo(() => bucket(sessions, now), [sessions, now]);
  const filtered = useMemo(() => {
    const base = buckets[filter];
    if (search.trim().length === 0) return base;
    const q = search.trim().toLowerCase();
    return base.filter((s) => {
      return (
        s.artistName.toLowerCase().includes(q) ||
        (s.packageName ?? "").toLowerCase().includes(q)
      );
    });
  }, [buckets, filter, search]);

  return (
    // Flex column matching the parent's viewport-locked layout.
    // Toolbar stays pinned; the session list scrolls internally so the
    // page chrome (header + tabs) never moves.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Toolbar
        filter={filter}
        onFilter={setFilter}
        counts={{
          upcoming: buckets.upcoming.length,
          past: buckets.past.length,
        }}
        search={search}
        onSearch={setSearch}
      />

      {filtered.length === 0 ? (
        <EmptyState filter={filter} hasSearch={search.trim().length > 0} />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {filtered.map((s) => (
            <li key={s.id}>
              <SessionRow
                session={s}
                now={now}
                onChangeTime={(sess) => {
                  setActiveModal({ kind: "change", session: sess });
                }}
                onSendReminder={(sess) => {
                  setActiveModal({ kind: "remind", session: sess });
                }}
                onCancel={(sess) => {
                  setActiveModal({ kind: "cancel", session: sess });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {activeModal?.kind === "change" ? (
        <ChangeTimeModal
          open
          onOpenChange={(o) => {
            if (!o) setActiveModal(null);
          }}
          session={activeModal.session}
        />
      ) : null}
      {activeModal?.kind === "remind" ? (
        <SendReminderModal
          open
          onOpenChange={(o) => {
            if (!o) setActiveModal(null);
          }}
          session={activeModal.session}
        />
      ) : null}
      {activeModal?.kind === "cancel" ? (
        <CancelSessionModal
          open
          onOpenChange={(o) => {
            if (!o) setActiveModal(null);
          }}
          session={activeModal.session}
        />
      ) : null}
    </div>
  );
}

function Toolbar({
  filter,
  onFilter,
  counts,
  search,
  onSearch,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: { upcoming: number; past: number };
  search: string;
  onSearch: (s: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-1">
        <FilterChip
          active={filter === "upcoming"}
          onClick={() => {
            onFilter("upcoming");
          }}
          label="Upcoming"
          count={counts.upcoming}
        />
        <FilterChip
          active={filter === "past"}
          onClick={() => {
            onFilter("past");
          }}
          label="Past"
          count={counts.past}
        />
        <FilterChip
          active={filter === "all"}
          onClick={() => {
            onFilter("all");
          }}
          label="All"
        />
      </div>
      <SearchPill value={search} onChange={onSearch} />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "sk-press inline-flex h-7 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-3 text-[12px] tracking-tight transition-colors",
        active
          ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9_/_0.08)]"
          : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
      ].join(" ")}
      style={{ fontWeight: 700 }}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={[
            "font-mono text-[10px]",
            active
              ? "text-[rgb(var(--fg-muted))]"
              : "text-[rgb(var(--fg-faint))]",
          ].join(" ")}
        >
          · {String(count)}
        </span>
      ) : null}
    </button>
  );
}

function SearchPill({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex h-9 min-w-[220px] items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12.5px] focus-within:border-[rgb(var(--brand-primary))]">
      <SearchIcon />
      <input
        type="search"
        placeholder="Search by artist or package…"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="w-full bg-transparent text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:outline-none"
      />
    </div>
  );
}

function EmptyState({
  filter,
  hasSearch,
}: {
  filter: Filter;
  hasSearch: boolean;
}) {
  if (hasSearch) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-10 text-center">
        <p className="text-[12.5px] text-[rgb(var(--fg-muted))]">
          No sessions match that search.
        </p>
      </div>
    );
  }
  const copy =
    filter === "upcoming"
      ? "No sessions on the books yet. New requests show up in the Schedule tab."
      : filter === "past"
        ? "No past sessions. Once you complete one, it'll appear here."
        : "No sessions yet.";
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-10 text-center">
      <p className="text-[12.5px] text-[rgb(var(--fg-muted))]">{copy}</p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-[rgb(var(--fg-muted))]"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function bucket(
  sessions: readonly SessionListItem[],
  now: Date,
): { upcoming: SessionListItem[]; past: SessionListItem[]; all: SessionListItem[] } {
  const upcoming: SessionListItem[] = [];
  const past: SessionListItem[] = [];
  const all = [...sessions].sort(
    (a, b) =>
      new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  );
  const nowMs = now.getTime();
  for (const s of sessions) {
    const start = new Date(s.startsAt);
    const endMs = start.getTime() + s.durationMin * 60_000;
    const isCancelled = s.status === "cancelled" || s.status === "rejected";
    if (isCancelled || endMs <= nowMs) {
      past.push(s);
    } else {
      upcoming.push(s);
    }
  }
  upcoming.sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  past.sort(
    (a, b) =>
      new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  );
  return { upcoming, past, all };
}
