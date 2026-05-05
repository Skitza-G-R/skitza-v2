import Link from "next/link";

import { ProducerAvatar } from "../producer-avatar";

// Active projects — desktop-only column. Rich rows: 60px gradient
// avatar + project title + producer + track count + a Syne arrow.
// No per-project balance/progress bar in v1: the existing tRPC shape
// from `artist.music.projects` doesn't carry that data, and adding it
// is out-of-scope for Phase 5 (no tRPC changes per brief).

export type ActiveProjectRow = {
  projectId: string;
  title: string;
  producerName: string;
  latestTrackTitle: string | null;
  trackCount: number;
};

export function ActiveProjectsCard({ rows }: { rows: ActiveProjectRow[] }) {
  if (rows.length === 0) {
    return (
      <section aria-labelledby="active-projects-heading">
        <header className="mb-3 flex items-baseline justify-between">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
              In motion
            </p>
            <h2
              id="active-projects-heading"
              className="mt-0.5 font-display text-[22px] font-bold tracking-tight"
            >
              Active projects
            </h2>
          </div>
        </header>
        <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-4 py-6 text-sm text-[rgb(var(--fg-muted))]">
          No active projects yet. Booking a session creates one automatically.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="active-projects-heading">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            In motion
          </p>
          <h2
            id="active-projects-heading"
            className="mt-0.5 font-display text-[22px] font-bold tracking-tight"
          >
            Active projects
          </h2>
        </div>
        <Link
          href="/artist/music"
          className="sk-press text-xs text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
        >
          View all →
        </Link>
      </header>

      <ul className="flex flex-col gap-3">
        {rows.map((p) => (
          <li key={p.projectId}>
            <Link
              href={`/artist/music/${p.projectId}`}
              className="sk-lift grid grid-cols-[60px_1fr_auto] items-center gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
            >
              <ProducerAvatar
                name={p.producerName}
                size={60}
                className="text-lg"
              />
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold tracking-tight">
                  {p.title}
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[rgb(var(--fg-muted))]">
                  <span>{p.producerName}</span>
                  <span aria-hidden className="opacity-60">
                    ·
                  </span>
                  <span className="font-mono">
                    {String(p.trackCount)}{" "}
                    {p.trackCount === 1 ? "track" : "tracks"}
                  </span>
                </div>
                {p.latestTrackTitle ? (
                  <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
                    Latest:{" "}
                    <span className="text-[rgb(var(--fg-default))]">
                      {p.latestTrackTitle}
                    </span>
                  </p>
                ) : null}
              </div>
              <span aria-hidden className="text-[rgb(var(--fg-muted))]">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
