import Link from "next/link";

// Server component — pure render of the next-confirmed-session blob
// returned by `artist.home`. Polished to mirror the locked design's
// "date block + producer line + dark CTA" hierarchy. No interactivity
// at this level so we stay on the server and ship zero JS.
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
        className="reveal-up rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <h2
          id="next-session-heading"
          className="font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Next session
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Nothing booked yet. Pick a time that works for you.
        </p>
        <Link
          href="/artist/book"
          className="sk-press mt-4 inline-flex items-center gap-2 rounded-full bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--bg-sidebar))]"
        >
          Book a session
          <span aria-hidden style={{ opacity: 0.6 }}>
            →
          </span>
        </Link>
      </section>
    );
  }

  const monthShort = formatMonthShort(session.startsAt);
  const day = session.startsAt.getDate();
  const time = formatTime(session.startsAt);

  return (
    <section
      aria-labelledby="next-session-heading"
      className="reveal-up rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="next-session-heading"
        className="mb-3 font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
      >
        Next session
      </h2>

      <div className="flex items-start gap-4">
        {/* Big-date block — design system "date hero" */}
        <div className="w-14 shrink-0">
          <div
            className="font-mono text-[0.65rem] font-bold uppercase tracking-wider"
            style={{ color: "rgb(var(--brand-primary))" }}
          >
            {monthShort}
          </div>
          <div className="my-0.5 font-display text-[36px] font-extrabold leading-none tracking-[-0.04em] text-[rgb(var(--fg-default))]">
            {day}
          </div>
          <div className="font-mono text-[0.65rem] text-[rgb(var(--fg-muted))]">
            {time}
          </div>
        </div>

        {/* Title + producer line */}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-base font-bold leading-tight text-[rgb(var(--fg-default))]">
            {session.productName ?? "Studio session"}
          </p>
          <p className="mt-2 text-[13px] text-[rgb(var(--fg-muted))]">
            {session.producerName} · {formatDuration(session.durationMin)}
          </p>
        </div>
      </div>

      {/* Dark CTA — matches design system AmberCTA-like dark variant */}
      <Link
        href="/artist/book"
        className="sk-press mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] py-3 text-[13.5px] font-semibold"
        style={{
          background: "rgb(var(--bg-sidebar))",
          color: "rgb(var(--fg-onsidebar))",
        }}
      >
        View details
        <span aria-hidden style={{ opacity: 0.55 }}>
          →
        </span>
      </Link>
    </section>
  );
}

function formatMonthShort(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
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
  if (h === 0) return `${String(m)} min`;
  if (m === 0) return `${String(h)}h`;
  return `${String(h)}h ${String(m)}m`;
}
