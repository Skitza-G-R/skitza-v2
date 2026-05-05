import Link from "next/link";

import type { ActivityItem } from "~/server/trpc/routers/artist";

// Activity feed — locked design system (Phase 5).
//
// Mobile: minimal list, no card chrome — section eyebrow above a
// hairline-divided stack of avatar + text + relative-time rows.
// Desktop: same layout but inside a card so the right column reads
// as a discrete unit (variant="card").

const KIND_ICON: Record<ActivityItem["kind"], string> = {
  track_uploaded: "🎵",
  session_confirmed: "✅",
  invoice_paid: "💸",
};

export function ActivityFeed({
  events,
  limit = 4,
  variant = "raw",
}: {
  events: ActivityItem[];
  limit?: number;
  variant?: "raw" | "card";
}) {
  if (events.length === 0) {
    if (variant === "card") return null;
    return (
      <section aria-labelledby="activity-heading">
        <p
          id="activity-heading"
          className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Activity
        </p>
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          Quiet for now. New mixes, sessions, and payments will land here.
        </p>
      </section>
    );
  }

  const items = events.slice(0, limit);

  const list = (
    <ul className="flex flex-col">
      {items.map((event, idx) => (
        <li
          key={`${event.kind}-${String(idx)}-${String(event.occurredAt.getTime())}`}
          className={
            idx === items.length - 1
              ? ""
              : "border-b border-[rgb(var(--border-subtle))]"
          }
        >
          <ActivityRow event={event} />
        </li>
      ))}
    </ul>
  );

  if (variant === "card") {
    return (
      <section
        aria-labelledby="activity-heading"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
      >
        <p
          id="activity-heading"
          className="px-4 pb-2 pt-4 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Activity
        </p>
        {list}
      </section>
    );
  }

  return (
    <section aria-labelledby="activity-heading">
      <p
        id="activity-heading"
        className="mb-2 px-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
      >
        Activity
      </p>
      {list}
    </section>
  );
}

function ActivityRow({ event }: { event: ActivityItem }) {
  const inner = (
    <>
      <span aria-hidden className="shrink-0 text-base">
        {KIND_ICON[event.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-[rgb(var(--fg-default))]">
          {event.message}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-[rgb(var(--fg-muted))]">
          {formatRelative(event.occurredAt)}
        </p>
      </div>
    </>
  );

  if (event.deepLink) {
    return (
      <Link
        href={event.deepLink}
        className="sk-row flex items-start gap-3 px-3 py-2.5"
      >
        {inner}
      </Link>
    );
  }
  return <div className="flex items-start gap-3 px-3 py-2.5">{inner}</div>;
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
