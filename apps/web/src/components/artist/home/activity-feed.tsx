import Link from "next/link";

import type { ActivityItem } from "~/server/trpc/routers/artist";

// Server component — flat list of pre-formatted activity events.
// The router did all the per-row message-building work, so this just
// renders. When deepLink is null (e.g. session_confirmed has nowhere
// useful to go), the row renders as a non-interactive `<div>`.
//
// Polished to mirror the locked design's "small avatar square + text
// + timestamp" pattern, replacing emoji with a small kind-coloured
// dot so the list feels of-a-piece with the rest of the artist app
// (no other surface uses emoji glyphs).

const KIND_DOT: Record<ActivityItem["kind"], string> = {
  // brand-amber for new-music events
  track_uploaded: "rgb(var(--brand-primary))",
  // green for confirmed sessions
  session_confirmed: "rgb(var(--fg-success))",
  // copper for money-flow events
  invoice_paid: "rgb(var(--brand-copper))",
};

export function ActivityFeed({ events }: { events: ActivityItem[] }) {
  if (events.length === 0) {
    return (
      <section
        aria-labelledby="activity-heading"
        className="reveal-up rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <h2
          id="activity-heading"
          className="font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
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
    <section aria-labelledby="activity-heading" className="reveal-up">
      <h2
        id="activity-heading"
        className="mb-2 font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Activity
      </h2>
      <ul className="divide-y divide-[rgb(var(--border-subtle))]">
        {events.slice(0, 4).map((event, idx) => (
          <li
            key={`${event.kind}-${String(idx)}-${String(event.occurredAt.getTime())}`}
          >
            <ActivityRow event={event} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityRow({ event }: { event: ActivityItem }) {
  const inner = (
    <div className="flex items-start gap-3 py-3">
      <span
        aria-hidden
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: KIND_DOT[event.kind] }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-[rgb(var(--fg-default))]">
          {event.message}
        </p>
        <p className="mt-0.5 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
          {formatRelative(event.occurredAt)}
        </p>
      </div>
    </div>
  );

  if (event.deepLink) {
    return (
      <Link
        href={event.deepLink}
        className="block transition-colors hover:bg-[rgb(var(--bg-overlay))]"
      >
        {inner}
      </Link>
    );
  }
  return inner;
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
