"use client";

// Today's agenda card per spec § 4.3.
//
// Vertical timeline of every session on TODAY (regardless of week
// offset state for visualisation, but content keyed off the producer's
// real "today"). State transitions:
//   - Past:    end ≤ now            → 0.45 opacity, muted dot
//   - Live:    start ≤ now < end    → red dot + halo + "● LIVE"
//   - Up next: first future row     → kind dot + amber "UP NEXT"
//   - Future:  rest                 → kind dot
//
// When weekOffset != 0 the agenda shows an empty-state — "today's
// lineup" only makes sense when the producer is looking at the
// current week.

import { KIND_COLORS, inferSessionKind } from "./session-kind";

export type TodaySession = {
  id: string;
  artistName: string;
  startsAt: string; // ISO
  durationMin: number;
  packageName: string | null;
};

export function ScheduleTodayAgenda({
  sessions,
  weekOffset,
}: {
  sessions: readonly TodaySession[];
  weekOffset: number;
}) {
  return (
    <section
      aria-labelledby="today-agenda-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <h2
          id="today-agenda-heading"
          className="font-display text-[13px] tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Today&rsquo;s agenda
        </h2>
        <ClockIcon />
      </header>

      <Body sessions={sessions} weekOffset={weekOffset} />
    </section>
  );
}

function Body({
  sessions,
  weekOffset,
}: {
  sessions: readonly TodaySession[];
  weekOffset: number;
}) {
  if (weekOffset !== 0) {
    return (
      <p className="px-4 py-5 text-[12.5px] text-[rgb(var(--fg-muted))]">
        Pick this week to see today&rsquo;s lineup.
      </p>
    );
  }
  if (sessions.length === 0) {
    return (
      <p className="px-4 py-5 text-[12.5px] text-[rgb(var(--fg-muted))]">
        Nothing on the calendar — go get some coffee.
      </p>
    );
  }

  const now = new Date();
  // Determine "up next" — first future session by start time.
  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const upNextId = sorted.find((s) => new Date(s.startsAt) > now)?.id;

  return (
    <ol className="relative px-4 py-3">
      <span
        aria-hidden
        className="absolute bottom-2 left-[26px] top-2 w-[1.5px]"
        style={{ background: "rgb(var(--border-subtle))" }}
      />
      {sorted.map((s) => (
        <AgendaRow key={s.id} session={s} now={now} upNextId={upNextId} />
      ))}
    </ol>
  );
}

function AgendaRow({
  session,
  now,
  upNextId,
}: {
  session: TodaySession;
  now: Date;
  upNextId: string | undefined;
}) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const isPast = end.getTime() <= now.getTime();
  const isLive =
    start.getTime() <= now.getTime() && now.getTime() < end.getTime();
  const isUpNext = !isLive && !isPast && upNextId === session.id;

  const kind = inferSessionKind(session.packageName);
  const kindToken = KIND_COLORS[kind];

  const startLabel = start.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const titleText = session.packageName ?? "Session";

  return (
    <li
      className="relative flex items-start gap-3 py-2 pl-[22px]"
      style={{ opacity: isPast ? 0.45 : 1 }}
    >
      <DotMark
        kindToken={kindToken}
        state={isLive ? "live" : isPast ? "past" : "future"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[10px] tracking-[0.08em] text-[rgb(var(--fg-default))]"
            style={{ fontWeight: 700 }}
          >
            {startLabel}
          </span>
          {isLive ? (
            <span
              className="font-mono text-[8.5px] tracking-[0.1em] text-[rgb(var(--fg-danger))]"
              style={{ fontWeight: 800 }}
            >
              ● LIVE
            </span>
          ) : null}
          {isUpNext ? (
            <span
              className="font-mono text-[8.5px] tracking-[0.1em] text-[rgb(var(--brand-primary-dark))]"
              style={{ fontWeight: 800 }}
            >
              UP NEXT
            </span>
          ) : null}
        </div>
        <p
          className="mt-0.5 truncate text-[12.5px] text-[rgb(var(--fg-default))]"
          style={{ fontWeight: 700 }}
        >
          {titleText}
        </p>
        <p className="truncate text-[11px] text-[rgb(var(--fg-muted))]">
          {session.artistName} · {kind}
        </p>
      </div>
    </li>
  );
}

function DotMark({
  kindToken,
  state,
}: {
  kindToken: string;
  state: "live" | "past" | "future";
}) {
  if (state === "live") {
    return (
      <span
        aria-hidden
        className="absolute left-0 top-3 inline-flex h-3 w-3 items-center justify-center rounded-full"
        style={{
          background: "rgb(var(--fg-danger))",
          boxShadow: "0 0 0 3px rgb(var(--fg-danger) / 0.25), 0 0 0 2px rgb(var(--bg-elevated))",
        }}
      />
    );
  }
  if (state === "past") {
    return (
      <span
        aria-hidden
        className="absolute left-0 top-3 inline-flex h-3 w-3 rounded-full border-2 border-[rgb(var(--bg-elevated))]"
        style={{ background: "rgb(var(--fg-faint))" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="absolute left-0 top-3 inline-flex h-3 w-3 rounded-full border-2 border-[rgb(var(--bg-elevated))]"
      style={{ background: `rgb(var(${kindToken}))` }}
    />
  );
}

function ClockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-[rgb(var(--fg-muted))]"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
