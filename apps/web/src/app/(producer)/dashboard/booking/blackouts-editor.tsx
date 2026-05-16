"use client";

import { type SyntheticEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { addBlackoutAction, removeBlackoutAction } from "./actions";

// Blackouts are stored + rendered in producer-local YYYY-MM-DD (no
// time component), so we compare against "today" by formatting now in
// the local timezone.
export interface BlackoutRow {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  reason: string | null;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(y)}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  // Inclusive diff in days between two YYYY-MM-DD strings. We don't
  // need sub-day precision so UTC midnight math is fine here even
  // across DST — both operands are pinned to a single calendar day.
  const d1 = new Date(`${a}T00:00:00Z`).getTime();
  const d2 = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((d2 - d1) / 86_400_000);
}

function formatHuman(dateIso: string): string {
  // Force UTC parse so we don't trip over local-TZ midnight weirdness,
  // then format using the current locale.
  const d = new Date(`${dateIso}T12:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Color-coded status chip. "Active" = today falls inside the range;
// "Upcoming" = starts within N days; "Past" = ended before today.
function statusOf(row: BlackoutRow, today: string): { label: string; tone: "active" | "upcoming" | "past" } {
  if (today >= row.startDate && today <= row.endDate) return { label: "Active today", tone: "active" };
  if (today > row.endDate) return { label: "Past", tone: "past" };
  const days = daysBetween(today, row.startDate);
  if (days === 1) return { label: "Tomorrow", tone: "upcoming" };
  if (days <= 30) return { label: `In ${String(days)} days`, tone: "upcoming" };
  return { label: "Scheduled", tone: "upcoming" };
}

export function BlackoutsEditor({ initialBlackouts }: { initialBlackouts: BlackoutRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const today = todayIso();
  // Inline form state. Pre-seed end to match start so the common case
  // (one-day block) needs one date click, not two.
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Inline validation: if start > end, block the submit button.
  const rangeInvalid = useMemo(() => {
    if (!startDate || !endDate) return false;
    return endDate < startDate;
  }, [startDate, endDate]);

  function onAdd(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate) {
      setError("Pick a start and end date.");
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    startTransition(async () => {
      const res = await addBlackoutAction({
        startDate,
        endDate,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (res.ok) {
        toast("Blackout added. Clients won't see slots on those days.", "success");
        setStartDate("");
        setEndDate("");
        setReason("");
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  function onRemove(id: string) {
    setRemovingId(id);
    startTransition(async () => {
      const res = await removeBlackoutAction({ id });
      setRemovingId(null);
      if (res.ok) {
        toast("Blackout removed.", "info");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.78rem] font-semibold text-[rgb(var(--fg-primary))]">
          Blackouts
        </h3>
        <span className="text-[0.66rem] text-[rgb(var(--fg-muted))]">
          {initialBlackouts.length === 0
            ? "Schedule fully open"
            : `${String(initialBlackouts.length)} block${initialBlackouts.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Add form — single compact row, fields drop their labels in
          favour of the placeholder + sr-only label, dates keep text-base
          to dodge iOS zoom-on-focus. */}
      <form
        onSubmit={onAdd}
        className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay)/0.5)] px-3 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Label htmlFor="bkStart" className="sr-only">
            Start date
          </Label>
          <Input
            id="bkStart"
            type="date"
            value={startDate}
            min={today}
            onChange={(e) => {
              setStartDate(e.target.value);
              // Auto-sync end if empty or before new start.
              if (!endDate || endDate < e.target.value) {
                setEndDate(e.target.value);
              }
            }}
            required
            className="h-8 w-[8.5rem] text-base"
          />
          <span className="text-xs text-[rgb(var(--fg-muted))]">→</span>
          <Label htmlFor="bkEnd" className="sr-only">
            End date
          </Label>
          <Input
            id="bkEnd"
            type="date"
            value={endDate}
            min={startDate || today}
            onChange={(e) => {
              setEndDate(e.target.value);
            }}
            required
            aria-invalid={rangeInvalid}
            className="h-8 w-[8.5rem] text-base"
          />
          <Label htmlFor="bkReason" className="sr-only">
            Reason
          </Label>
          <Input
            id="bkReason"
            type="text"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder="Reason (optional)"
            maxLength={200}
            className="h-8 min-w-[10rem] flex-1 text-base"
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || rangeInvalid}
            className="h-8"
          >
            {pending ? "…" : "Add"}
          </Button>
        </div>
        {rangeInvalid ? (
          <p role="alert" className="mt-1.5 text-[0.66rem] text-[rgb(var(--fg-danger))]">
            End must be on or after the start date.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-1.5 text-[0.66rem] text-[rgb(var(--fg-danger))]">
            {error}
          </p>
        ) : null}
      </form>

      {/* List */}
      {initialBlackouts.length > 0 ? (
        <ul className="overflow-hidden rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay)/0.5)]">
          {initialBlackouts.map((b, idx) => {
            const status = statusOf(b, today);
            const isSingleDay = b.startDate === b.endDate;
            return (
              <li
                key={b.id}
                className={[
                  "flex flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors",
                  idx === 0
                    ? ""
                    : "border-t border-[rgb(var(--border-subtle))]",
                ].join(" ")}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-[rgb(var(--fg-primary))]">
                      {isSingleDay
                        ? formatHuman(b.startDate)
                        : `${formatHuman(b.startDate)} → ${formatHuman(b.endDate)}`}
                    </span>
                    <span
                      className={[
                        "inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-px text-[0.6rem] font-medium uppercase tracking-wider",
                        status.tone === "active"
                          ? "bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--brand-primary))]"
                          : status.tone === "upcoming"
                          ? "bg-[rgb(var(--fg-muted)/0.15)] text-[rgb(var(--fg-secondary))]"
                          : "bg-transparent text-[rgb(var(--fg-muted))]",
                      ].join(" ")}
                    >
                      {status.label}
                    </span>
                    {b.reason ? (
                      <span className="text-[0.66rem] text-[rgb(var(--fg-secondary))]">
                        · {b.reason}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove blackout ${b.startDate}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)] hover:text-[rgb(var(--fg-danger))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:opacity-50"
                  onClick={() => {
                    onRemove(b.id);
                  }}
                  disabled={pending && removingId === b.id}
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 20 20"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path
                      d="M5 6h10M8 6V4h4v2M7 6l1 10h4l1-10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
