"use client";

import { useState, useTransition } from "react";

import { GCalSyncBadge } from "~/app/(producer)/dashboard/booking/gcal-sync-badge";
import { useToast } from "~/components/ui/toast";

import { confirmBooking, rejectBooking } from "./calendar-actions";

export type MeetingRow = {
  id: string;
  artistName: string;
  startsAt: string;
  durationMin: number;
  packageName: string | null;
};

export function MeetingsPanel({
  pending,
  upcoming,
  autoConfirm,
}: {
  pending: MeetingRow[];
  upcoming: MeetingRow[];
  autoConfirm: boolean;
}) {
  return (
    <div className="space-y-6">
      <GCalSyncBadge status="not_connected" />
      <PendingSection initial={pending} autoConfirm={autoConfirm} />
      <UpcomingSection rows={upcoming} />
    </div>
  );
}

function PendingSection({
  initial,
  autoConfirm,
}: {
  initial: MeetingRow[];
  autoConfirm: boolean;
}) {
  const [rows, setRows] = useState<MeetingRow[]>(initial);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  function act(row: MeetingRow, kind: "confirm" | "reject") {
    setPendingId(row.id);
    const snapshot = rows;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    startTransition(async () => {
      const res =
        kind === "confirm"
          ? await confirmBooking({ id: row.id })
          : await rejectBooking({ id: row.id });
      setPendingId(null);
      if (!res.ok) {
        setRows(snapshot);
        toast(res.error, "error");
        return;
      }
      toast(
        kind === "confirm"
          ? "Booking confirmed."
          : "Booking rejected.",
        "success",
      );
    });
  }

  return (
    <section
      aria-labelledby="pending-heading"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] p-4"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2
            id="pending-heading"
            className="font-display text-base tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Pending approvals
          </h2>
          <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
            New booking requests waiting on your call.
          </p>
        </div>
        {rows.length > 0 ? (
          <span className="inline-flex items-center rounded-full bg-[rgb(var(--brand-primary)/0.18)] px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-warning))]">
            {rows.length}
          </span>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-overlay)/0.5)] px-3 py-2 text-xs text-[rgb(var(--fg-secondary))]">
          {autoConfirm
            ? "Nothing waiting on you. Auto-confirm is on — new bookings land directly in upcoming."
            : "Nothing waiting on you. Auto-confirm is off — new requests will appear here for review."}
        </p>
      ) : (
        <ul className="divide-y divide-[rgb(var(--brand-primary)/0.18)]">
          {rows.map((row) => (
            <li key={row.id} className="py-3 first:pt-0 last:pb-0">
              <MeetingRowView row={row} />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => {
                    act(row, "confirm");
                  }}
                  className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-3 text-xs font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => {
                    act(row, "reject");
                  }}
                  className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UpcomingSection({ rows }: { rows: MeetingRow[] }) {
  return (
    <section aria-labelledby="upcoming-heading">
      <header className="mb-3">
        <h2
          id="upcoming-heading"
          className="font-display text-base tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Upcoming sessions
        </h2>
        <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
          Confirmed bookings in the next 14 days.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay)/0.4)] px-3 py-2 text-xs text-[rgb(var(--fg-secondary))]">
          No sessions in the next 14 days.
        </p>
      ) : (
        <ul className="divide-y divide-[rgb(var(--border-subtle))] rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-3">
              <MeetingRowView row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MeetingRowView({ row }: { row: MeetingRow }) {
  const date = new Date(row.startsAt);
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const serviceLabel = row.packageName ?? "Session";

  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-sm text-[rgb(var(--fg-primary))]"
        style={{ fontWeight: 600 }}
      >
        {row.artistName}
      </span>
      <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        {dateLabel} · {timeLabel} · {row.durationMin} min · {serviceLabel}
      </span>
    </div>
  );
}
