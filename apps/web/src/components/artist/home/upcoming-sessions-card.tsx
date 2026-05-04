export type UpcomingSession = {
  id: string;
  startsAt: Date;
  durationMin: number;
  producerName: string;
  packageName: string | null;
};

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
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="upcoming-sessions-heading"
        className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Upcoming sessions
      </h2>
      <ul className="mt-3 divide-y divide-[rgb(var(--border-subtle))]">
        {rest.map((s) => {
          const date = new Date(s.startsAt);
          return (
            <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
              <p className="text-sm text-[rgb(var(--fg-primary))]">
                {date.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
                {" · "}
                {date.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </p>
              <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
                with {s.producerName} · {s.durationMin} min
                {s.packageName ? ` · ${s.packageName}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
