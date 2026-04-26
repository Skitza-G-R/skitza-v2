"use client";

// Project Dashboard — Recent activity feed (Story 04, PRD §11.5).
//
// Linear-style collapsed history. The procedure returns up to 10
// events; we slice to 5 by default (`selectVisibleEvents`) and let the
// producer toggle "Show earlier" to expand. This is a client
// component because of the disclosure toggle (useState).
//
// Each event renders one line: a small dot (intent-coloured), a brief
// label from `describeActivityEvent`, and the relative time. Click
// targets are not interactive yet — clicking through to the source
// (e.g. open the comment thread) lands in a later story.
//
// Empty state: when there are no events, render a single placeholder
// line ("Project just started — events will appear here as you work.")
// per story acceptance criteria.

import { useState } from "react";

import { formatRelativeTime } from "~/lib/time/relative";

import {
  describeActivityEvent,
  selectVisibleEvents,
  type ActivityEvent,
  type ActivityIntent,
} from "./dashboard-helpers";

export interface RecentActivityFeedProps {
  events: ActivityEvent[];
}

export function RecentActivityFeed({ events }: RecentActivityFeedProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = selectVisibleEvents(events, expanded);
  const hasMore = events.length > visible.length;

  return (
    <section
      aria-label="Recent activity"
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          Recent activity
        </h3>
      </header>

      {events.length === 0 ? (
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
          Project just started — events will appear here as you work.
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {visible.map((event) => {
            const line = describeActivityEvent(event);
            return (
              <li
                key={event.id}
                className="flex items-start gap-3"
              >
                <span
                  aria-hidden="true"
                  className={[
                    "mt-2 h-1.5 w-1.5 shrink-0 rounded-full",
                    intentDot(line.intent),
                  ].join(" ")}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[rgb(var(--fg-primary))]">
                    {line.label}
                  </p>
                  <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
                    {formatRelativeTime(event.occurredAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {hasMore || (expanded && events.length > 5) ? (
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => !v);
          }}
          className="self-start text-xs text-[rgb(var(--brand-primary))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] rounded"
        >
          {expanded ? "Show fewer" : "Show earlier"}
        </button>
      ) : null}
    </section>
  );
}

// ─── Per-intent dot colour ──────────────────────────────────────────
function intentDot(intent: ActivityIntent): string {
  switch (intent) {
    case "success":
      return "bg-[rgb(var(--brand-primary))]";
    case "warning":
      return "bg-[rgb(var(--fg-warning))]";
    case "danger":
      return "bg-[rgb(var(--fg-danger))]";
    case "info":
      return "bg-[rgb(var(--brand-accent))]";
    case "neutral":
      return "bg-[rgb(var(--fg-muted))]";
  }
}
