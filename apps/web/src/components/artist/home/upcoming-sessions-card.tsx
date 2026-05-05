import { ProducerAvatar } from "../producer-avatar";

// Upcoming sessions — locked design system (Phase 5).
//
// Mobile: list of date-pill rows (52px square w/ month + day) inside a
// single card. Skips the first session (NextSessionCard already owns
// it) so this only renders if there are 2+ sessions total.
//
// Desktop: same layout — looks at home in both columns of the grid.

export type UpcomingSession = {
  id: string;
  startsAt: Date;
  durationMin: number;
  producerName: string;
  packageName: string | null;
};

export function UpcomingSessionsCard({
  sessions,
  variant = "card",
}: {
  sessions: UpcomingSession[];
  /** "card" wraps in a card; "raw" omits the wrapper for desktop column reuse. */
  variant?: "card" | "raw";
}) {
  if (sessions.length <= 1) return null;
  const rest = sessions.slice(1);

  const list = (
    <ul className="flex flex-col gap-2.5">
      {rest.map((s) => {
        const d = new Date(s.startsAt);
        const monthShort = d
          .toLocaleDateString("en-US", { month: "short" })
          .toUpperCase();
        const time = d.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        return (
          <li
            key={s.id}
            className="sk-lift flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3"
          >
            <div className="flex h-13 w-13 flex-col items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))]">
              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
                {monthShort}
              </p>
              <p className="font-display text-[22px] font-extrabold leading-none tracking-tight">
                {d.getDate()}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
                {s.packageName ?? "Session"}
              </p>
              <div className="mt-1 flex items-center gap-2 text-xs text-[rgb(var(--fg-muted))]">
                <ProducerAvatar name={s.producerName} size={16} />
                <span>{s.producerName}</span>
                <span aria-hidden className="opacity-60">
                  ·
                </span>
                <span className="font-mono">{time}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (variant === "raw") {
    return (
      <section aria-labelledby="upcoming-sessions-heading">
        <p
          id="upcoming-sessions-heading"
          className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Upcoming
        </p>
        {list}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="upcoming-sessions-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <p
        id="upcoming-sessions-heading"
        className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
      >
        Upcoming sessions
      </p>
      <div className="mt-3">{list}</div>
    </section>
  );
}
