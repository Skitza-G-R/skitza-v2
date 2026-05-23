import Link from "next/link";

import type { Studio } from "~/server/artist/identity";

// Server component — the "Book a session with..." block below the
// inbox list. One soft card per producer the artist has a
// relationship with. Clicking a card lands on /artist/book with the
// studio pre-selected.
//
// Layouts:
//   - n=1: full-width compact row (avatar + name + Book →)
//   - n≥2: flex-wrap row of stacked-vertical cards (avatar on top,
//          name + Book → below). Each card stays ≥160px wide so the
//          name doesn't truncate; the row wraps gracefully past 3.
//
// Avatar color is hashed from producerId against the kind-* palette
// already defined in globals.css — gives each studio a stable
// recognizable accent without a real logo upload step.

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
  // Narrow once so we never reach for studios[0] with the lint-banned
  // non-null assertion. An empty list bails entirely.
  const [first, ...rest] = studios;
  if (!first) return null;

  return (
    <section
      aria-labelledby="book-with-heading"
      className="reveal-up-delay-3"
    >
      <h2
        id="book-with-heading"
        className="px-1 text-[13px] font-medium text-[rgb(var(--fg-muted))]"
      >
        Book a session
      </h2>

      {rest.length === 0 ? (
        <SoloRow studio={first} />
      ) : (
        <div className="mt-2 flex flex-wrap gap-3">
          {studios.map((s) => (
            <StackedCard key={s.producerId} studio={s} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Card variants ──────────────────────────────────────────────────

function SoloRow({ studio }: { studio: Studio }) {
  const color = hashColor(studio.producerId);
  return (
    <Link
      href={`/artist/book?studio=${studio.producerId}`}
      className="sk-press mt-2 flex items-center gap-4 rounded-[var(--radius-xl)] bg-[rgb(var(--bg-elevated))] p-4 transition-colors hover:bg-[rgb(var(--bg-overlay))]"
      style={{
        boxShadow: "0 1px 0 rgb(17 16 9 / 0.03)",
        border: "1px solid rgb(var(--border-subtle))",
      }}
    >
      <Avatar
        name={studio.name}
        color={color}
        logoUrl={studio.logoUrl}
        size={48}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[rgb(var(--fg-default))]">
          {studio.name}
        </p>
        <p className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
          Tap to book a session
        </p>
      </div>
      <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        Book →
      </span>
    </Link>
  );
}

function StackedCard({ studio }: { studio: Studio }) {
  const color = hashColor(studio.producerId);
  return (
    <Link
      href={`/artist/book?studio=${studio.producerId}`}
      className="sk-press flex min-w-[160px] flex-1 flex-col items-center gap-3 rounded-[var(--radius-xl)] bg-[rgb(var(--bg-elevated))] p-5 text-center transition-colors hover:bg-[rgb(var(--bg-overlay))]"
      style={{
        boxShadow: "0 1px 0 rgb(17 16 9 / 0.03)",
        border: "1px solid rgb(var(--border-subtle))",
      }}
    >
      <Avatar
        name={studio.name}
        color={color}
        logoUrl={studio.logoUrl}
        size={56}
      />
      <p className="line-clamp-1 text-[14px] font-semibold text-[rgb(var(--fg-default))]">
        {studio.name}
      </p>
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        Book →
      </span>
    </Link>
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
        {/* Using <img> over next/image because logoUrl is sometimes a
            data URL or a non-allowlisted remote host; next/image is
            stricter here. Decorative — the parent Link carries the
            label. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-mono font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initial(name)}
    </span>
  );
}
