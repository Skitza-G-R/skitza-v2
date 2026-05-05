import Link from "next/link";

import { ProducerAvatar } from "../producer-avatar";

// Next-session card — locked design system (Phase 5).
//
// Layout:
//   left  — 56px date block: month abbrev (amber, mono uppercase),
//           giant day number (Syne 800), time (mono).
//   right — product/title (Outfit 700) + producer row (avatar + name + duration).
//   bottom — full-width dark "View details" CTA pointing at /artist/book.
//
// Empty state preserves the Phase 2 dashed-card affordance with a dark
// CTA to /artist/book — same call-to-action grammar as the live state.

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
        className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5"
      >
        <p
          id="next-session-heading"
          className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Next session
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">
          Nothing booked yet. Pick a time that works for you.
        </p>
        <Link
          href="/artist/book"
          className="sk-press mt-4 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-4 py-2.5 text-sm font-semibold text-[rgb(var(--fg-inverse))]"
        >
          Book a session
          <span aria-hidden className="opacity-60">
            →
          </span>
        </Link>
      </section>
    );
  }

  const date = new Date(session.startsAt);
  const monthShort = date
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();
  const day = date.getDate();
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <section
      aria-labelledby="next-session-heading"
      className="sk-lift rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
    >
      <p
        id="next-session-heading"
        className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
      >
        Next session
      </p>

      <div className="mt-3 flex items-start gap-4">
        {/* Date block */}
        <div className="w-14 shrink-0">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--brand-primary))]">
            {monthShort}
          </p>
          <p className="mt-0.5 font-display text-[36px] font-extrabold leading-none tracking-tight">
            {day}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[rgb(var(--fg-muted))]">
            {time}
          </p>
        </div>

        {/* Title + producer */}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-base font-bold leading-snug text-[rgb(var(--fg-default))]">
            {session.productName ?? "Session"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <ProducerAvatar name={session.producerName} size={20} />
            <span className="text-[13px] text-[rgb(var(--fg-muted))]">
              {session.producerName} · {String(session.durationMin)} min
            </span>
          </div>
        </div>
      </div>

      <Link
        href="/artist/book"
        className="sk-press mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-4 py-3 text-sm font-semibold text-[rgb(var(--fg-inverse))]"
      >
        View details
        <span aria-hidden className="opacity-60">
          →
        </span>
      </Link>
    </section>
  );
}
