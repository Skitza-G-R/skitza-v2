"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ChangeRequestDecision } from "./change-request-decision";
import { calendarDateTimeParts, formatCalendarTime } from "./calendar-time";
import { GoogleCalendarSessionSyncStatus } from "./google-calendar-session-sync";
import { KIND_COLORS, inferSessionKind } from "./session-kind";
import type { RawBookingStatus, SessionListItem } from "./session-row";
import { useManualSessionLauncher } from "./manual-session-launcher-context";

type Filter = "upcoming" | "past" | "all";
type DisplayStatus = "confirmed" | "pending" | "completed" | "no_show" | "rejected" | "cancelled";

export function ScheduleSessionsCard({
  sessions,
  initialNow,
  timeZone,
  selectedBookingId = null,
}: {
  sessions: readonly SessionListItem[];
  initialNow: string;
  timeZone: string;
  selectedBookingId?: string | null;
}) {
  const now = useMemo(() => new Date(initialNow), [initialNow]);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const { openSessionManagement } = useManualSessionLauncher();
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
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
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
                "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] px-1 text-[10px] capitalize transition-colors lg:h-7",
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
                  timeZone={timeZone}
                  onManage={openSessionManagement}
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
  timeZone,
  onManage,
}: {
  session: SessionListItem;
  now: Date;
  timeZone: string;
  onManage: (session: SessionListItem) => void;
}) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const status = deriveDisplayStatus(session.status, end, now);
  const dimmed = status === "cancelled" || status === "rejected" || status === "no_show";
  const serviceLabel = session.packageName ?? "Session";
  const kindToken = KIND_COLORS[inferSessionKind(session.kindSource ?? session.packageName)];

  return (
    <div
      className="grid min-h-[68px] grid-cols-[38px_minmax(0,1fr)] items-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-2"
      style={{ opacity: dimmed ? 0.62 : 1 }}
    >
      <CompactDate date={start} kindToken={kindToken} timeZone={timeZone} />
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
            {formatCalendarTime(start, timeZone)}–{formatCalendarTime(end, timeZone)}
          </span>
        </div>
        {session.billingTreatment === "complimentary" ||
        session.billingTreatment === "billable_extra" ||
        session.artistRsvpStatus ? (
          <p className="mt-1 truncate text-[9.5px] text-[rgb(var(--fg-muted))]">
            {[
              session.billingTreatment === "complimentary" ? "Complimentary" : null,
              session.billingTreatment === "billable_extra" ? "Payment due" : null,
              session.artistRsvpStatus
                ? `Invite: ${compactRsvpLabel(session.artistRsvpStatus)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <GoogleCalendarSessionSyncStatus
          bookingId={session.id}
          sync={session.calendarSync}
          compact
        />
        <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
          <CompactStatus status={status} />
          <button
            type="button"
            aria-label={`Manage session with ${session.artistName}`}
            title="Manage session"
            onClick={() => {
              onManage(session);
            }}
            className="sk-press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none motion-reduce:active:scale-100"
          >
            <MoreMini />
          </button>
        </div>
      </div>
      {session.changeRequest ? (
        <div className="col-span-2">
          <ChangeRequestDecision session={session} timeZone={timeZone} compact />
        </div>
      ) : null}
    </div>
  );
}

function compactRsvpLabel(status: NonNullable<SessionListItem["artistRsvpStatus"]>): string {
  if (status === "accepted") return "accepted";
  if (status === "declined") return "declined";
  if (status === "tentative") return "maybe";
  return "awaiting reply";
}

function MoreMini() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CompactDate({
  date,
  kindToken,
  timeZone,
}: {
  date: Date;
  kindToken: string;
  timeZone: string;
}) {
  const { weekday, day } = calendarDateTimeParts(date, timeZone);
  return (
    <div className="relative flex h-full flex-col items-center justify-center pl-1.5">
      <span
        aria-hidden
        className="absolute inset-y-1 left-0 w-[3px] rounded-full"
        style={{ background: `rgb(var(${kindToken}))` }}
      />
      <span className="font-mono text-[8px] tracking-[0.08em] text-[rgb(var(--brand-primary-dark))]">
        {weekday.toUpperCase()}
      </span>
      <span
        className="font-display text-[20px] leading-none text-[rgb(var(--fg-default))]"
        style={{ fontWeight: 800 }}
      >
        {String(day)}
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
    completed: { label: "Completed", className: "pill-neutral" },
    no_show: { label: "No show", className: "pill-danger" },
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
  if (raw === "completed") return "completed";
  if (raw === "no_show") return "no_show";
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
    const closed =
      session.status === "cancelled" ||
      session.status === "rejected" ||
      session.status === "completed" ||
      session.status === "no_show";
    (closed || endMs <= nowMs ? past : upcoming).push(session);
  }
  upcoming.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  past.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const all = [...sessions].sort(
    (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  );
  return { upcoming, past, all };
}
