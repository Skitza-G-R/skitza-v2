"use client";

// Meetings tab — week-grid Schedule + Intro Requests sidebar + Today card.
//
// Layout:
//   [ Schedule (week grid)            ] [ Intro Requests   ]
//   [                                 ] [ Today card       ]
//   [ Upcoming sessions list                                ]
//
// All sub-components are pure visual; data comes from page.tsx via tRPC.

import { GCalSyncBadge } from "~/app/(producer)/dashboard/booking/gcal-sync-badge";

import { IntroRequestsPanel, type IntroRequest } from "./intro-requests-panel";
import { TodayCard, type TodayNext } from "./today-card";
import { WeekGrid, type ScheduleSession } from "./week-grid";

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
  schedule,
  todayNext,
  autoConfirm,
}: {
  pending: IntroRequest[];
  upcoming: MeetingRow[];
  schedule: ScheduleSession[];
  todayNext: TodayNext | null;
  autoConfirm: boolean;
}) {
  return (
    <div className="space-y-5">
      <GCalSyncBadge status="not_connected" />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <WeekGrid sessions={schedule} />
        <div className="flex flex-col gap-4">
          <IntroRequestsPanel initial={pending} autoConfirm={autoConfirm} />
          <TodayCard next={todayNext} />
        </div>
      </div>

      <UpcomingSection rows={upcoming} />
    </div>
  );
}

function UpcomingSection({ rows }: { rows: MeetingRow[] }) {
  return (
    <section aria-labelledby="upcoming-heading">
      <header className="mb-2.5">
        <h2
          id="upcoming-heading"
          className="font-display text-sm tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Upcoming sessions
        </h2>
        <p className="mt-0.5 text-[0.7rem] text-[rgb(var(--fg-secondary))]">
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
