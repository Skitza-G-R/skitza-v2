// Meta strip — 4 stats sitting right under the hero.
//
// Per design context 2026 §Public producer page: a thin band with
// Genres / Released / Streams / Response time. Each stat has a tiny
// uppercase mono label + a 13.5px medium-weight value. Border-top +
// border-bottom keep it visually separate from the hero above and the
// work section below.
//
// Real-data wiring (this iteration): the four stats are now driven by
// curated freeform fields the producer fills in via Settings → Profile
// (migration 0006 — genres text[], released_summary, streams_summary,
// response_hours). They are MARKETING-grade — not computed from real
// bookings/streams data. Phase H owns the live-analytics work.
//
// Hide-when-null: per the rules, a single empty stat block reads worse
// than a missing one. If a producer hasn't filled in (say) "streams",
// we drop that whole `<div>` rather than rendering a placeholder. The
// strip still uses a balanced 2/4-col grid; the remaining stats grow
// to fill it.
//
// Server component — no state.

import type { JoinMeta } from "./join-meta-types";

interface JoinMetaStripProps {
  /** Server-provided meta payload — every field can be null. */
  meta?: JoinMeta | null;
}

const ITEMS: Array<{
  key: "genres" | "released" | "streams" | "response";
  label: string;
}> = [
  { key: "genres", label: "Genres" },
  { key: "released", label: "Released" },
  { key: "streams", label: "Streams" },
  { key: "response", label: "Response" },
];

/**
 * Format a producer-supplied genres array into the "Indie · Alt-Pop"
 * dot-separated style the design uses. We title-case each entry so a
 * producer can save lowercase tags ("indie", "alt-pop") and still get
 * presentation-grade casing on the public page. Empty array returns
 * null — the caller hides the stat.
 */
export function formatGenres(genres: string[] | null | undefined): string | null {
  if (!genres || genres.length === 0) return null;
  const cleaned = genres
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .map((g) =>
      g
        .split(/[\s-]+/)
        .map((part) => {
          const head = part.charAt(0);
          if (head.length === 0) return part;
          return `${head.toUpperCase()}${part.slice(1).toLowerCase()}`;
        })
        .join("-"),
    );
  if (cleaned.length === 0) return null;
  return cleaned.join(" · ");
}

/**
 * Translate hours-of-response into the dropdown phrasing the producer
 * picked in Settings. 24/48/168 are the only valid values; anything
 * outside that range renders as "Within Nh" so a future row from a
 * direct DB edit doesn't crash the page.
 */
export function formatResponseHours(
  hours: number | null | undefined,
): string | null {
  if (hours === null || hours === undefined) return null;
  if (hours <= 0) return null;
  if (hours === 24) return "Within 24h";
  if (hours === 48) return "Within 48h";
  if (hours === 168) return "Within 1 week";
  // Fallback for unexpected raw values — keeps the strip from blanking
  // out if the producer schema picks up new presets later.
  return `Within ${String(hours)}h`;
}

export function JoinMetaStrip({ meta }: JoinMetaStripProps) {
  // Map each stat to its rendered string OR null. Null drops the row.
  const valueByKey: Record<typeof ITEMS[number]["key"], string | null> = {
    genres: formatGenres(meta?.genres ?? null),
    released: meta?.releasedSummary?.trim() || null,
    streams: meta?.streamsSummary?.trim() || null,
    response: formatResponseHours(meta?.responseHours ?? null),
  };

  // Filter to the keys that survived. If every stat is empty, the whole
  // band collapses (parent decides whether to render this section at
  // all — but we still guard here so the borders don't draw an empty
  // strip).
  const visible = ITEMS.filter((item) => valueByKey[item.key] !== null);
  if (visible.length === 0) return null;

  return (
    <section
      aria-label="At a glance"
      className="mx-auto mt-6 max-w-6xl px-6 sm:px-10"
    >
      <dl
        className={[
          "grid gap-x-6 gap-y-5 border-y border-[rgb(var(--border-subtle))] py-6 sm:gap-x-8",
          // Column count adapts to how many stats survived the filter
          // so the strip stays balanced when 1 or 2 fields are missing.
          visible.length === 1
            ? "grid-cols-1"
            : visible.length === 2
              ? "grid-cols-2"
              : visible.length === 3
                ? "grid-cols-1 sm:grid-cols-3"
                : "grid-cols-2 sm:grid-cols-4",
        ].join(" ")}
      >
        {visible.map((item) => (
          <div key={item.key}>
            <dt className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              {item.label}
            </dt>
            <dd className="mt-1.5 text-[0.84rem] font-semibold text-[rgb(var(--fg-primary))]">
              {valueByKey[item.key]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
