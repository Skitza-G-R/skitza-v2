import Link from "next/link";

import type { ActivityItem } from "~/server/trpc/routers/artist";

// Server component — section 03 / ACTIVITY · Recent.
//
// Sits at the bottom of /artist as the page's "tail." Renders the
// most-recent cross-studio events (track uploads, session
// confirmations, payments) the artist.home router already returns.
// Caps at 5 here — the home is a digest, not the full activity
// feed. The /artist/activity route doesn't exist yet; the "See all"
// link is suppressed until it does.

const MAX_ROWS = 5;

export type ActivityDisplayRow =
  | { kind: "event"; item: ActivityItem }
  | { kind: "empty" };

// Pure helper — owns the "cap + empty-state" decision so the
// component is dumb and behavior is testable in node (no jsdom).
export function getActivityRows(items: ActivityItem[]): ActivityDisplayRow[] {
  if (items.length === 0) return [{ kind: "empty" }];
  return items.slice(0, MAX_ROWS).map((item) => ({ kind: "event", item }));
}

export function ActivityTail({ items }: { items: ActivityItem[] }) {
  const rows = getActivityRows(items);

  return (
    <section
      aria-labelledby="activity-tail-heading"
      className="reveal-up-delay-3"
    >
      {/* Same SectionMarker pattern as AlsoWaitingList / BookWithStudios. */}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          <span style={{ color: "rgb(var(--brand-primary))" }}>03</span>
          <span className="mx-2 text-[rgb(var(--fg-faint))]">/</span>
          Activity
        </p>
      </div>
      <h2
        id="activity-tail-heading"
        className="mt-1.5 px-1 font-display text-[20px] font-bold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]"
      >
        Recent
      </h2>
      <div
        aria-hidden
        className="mt-2 h-px"
        style={{ background: "rgb(var(--border-strong))" }}
      />

      <div className="-mx-3 mt-3">
        {rows.map((row, idx) => (
          <div key={getKey(row, idx)}>
            {idx > 0 ? (
              <div
                aria-hidden
                className="mx-3 h-px"
                style={{ background: "rgb(var(--border-subtle))" }}
              />
            ) : null}
            <ActivityRow row={row} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Row ────────────────────────────────────────────────────────────

function ActivityRow({ row }: { row: ActivityDisplayRow }) {
  if (row.kind === "empty") {
    return (
      <div className="flex items-center gap-4 rounded-[12px] px-3 py-4">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "rgb(var(--fg-faint))" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-[rgb(var(--fg-default))]">
            Quiet so far
          </p>
          <p className="mt-0.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
            Your activity will appear here as it happens.
          </p>
        </div>
      </div>
    );
  }

  const { item } = row;
  const stamp = formatRelative(item.occurredAt);

  const content = (
    <>
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: dotColor(item.kind) }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] text-[rgb(var(--fg-default))]">
          {item.message}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[rgb(var(--fg-muted))]">
        {stamp}
      </span>
    </>
  );

  if (item.deepLink) {
    return (
      <Link
        href={item.deepLink}
        className="sk-press flex items-center gap-4 rounded-[12px] px-3 py-4 transition-colors hover:bg-[rgb(var(--bg-elevated))]"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-[12px] px-3 py-4">
      {content}
    </div>
  );
}

function dotColor(kind: ActivityItem["kind"]): string {
  switch (kind) {
    case "invoice_paid":
      return "rgb(var(--brand-primary))";
    case "track_uploaded":
    case "session_confirmed":
      return "rgb(var(--fg-faint))";
  }
}

function getKey(row: ActivityDisplayRow, idx: number): string {
  if (row.kind === "empty") return "empty";
  return `${row.item.kind}-${String(row.item.occurredAt.getTime())}-${String(idx)}`;
}

// ─── Relative time ──────────────────────────────────────────────────

// Compact relative-time formatter ("2h", "yesterday", "3d", "May 18").
// Avoids the heavyweight Intl.RelativeTimeFormat for what should be a
// glanceable timestamp.
function formatRelative(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) {
    const mins = Math.max(1, Math.floor(diffMs / minute));
    return `${String(mins)}m`;
  }
  if (diffMs < day) {
    const hrs = Math.floor(diffMs / hour);
    return `${String(hrs)}h`;
  }
  if (diffMs < 2 * day) return "yesterday";
  if (diffMs < 7 * day) {
    const days = Math.floor(diffMs / day);
    return `${String(days)}d`;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
