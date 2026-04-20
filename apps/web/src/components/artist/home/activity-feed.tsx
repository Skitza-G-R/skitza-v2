import Link from "next/link";

import type { ActivityItem } from "~/server/trpc/routers/artist";

// Server component — flat list of pre-formatted activity events.
// The router did all the per-row message-building work, so this just
// renders. When deepLink is null (e.g. session_confirmed has nowhere
// useful to go), the row renders as a non-interactive `<div>`.

const KIND_ICON: Record<ActivityItem["kind"], string> = {
  track_uploaded: "🎵",
  session_confirmed: "✅",
  invoice_paid: "💸",
};

export function ActivityFeed({ events }: { events: ActivityItem[] }) {
  if (events.length === 0) {
    return (
      <section
        aria-labelledby="activity-heading"
        className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <h2
          id="activity-heading"
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Activity
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Quiet for now. New mixes, sessions, and payments will land here.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="activity-heading"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="activity-heading"
        className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Activity
      </h2>
      <ul className="mt-3 divide-y divide-[rgb(var(--border-subtle))]">
        {events.map((event, idx) => (
          <li key={`${event.kind}-${String(idx)}-${String(event.occurredAt.getTime())}`}>
            <ActivityRow event={event} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityRow({ event }: { event: ActivityItem }) {
  const inner = (
    <>
      <span aria-hidden className="text-base">
        {KIND_ICON[event.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[rgb(var(--fg-primary))]">{event.message}</p>
        <p className="text-xs text-[rgb(var(--fg-muted))]">
          {formatRelative(event.occurredAt)}
        </p>
      </div>
    </>
  );

  if (event.deepLink) {
    return (
      <Link
        href={event.deepLink}
        className="flex items-center gap-3 py-3 transition-opacity hover:opacity-80"
      >
        {inner}
      </Link>
    );
  }
  return <div className="flex items-center gap-3 py-3">{inner}</div>;
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${String(mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${String(hrs)}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${String(days)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
