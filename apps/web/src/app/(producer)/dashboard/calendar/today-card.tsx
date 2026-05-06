"use client";

// Sidebar "Today" card on the Meetings tab. Surfaces the producer's NEXT
// upcoming confirmed session (within the current day) so the answer to
// "what's the next thing on my plate?" is always one glance away.
//
// Server component proxy — actual data is computed in the page (filtered
// down to today's confirmed sessions) and passed in. Empty state when
// nothing is on the schedule for the rest of today.

export type TodayNext = {
  id: string;
  artistName: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  packageName: string | null;
};

export function TodayCard({ next }: { next: TodayNext | null }) {
  return (
    <section
      aria-labelledby="today-card-heading"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="border-b border-[rgb(var(--border-subtle))] px-3 py-2.5">
        <h2
          id="today-card-heading"
          className="font-display text-sm tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Today
        </h2>
      </header>
      {next ? (
        <div className="p-3">
          <div className="rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary)/0.25)] bg-[rgb(var(--brand-primary)/0.08)] px-3 py-2.5">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[rgb(var(--brand-primary))]">
              Next · {relativeUntil(next.startsAt)}
            </p>
            <p
              className="mt-1 truncate text-sm text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 700 }}
            >
              {next.packageName ?? "Session"}
            </p>
            <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-secondary))]">
              {timeRange(next.startsAt, next.endsAt)} · {next.artistName}
            </p>
          </div>
        </div>
      ) : (
        <p className="px-3 py-3 text-[0.7rem] text-[rgb(var(--fg-secondary))]">
          Nothing on the schedule for the rest of today. Confirmed sessions
          will surface here.
        </p>
      )}
    </section>
  );
}

function relativeUntil(iso: string): string {
  const dt = new Date(iso);
  const now = new Date();
  const diffMs = dt.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 0) return "now";
  if (diffMin < 60) return `in ${String(Math.max(1, diffMin))}m`;
  const diffH = Math.round(diffMin / 60);
  return `in ${String(diffH)}h`;
}

function timeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return `${fmt(start)}–${fmt(end)}`;
}
