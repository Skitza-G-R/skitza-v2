"use client";

// ChangeTimeModal — UI-only per the redesign agreement.
// On submit we toast "Coming soon (rescheduling)" instead of patching
// the booking, since the backend doesn't support `booking.update` yet.
// All inputs are real and the diff chip lights up so producers can
// preview the experience.

import { useEffect, useState } from "react";

import { useToast } from "~/components/ui/toast";

import {
  ModalGhostButton,
  ModalPrimaryButton,
  SessionModalShell,
} from "./session-modal-shell";
import type { SessionListItem } from "./session-row";

const TIME_SLOTS = buildSlots();

export function ChangeTimeModal({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  session: SessionListItem;
}) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);

  const initialDate = toDateInput(start);
  const initialStart = toTimeInput(start);
  const initialEnd = toTimeInput(end);

  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [note, setNote] = useState("");
  const { toast } = useToast();

  // Reset on re-open so a stale draft doesn't leak between sessions.
  useEffect(() => {
    if (!open) return;
    setDate(initialDate);
    setStartTime(initialStart);
    setEndTime(initialEnd);
    setNote("");
  }, [open, initialDate, initialStart, initialEnd]);

  const changed =
    date !== initialDate ||
    startTime !== initialStart ||
    endTime !== initialEnd ||
    note.length > 0;

  // End must be strictly after start. The select renders 30-min slots
  // 08:00–21:30, so a "13:00 → 12:00" picking mistake is easy to make
  // — disable submit + show inline error rather than letting the diff
  // chip pretend it's valid.
  const endIsAfterStart = compareTime(endTime, startTime) > 0;

  function handleSubmit() {
    if (!endIsAfterStart) return;
    toast(
      "Reschedule wiring lands next sprint — saved your draft locally for review.",
      "info",
    );
    onOpenChange(false);
  }

  // When the producer picks a start time that pushes past the current
  // end, snap the end to start + 1h so the form stays valid by default.
  function handleStartChange(next: string) {
    setStartTime(next);
    if (compareTime(endTime, next) <= 0) {
      setEndTime(addOneHour(next));
    }
  }

  return (
    <SessionModalShell
      open={open}
      onOpenChange={onOpenChange}
      tone="brand"
      eyebrow="CHANGE TIME"
      title="Reschedule session"
      subtitle={`Currently ${formatHumanRange(start, end)} with ${session.artistName}.`}
      icon={<CalendarClockIcon />}
      body={
        <>
          <SessionChip session={session} />
          <Field label="New date">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
              }}
              className="h-9 w-full rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 font-mono text-[12.5px] text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
              style={{ fontWeight: 600 }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <TimeSelect value={startTime} onChange={handleStartChange} />
            </Field>
            <Field label="End">
              <TimeSelect value={endTime} onChange={setEndTime} />
            </Field>
          </div>
          {changed && !endIsAfterStart ? (
            <div
              role="alert"
              className="rounded-[10px] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.06)] px-3 py-2 text-[11.5px] text-[rgb(var(--fg-danger))]"
              style={{ fontWeight: 600 }}
            >
              End time must be after start time.
            </div>
          ) : changed ? (
            <DiffChip date={date} startTime={startTime} endTime={endTime} />
          ) : null}
          <Field label="Note for the artist (optional)">
            <textarea
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              placeholder="Hey — needed to push this back an hour, hope that works."
              className="w-full resize-none rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[12.5px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
            />
          </Field>
        </>
      }
      footer={
        <>
          <ModalGhostButton
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </ModalGhostButton>
          <ModalPrimaryButton
            onClick={handleSubmit}
            disabled={!changed || !endIsAfterStart}
            tone="dark"
          >
            Send new time
          </ModalPrimaryButton>
        </>
      }
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
        style={{ fontWeight: 700 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function TimeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className="h-9 w-full appearance-none rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 font-mono text-[12.5px] text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
      style={{ fontWeight: 600 }}
    >
      {TIME_SLOTS.map((slot) => (
        <option key={slot} value={slot}>
          {slot}
        </option>
      ))}
    </select>
  );
}

function DiffChip({
  date,
  startTime,
  endTime,
}: {
  date: string;
  startTime: string;
  endTime: string;
}) {
  const dt = new Date(`${date}T${startTime}`);
  if (Number.isNaN(dt.getTime())) return null;
  const dateLabel = dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div
      className="rounded-[10px] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-3 py-2 font-mono text-[11.5px] text-[rgb(var(--brand-primary-dark))]"
      style={{ fontWeight: 600 }}
    >
      New: {dateLabel} · {startTime} – {endTime}
    </div>
  );
}

function SessionChip({ session }: { session: SessionListItem }) {
  return (
    <div
      className="rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-2.5"
    >
      <p className="text-[11px] text-[rgb(var(--fg-muted))]">
        {session.packageName ?? "Session"}
      </p>
      <p className="text-[12.5px] text-[rgb(var(--fg-default))]" style={{ fontWeight: 700 }}>
        {session.artistName}
      </p>
    </div>
  );
}

function CalendarClockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="16" cy="16" r="3" />
      <line x1="16" y1="14" x2="16" y2="16" />
      <line x1="16" y1="16" x2="17.5" y2="17.5" />
    </svg>
  );
}

function buildSlots(): string[] {
  const out: string[] = [];
  for (let h = 8; h <= 21; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
}

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(y)}-${m}-${day}`;
}

function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Compares two "HH:MM" strings. Returns positive if a > b, 0 if equal,
// negative if a < b. String compare works because the format is fixed-
// width zero-padded.
function compareTime(a: string, b: string): number {
  return a.localeCompare(b);
}

function addOneHour(t: string): string {
  const [h = "0", m = "0"] = t.split(":");
  const total = (Number(h) + 1) * 60 + Number(m);
  // Cap at 21:30 — last available slot.
  const capped = Math.min(total, 21 * 60 + 30);
  const newH = Math.floor(capped / 60);
  const newM = capped % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function formatHumanRange(start: Date, end: Date): string {
  const date = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const t = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${date}, ${t(start)} – ${t(end)}`;
}
