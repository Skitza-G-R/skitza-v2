// S11 — Empty state for "My sessions". A friendly one-liner + a SINGLE
// action: browse the store. Buying precedes booking in the Skitza flow (you
// pick a producer's package first, then book your slots against it), so the
// only forward door here points at the store, not the calendar.

import Link from "next/link";

import { withArtistStudio } from "~/lib/artist-studio-context";

import { CalendarIcon } from "./session-icons";

export function SessionsEmpty({ studioId }: { studioId: string | null }) {
  return (
    <div
      className="reveal-up flex flex-col items-center rounded-[var(--radius-xl)] px-6 py-10 text-center"
      style={{
        background: "rgb(var(--bg-elevated))",
        border: "1px solid rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <span
        className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-full text-[rgb(var(--brand-primary))]"
        style={{ background: "rgb(var(--brand-primary) / 0.10)" }}
      >
        <CalendarIcon width={24} height={24} />
      </span>
      <h2 className="font-syne text-[19px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
        No sessions yet
      </h2>
      <p className="mt-1.5 max-w-[260px] text-pretty text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        Pick a producer&apos;s package first — then you can book your studio
        time against it.
      </p>
      <Link
        href={withArtistStudio("/artist/store", studioId)}
        className="sk-press mt-5 inline-flex items-center justify-center rounded-[var(--radius-lg)] px-6 py-3 text-[15px] font-semibold"
        style={{
          background: "rgb(var(--brand-primary))",
          color: "rgb(var(--bg-sidebar))",
          boxShadow: "var(--shadow-glow)",
        }}
      >
        Browse the store
      </Link>
    </div>
  );
}
