"use client";

// Pending booking requests card per spec § 4.3.
//
// Polished visual upgrade over intro-requests-panel.tsx — keeps the
// optimistic Accept/Decline server action wiring (calendar-actions.ts).
// Each row mirrors the spec's bg-background card with subtle border,
// 28px gradient avatar, mono datetime, dark "Accept" + ghost "Decline".
//
// `isNew` is a UI-only marker for booking requests received in the
// last 24 hours — surfaces a 6px amber dot top-right of the avatar so
// the producer can distinguish "old pending" from "fresh inbound".

import { type RefObject, useEffect, useRef, useState, useTransition } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

import { formatCalendarDate, formatCalendarTime } from "./calendar-time";
import { confirmBooking, rejectBooking } from "./calendar-actions";

export type PendingRequest = {
  id: string;
  artistName: string;
  artistEmail: string;
  startsAt: string; // ISO
  durationMin: number;
  packageName: string | null;
  message: string | null;
  receivedAtIso: string | null; // for isNew calc; null = treat as not-new
};

export function SchedulePendingCard({
  initial,
  autoConfirm,
  initialNow,
  timeZone,
  selectedBookingId = null,
}: {
  initial: readonly PendingRequest[];
  autoConfirm: boolean;
  initialNow: string;
  timeZone: string;
  selectedBookingId?: string | null;
}) {
  const [rows, setRows] = useState<readonly PendingRequest[]>(initial);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [declineTarget, setDeclineTarget] = useState<PendingRequest | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  const selectedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    setRows(initial);
  }, [initial]);

  useEffect(() => {
    if (!selectedBookingId) return;
    selectedRef.current?.scrollIntoView({ block: "nearest" });
    selectedRef.current?.focus({ preventScroll: true });
  }, [selectedBookingId]);

  function act(row: PendingRequest, kind: "confirm" | "reject") {
    setPendingIds((current) => new Set(current).add(row.id));
    startTransition(async () => {
      const res =
        kind === "confirm"
          ? await confirmBooking({ id: row.id })
          : await rejectBooking({ id: row.id });
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      setRows((current) => current.filter((candidate) => candidate.id !== row.id));
      toast(kind === "confirm" ? "Booking confirmed." : "Booking rejected.", "success");
    });
  }

  return (
    <section
      aria-labelledby="pending-requests-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <h2
          id="pending-requests-heading"
          className="font-display text-[13px] tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Pending requests
        </h2>
        {rows.length > 0 ? (
          <span className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
            {String(rows.length)}
          </span>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-5 text-[12.5px] text-[rgb(var(--fg-muted))]">
          {autoConfirm
            ? "Auto-confirm is on — new bookings go straight to confirmed."
            : "You’re all caught up."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 p-2">
          {rows.map((row) => (
            <PendingRow
              key={row.id}
              row={row}
              initialNow={initialNow}
              timeZone={timeZone}
              busy={pendingIds.has(row.id)}
              selected={selectedBookingId === row.id}
              {...(selectedBookingId === row.id ? { selectedRef } : {})}
              onAccept={() => {
                act(row, "confirm");
              }}
              onDecline={() => {
                setDeclineTarget(row);
              }}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={declineTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeclineTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this booking request?</DialogTitle>
            <DialogDescription>
              {declineTarget
                ? `${declineTarget.artistName} will need to choose another time.`
                : "The artist will need to choose another time."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setDeclineTarget(null);
              }}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-default))]"
            >
              Keep request
            </button>
            <button
              type="button"
              disabled={!declineTarget || pendingIds.has(declineTarget.id)}
              onClick={() => {
                if (!declineTarget) return;
                const target = declineTarget;
                setDeclineTarget(null);
                act(target, "reject");
              }}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-4 text-sm font-semibold text-[rgb(var(--fg-inverse))] disabled:opacity-50"
            >
              Decline booking
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PendingRow({
  row,
  initialNow,
  timeZone,
  busy,
  selected,
  selectedRef,
  onAccept,
  onDecline,
}: {
  row: PendingRequest;
  initialNow: string;
  timeZone: string;
  busy: boolean;
  selected: boolean;
  selectedRef?: RefObject<HTMLLIElement | null>;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const isNew = row.receivedAtIso
    ? new Date(initialNow).getTime() - new Date(row.receivedAtIso).getTime() < 24 * 60 * 60 * 1000
    : false;
  const dt = new Date(row.startsAt);
  const dateLabel = formatCalendarDate(dt, timeZone);
  const timeLabel = formatCalendarTime(dt, timeZone);

  return (
    <li
      ref={selectedRef}
      tabIndex={selected ? -1 : undefined}
      data-selected={selected ? "true" : "false"}
      className={[
        "rounded-[10px] border bg-[rgb(var(--bg-background))] p-3 outline-none",
        selected
          ? "border-[rgb(var(--brand-primary))] ring-2 ring-[rgb(var(--brand-primary)/0.22)]"
          : "border-[rgb(var(--border-subtle))]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar email={row.artistEmail} name={row.artistName} />
          {isNew ? (
            <span
              aria-label="New request"
              className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full"
              style={{ background: "rgb(var(--brand-primary))" }}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[12.5px] text-[rgb(var(--fg-default))]"
            style={{ fontWeight: 700 }}
          >
            {row.artistName}
          </p>
          <p className="truncate text-[11px] text-[rgb(var(--fg-muted))]">
            {row.packageName ?? "Session"}
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
            {dateLabel}, {timeLabel}
          </p>
        </div>
      </div>
      {row.message ? (
        <p className="mt-2 line-clamp-3 text-[11.5px] leading-snug text-[rgb(var(--fg-secondary))]">
          {row.message}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="sk-press inline-flex h-11 flex-1 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3 text-[11px] text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none disabled:opacity-50"
          style={{ fontWeight: 700 }}
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="sk-press inline-flex h-11 flex-1 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-transparent px-3 text-[11px] text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none disabled:opacity-50"
          style={{ fontWeight: 600 }}
        >
          Decline
        </button>
      </div>
    </li>
  );
}

function Avatar({ email, name }: { email: string; name: string }) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const idx = hashCode(email) % GRADIENTS.length;
  const grad = GRADIENTS[idx] ?? GRADIENTS[0] ?? "";
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] text-[rgb(var(--fg-inverse))]"
      style={{ background: grad, fontWeight: 700 }}
    >
      {initials || "?"}
    </span>
  );
}

const GRADIENTS = [
  "linear-gradient(135deg, rgb(var(--kind-mix)) 0%, rgb(var(--kind-songwriting)) 100%)",
  "linear-gradient(135deg, rgb(var(--kind-tracking)) 0%, rgb(var(--kind-master)) 100%)",
  "linear-gradient(135deg, rgb(var(--kind-intro)) 0%, rgb(var(--kind-mix)) 100%)",
  "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
  "linear-gradient(135deg, rgb(var(--fg-default)) 0%, rgb(var(--brand-primary)) 100%)",
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
