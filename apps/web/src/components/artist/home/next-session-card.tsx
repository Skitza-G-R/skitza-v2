import Link from "next/link";

// Server component — pure render of the next-confirmed-session blob
// returned by `artist.home`. No interactivity, so this stays on the
// server and ships zero JS for the empty state.
//
// Empty state: gentle CTA pointing at /artist/book. The whole point
// of Home is "what's next" — when there's nothing, we suggest booking.

export type NextSession = {
  id: string;
  startsAt: Date;
  durationMin: number;
  producerName: string;
  producerSlug: string;
  productName: string | null;
};

export function NextSessionCard({ session }: { session: NextSession | null }) {
  if (!session) {
    return (
      <section
        aria-labelledby="next-session-heading"
        className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <h2
          id="next-session-heading"
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Next session
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Nothing booked yet. Pick a time that works for you.
        </p>
        <Link
          href="/artist/book"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--bg-base))] transition-opacity hover:opacity-90"
        >
          Book a session
        </Link>
      </section>
    );
  }

  const date = formatDate(session.startsAt);
  const time = formatTime(session.startsAt);
  const duration = formatDuration(session.durationMin);

  return (
    <section
      aria-labelledby="next-session-heading"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="next-session-heading"
        className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Next session
      </h2>
      <div className="mt-2 flex flex-col gap-1">
        <p className="font-display text-lg text-[rgb(var(--fg-primary))]">
          {date} · {time}
        </p>
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
          with {session.producerName} · {duration}
          {session.productName ? ` · ${session.productName}` : ""}
        </p>
      </div>
      <div className="mt-4 flex gap-3 text-sm">
        <a
          href={`https://waze.com/ul?q=${encodeURIComponent(session.producerName)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))]"
        >
          Open in Waze →
        </a>
      </div>
    </section>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)}min session`;
  if (m === 0) return `${String(h)}h session`;
  return `${String(h)}h ${String(m)}m session`;
}
