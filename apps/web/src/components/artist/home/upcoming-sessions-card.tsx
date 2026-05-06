export type UpcomingSession = {
  id: string;
  startsAt: Date;
  durationMin: number;
  producerName: string;
  packageName: string | null;
};

// Polished to match the locked design's "Upcoming sessions" small
// list — divided rows with date+time prominent and producer subdued.
export function UpcomingSessionsCard({
  sessions,
}: {
  sessions: UpcomingSession[];
}) {
  // Skip the first session — NextSessionCard already shows it.
  // Only render when there are 2+ sessions total.
  if (sessions.length <= 1) return null;
  const rest = sessions.slice(1);

  return (
    <section
      aria-labelledby="upcoming-sessions-heading"
      className="reveal-up rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="upcoming-sessions-heading"
        className="font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Upcoming sessions
      </h2>
      <ul className="mt-2 divide-y divide-[rgb(var(--border-subtle))]">
        {rest.map((s) => {
          const date = new Date(s.startsAt);
          return (
            <li
              key={s.id}
              className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1"
            >
              <div className="flex w-12 shrink-0 flex-col items-center">
                <span className="font-mono text-[0.6rem] font-bold uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="font-display text-[18px] font-extrabold leading-none text-[rgb(var(--fg-default))]">
                  {date.getDate()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold leading-tight text-[rgb(var(--fg-default))]">
                  {s.packageName ?? "Studio session"}
                </p>
                <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                  {s.producerName} ·{" "}
                  {date.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}{" "}
                  · {s.durationMin} min
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
