"use client";

import { FileText } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

// SessionsTab — per-song session log (DESIGN.md §4.4, BUILD-NOTES
// §5.4.3). Each row: stacked date stamp (e.g. `14 / OCT`) · session
// name + sub · attendee avatars · duration · "Notes" button.
//
// Phase 3 surfaces the data; the "Notes" button is stubbed disabled
// (Phase 4 wires the note-viewer panel).

export interface SessionsTabSession {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  name: string;
  attendees: string[];
  notes?: string;
}

interface SessionsTabProps {
  sessions: SessionsTabSession[];
}

function formatDay(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(8, 10);
  }
}

function formatMonth(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short" })
      .format(d)
      .toUpperCase();
  } catch {
    return d.toISOString().slice(5, 7);
  }
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${String(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
}

export function SessionsTab({ sessions }: SessionsTabProps) {
  if (sessions.length === 0) {
    return (
      <section
        role="tabpanel"
        id="panel-sessions"
        aria-labelledby="tab-sessions"
        className="rounded-[var(--radius-lg)] border px-6 py-10 text-center"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <p
          className="font-syne text-[18px] font-bold"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          No sessions yet
        </p>
        <p
          className="mt-2 text-[13px]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          Book the artist on Calendar to schedule the first one.
        </p>
      </section>
    );
  }

  return (
    <section
      role="tabpanel"
      id="panel-sessions"
      aria-labelledby="tab-sessions"
      className="space-y-2"
    >
      {sessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-4 rounded-[var(--radius-md)] border px-4 py-3"
          style={{
            background: "rgb(var(--bg-elevated))",
            borderColor: "rgb(var(--border-subtle))",
          }}
        >
          {/* Stacked date stamp — DD / MON */}
          <div className="flex w-12 shrink-0 flex-col items-center justify-center text-center">
            <span
              className="font-syne text-[18px] font-bold leading-none tabular-nums"
              style={{ color: "rgb(var(--fg-default))" }}
            >
              {formatDay(s.startsAt)}
            </span>
            <span
              className="mt-0.5 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              {formatMonth(s.startsAt)}
            </span>
          </div>

          {/* Name + sub */}
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[14px] font-semibold"
              style={{ color: "rgb(var(--fg-default))" }}
            >
              {s.name}
            </p>
            <p
              className="mt-0.5 truncate text-[12px]"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              {s.attendees.join(" · ") || "—"}
            </p>
          </div>

          {/* Attendee avatars (overlap) */}
          <div className="flex shrink-0 -space-x-2">
            {s.attendees.slice(0, 3).map((name, i) => (
              <span
                key={`${s.id}-${String(i)}-${name}`}
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white"
                style={{
                  background: producerGradient(name),
                  borderColor: "rgb(var(--bg-elevated))",
                }}
                title={name}
              >
                {producerInitials(name)}
              </span>
            ))}
          </div>

          {/* Duration */}
          <span
            className="shrink-0 font-mono text-[12px] tabular-nums"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            {formatDuration(s.durationMinutes)}
          </span>

          {/* Notes button */}
          <button
            type="button"
            disabled
            title="Coming soon"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: "transparent",
              borderColor: "rgb(var(--border-subtle))",
              color: "rgb(var(--fg-default))",
            }}
          >
            <FileText size={12} />
            Notes
          </button>
        </div>
      ))}
    </section>
  );
}
