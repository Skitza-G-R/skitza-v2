"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { KIND_COLORS, inferSessionKind } from "./session-kind";
import type { RawBookingStatus, SessionListItem } from "./session-row";

type Filter = "upcoming" | "past" | "all";
type DisplayStatus =
  | "confirmed"
  | "pending"
  | "awaiting_payment"
  | "completed"
  | "rejected"
  | "cancelled";

export function ScheduleSessionsCard({
  sessions,
  initialNow,
  selectedBookingId = null,
  onEditSession,
}: {
  sessions: readonly SessionListItem[];
  initialNow: string;
  selectedBookingId?: string | null;
  onEditSession: (session: SessionListItem) => void;
}) {
  const now = useMemo(() => new Date(initialNow), [initialNow]);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const selectedRef = useRef<HTMLLIElement>(null);
  const buckets = useMemo(() => bucketSessions(sessions, now), [sessions, now]);
  const filtered = buckets[filter];

  useEffect(() => {
    if (!selectedBookingId) return;
    const selectedIsPast = buckets.past.some((session) => session.id === selectedBookingId);
    setFilter(selectedIsPast ? "past" : "upcoming");
  }, [buckets, selectedBookingId]);

  useEffect(() => {
    if (!selectedBookingId) return;
    selectedRef.current?.scrollIntoView({ block: "nearest" });
    selectedRef.current?.focus({ preventScroll: true });
  }, [filter, selectedBookingId]);

  return (
    <section
      aria-labelledby="schedule-sessions-heading"
      className="flex max-h-[360px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="shrink-0 border-b border-[rgb(var(--border-subtle))] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="schedule-sessions-heading"
            className="font-display text-[13px] tracking-tight text-[rgb(var(--fg-default))]"
            style={{ fontWeight: 700 }}
          >
            Upcoming sessions
          </h2>
          <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
            {String(buckets.upcoming.length)}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] p-1">
          {(["upcoming", "past", "all"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id);
              }}
              className={[
                "sk-press inline-flex h-7 items-center justify-center rounded-[var(--radius-sm)] px-1 text-[10px] capitalize transition-colors",
                filter === id
                  ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9_/_0.08)]"
                  : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
              ].join(" ")}
              style={{ fontWeight: 700 }}
            >
              {id}
            </button>
          ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="px-3 py-5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
          {filter === "upcoming"
            ? "No upcoming sessions."
            : filter === "past"
              ? "No past sessions."
              : "No sessions yet."}
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {filtered.map((session) => {
            const selected = session.id === selectedBookingId;
            return (
              <li
                key={session.id}
                ref={selected ? selectedRef : undefined}
                tabIndex={selected ? -1 : undefined}
                data-selected={selected ? "true" : "false"}
                className={
                  selected
                    ? "rounded-[var(--radius-md)] ring-2 ring-[rgb(var(--brand-primary)/0.35)] outline-none"
                    : "outline-none"
                }
              >
                <CompactSessionRow
                  session={session}
                  now={now}
                  onEdit={() => {
                    onEditSession(session);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CompactSessionRow({
  session,
  now,
  onEdit,
}: {
  session: SessionListItem;
  now: Date;
  onEdit: () => void;
}) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const status = deriveDisplayStatus(session.status, end, now);
  const dimmed = status === "cancelled" || status === "rejected";
  const serviceLabel = session.packageName ?? "Session";
  const kindToken = KIND_COLORS[inferSessionKind(session.packageName)];

  return (
    <div
      className="grid min-h-[68px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-2 transition-colors hover:border-[rgb(var(--border-strong))]"
      style={{ opacity: dimmed ? 0.62 : 1 }}
    >
      <CompactDate date={start} kindToken={kindToken} />
      <div className="min-w-0 self-stretch py-0.5">
        <p
          className="truncate text-[11.5px] leading-tight text-[rgb(var(--fg-default))]"
          style={{ fontWeight: 750 }}
        >
          {serviceLabel}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span
            className="truncate text-[9.5px] text-[rgb(var(--fg-secondary))]"
            style={{ fontWeight: 650 }}
          >
            {session.artistName}
          </span>
          <span className="shrink-0 font-mono text-[8.5px] text-[rgb(var(--fg-muted))]">
            {formatTime(start)}–{formatTime(end)}
          </span>
        </div>
        <div className="mt-1.5">
          <CompactStatus status={status} />
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${serviceLabel} with ${session.artistName}`}
        className="sk-press inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 text-[10px] text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        style={{ fontWeight: 700 }}
      >
        <PencilIcon />
        <span>Edit</span>
      </button>
    </div>
  );
}

function CompactDate({ date, kindToken }: { date: Date; kindToken: string }) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return (
    <div className="relative flex h-full flex-col items-center justify-center pl-1.5">
      <span
        aria-hidden
        className="absolute inset-y-1 left-0 w-[3px] rounded-full"
        style={{ background: `rgb(var(${kindToken}))` }}
      />
      <span className="font-mono text-[8px] tracking-[0.08em] text-[rgb(var(--brand-primary-dark))]">
        {weekday}
      </span>
      <span
        className="font-display text-[20px] leading-none text-[rgb(var(--fg-default))]"
        style={{ fontWeight: 800 }}
      >
        {String(date.getDate())}
      </span>
    </div>
  );
}

function CompactStatus({ status }: { status: DisplayStatus }) {
  if (status === "rejected") {
    return (
      <span className="inline-flex rounded-[var(--radius-sm)] border border-[rgb(var(--fg-danger)/0.4)] px-1.5 py-0.5 text-[7.5px] tracking-[0.06em] text-[rgb(var(--fg-danger))] uppercase">
        Rejected
      </span>
    );
  }
  const map: Record<Exclude<DisplayStatus, "rejected">, { label: string; className: string }> = {
    confirmed: { label: "Confirmed", className: "pill-success" },
    pending: { label: "Pending", className: "pill-warning" },
    awaiting_payment: {
      label: "Awaiting payment",
      className: "pill-warning",
    },
    completed: { label: "Completed", className: "pill-neutral" },
    cancelled: { label: "Cancelled", className: "pill-danger" },
  };
  const item = map[status];
  return (
    <span className={`pill ${item.className} !px-1.5 !py-0.5 !text-[7.5px]`}>{item.label}</span>
  );
}

function deriveDisplayStatus(raw: RawBookingStatus, endsAt: Date, now: Date): DisplayStatus {
  if (raw === "rejected") return "rejected";
  if (raw === "cancelled") return "cancelled";
  if (raw === "pending_approval") return "pending";
  if (raw === "pending_payment") return "awaiting_payment";
  return endsAt.getTime() <= now.getTime() ? "completed" : "confirmed";
}

function bucketSessions(
  sessions: readonly SessionListItem[],
  now: Date,
): Record<Filter, SessionListItem[]> {
  const upcoming: SessionListItem[] = [];
  const past: SessionListItem[] = [];
  const nowMs = now.getTime();
  for (const session of sessions) {
    const endMs = new Date(session.startsAt).getTime() + session.durationMin * 60_000;
    const closed = session.status === "cancelled" || session.status === "rejected";
    (closed || endMs <= nowMs ? past : upcoming).push(session);
  }
  upcoming.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  past.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const all = [...sessions].sort(
    (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  );
  return { upcoming, past, all };
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function PencilIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
