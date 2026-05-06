import Link from "next/link";

import type { ActivityItem } from "~/server/trpc/routers/artist";

// Recent uploads — desktop-only column. Distills the activity feed to
// just `track_uploaded` events, rendered as a tighter list with a
// circular dark play button + title + producer + time. The play
// button here is a navigation affordance (deep-links into the project
// room); real playback only happens once you're inside the song page.
// No <audio> mounted from the home — the persistent mini-player is
// the only allowed audio host on the artist surface.

export function RecentUploadsCard({
  events,
  limit = 4,
}: {
  events: ActivityItem[];
  limit?: number;
}) {
  const uploads = events
    .filter((e) => e.kind === "track_uploaded")
    .slice(0, limit);

  if (uploads.length === 0) return null;

  return (
    <section aria-labelledby="recent-uploads-heading">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Drops · last 7 days
          </p>
          <h2
            id="recent-uploads-heading"
            className="mt-0.5 font-display text-[22px] font-bold tracking-tight"
          >
            Recent uploads
          </h2>
        </div>
        <Link
          href="/artist/music"
          className="sk-press text-xs text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
        >
          Open library →
        </Link>
      </header>

      <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
        {uploads.map((u, i) => (
          <li
            key={`${String(i)}-${String(u.occurredAt.getTime())}`}
            className={
              i === uploads.length - 1
                ? ""
                : "border-b border-[rgb(var(--border-subtle))]"
            }
          >
            {u.deepLink ? (
              <Link
                href={u.deepLink}
                className="sk-row grid grid-cols-[36px_1fr_auto] items-center gap-3 px-4 py-3"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))]"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                  {u.message}
                </p>
                <span className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                  {formatRelative(u.occurredAt)}
                </span>
              </Link>
            ) : (
              <div className="grid grid-cols-[36px_1fr_auto] items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))]"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                  {u.message}
                </p>
                <span className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                  {formatRelative(u.occurredAt)}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
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
