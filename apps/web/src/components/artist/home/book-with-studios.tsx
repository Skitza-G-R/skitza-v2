import Link from "next/link";

import type { Studio } from "~/server/artist/identity";

// Server component — "Book a session" tile row at the bottom of the
// artist home.
//
//   - One tile per producer the artist has a relationship with.
//   - Avatar circle (colored, with the initial) on top, producer name
//     below, and a quiet "Book →" hint below that so the row reads as
//     an action — not as a passive list of "people you know".
//   - Clicking / tapping a tile opens /artist/book?studio=<id>.
//
// What was here before:
//   - Drag-to-reorder (HTML5 DnD) with localStorage persistence under
//     `skitza:artist:studio-order`.
//
// Why it's gone:
//   - No visible affordance (no grip handle, no cursor change), so
//     the interaction was undiscoverable.
//   - No keyboard alternative — a hard accessibility gap.
//   - Most artists have 1–3 studios; manual ordering wasn't paying
//     for its complexity.
//
// If artist reorder ever becomes a real need, do it on the server
// (persists across devices) with a visible drag handle on each tile.

const KIND_PALETTE = [
  "rgb(var(--kind-mix))",
  "rgb(var(--kind-master))",
  "rgb(var(--kind-tracking))",
  "rgb(var(--kind-intro))",
  "rgb(var(--kind-songwriting))",
  "rgb(var(--kind-meeting))",
] as const;

function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return KIND_PALETTE[hash % KIND_PALETTE.length] ?? KIND_PALETTE[0];
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

export function BookWithStudios({ studios }: { studios: Studio[] }) {
  if (studios.length === 0) return null;

  return (
    <section
      aria-labelledby="book-with-heading"
      className="reveal-up-delay-3"
    >
      {/* Section marker — matches the AlsoWaitingList architecture:
          numbered mono eyebrow + Syne display subhead + rule line.
          Gives the section a clear visual identity instead of the
          previous timid 13px label. */}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          <span style={{ color: "rgb(var(--brand-primary))" }}>02</span>
          <span className="mx-2 text-[rgb(var(--fg-faint))]">/</span>
          Studios
        </p>
      </div>
      <h2
        id="book-with-heading"
        className="mt-1.5 px-1 font-display text-[20px] font-bold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]"
      >
        Book a session
      </h2>
      <div
        aria-hidden
        className="mt-2 h-px"
        style={{ background: "rgb(var(--border-strong))" }}
      />

      {/* Sunken anchor — a single warm-tinted strip groups the tiles
          so a lone avatar doesn't float in beige void. NOT an
          elevated card (no shadow), NOT a per-tile container — just
          one quiet surface that holds the whole row. */}
      <div
        className="mt-4 rounded-[var(--radius-2xl)] px-5 py-5"
        style={{ background: "rgb(var(--bg-sunken))" }}
      >
        <div className="flex flex-wrap items-start gap-5">
          {studios.map((s) => {
            const color = hashColor(s.producerId);
            return (
              <Link
                key={s.producerId}
                href={`/artist/book?studio=${s.producerId}`}
                aria-label={`Book a session with ${s.name}`}
                className="sk-press flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                <Avatar
                  name={s.name}
                  color={color}
                  logoUrl={s.logoUrl}
                  size={56}
                />
                <span className="line-clamp-1 max-w-[80px] text-center text-[12px] font-medium text-[rgb(var(--fg-default))]">
                  {s.name}
                </span>
                <span
                  aria-hidden
                  className="text-[11px] font-medium text-[rgb(var(--fg-muted))]"
                >
                  Book →
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Avatar ─────────────────────────────────────────────────────────

function Avatar({
  name,
  color,
  logoUrl,
  size,
}: {
  name: string;
  color: string;
  logoUrl: string | null;
  size: number;
}) {
  if (logoUrl) {
    return (
      <span
        aria-hidden
        className="shrink-0 overflow-hidden rounded-full ring-1 ring-[rgb(var(--border-subtle))]"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 select-none items-center justify-center rounded-full font-mono font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initial(name)}
    </span>
  );
}
