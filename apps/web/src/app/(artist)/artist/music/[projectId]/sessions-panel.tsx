"use client";

import {
  formatSessionDate,
  formatSessionTime,
  formatSessionTimeZoneLabel,
} from "~/components/artist/sessions/book-data";

// SessionsPanel — artist-only L2 widget.
//
// Renders the project's upcoming + pending sessions in a small card
// list below the shared ProjectPage tracklist (via the `extraBelow`
// slot on ProjectPage). The producer L2 doesn't show this — sessions
// are scoped to the artist↔producer relationship, not the project's
// raw track stack.
//
// Same visual treatment as the prior NowPlaying screen, just extracted
// into its own file so the page.tsx stays thin and the panel can be
// reused if other artist surfaces want it.

export type SessionRow = {
  id: string;
  startsAtIso: string;
  artistTimezone: string;
  producerTimezone: string;
  durationMin: number;
  status: string;
  packageName: string | null;
};

export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  return (
    <section>
      <h2 className="mb-3 font-mono text-[0.66rem] tracking-wider text-[rgb(var(--fg-muted))] uppercase">
        Sessions
      </h2>
      <ul className="space-y-2">
        {sessions.map((session) => {
          const startsAt = new Date(session.startsAtIso);
          const isPast = startsAt < new Date();
          const date = formatSessionDate(session.startsAtIso, session.artistTimezone);
          const time = formatSessionTime(session.startsAtIso, session.artistTimezone);
          const timezone = formatSessionTimeZoneLabel(session.startsAtIso, session.artistTimezone);
          const statusLabel = isPast
            ? "Completed"
            : session.status === "pending_approval"
              ? "Pending approval"
              : session.status === "pending_payment"
                ? "Awaiting payment"
                : "Upcoming";
          return (
            <li
              key={session.id}
              className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3"
            >
              <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
                {date} · {time}
              </p>
              <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
                {timezone} · {String(session.durationMin)} min
                {session.packageName ? ` · ${session.packageName}` : ""}
                {" · "}
                {statusLabel}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
