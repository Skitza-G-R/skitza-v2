// Meta strip — 4 stats sitting right under the hero.
//
// Per design context 2026 §Public producer page: a thin band with
// Genres / Released / Streams / Response time. Each stat has a tiny
// uppercase mono label + a 13.5px medium-weight value. Border-top +
// border-bottom keep it visually separate from the hero above and the
// work section below.
//
// Wave 1 reality: producers don't have these stats stored yet (no
// `genres` / `release_count` / `total_streams` columns on producers).
// We show static defaults that read as confidence cues — once the
// onboarding wizard captures these explicitly we can promote them to
// real props. Defaults are deliberately generic, not fake numbers; the
// strip exists to set tone, not to lie about output.
//
// Server component — no state.

interface JoinMetaStripProps {
  /** Optional override per-stat. Each falls back to the static default. */
  genres?: string | null;
  released?: string | null;
  streams?: string | null;
  responseTime?: string | null;
}

const DEFAULT_GENRES = "Indie · Alt-Pop · Electronic";
const DEFAULT_RELEASED = "Multiple records";
const DEFAULT_STREAMS = "On Spotify, Apple, YouTube";
const DEFAULT_RESPONSE = "Within 24h";

const ITEMS: Array<{
  key: "genres" | "released" | "streams" | "response";
  label: string;
}> = [
  { key: "genres", label: "Genres" },
  { key: "released", label: "Released" },
  { key: "streams", label: "Streams" },
  { key: "response", label: "Response" },
];

export function JoinMetaStrip({
  genres,
  released,
  streams,
  responseTime,
}: JoinMetaStripProps) {
  const valueByKey: Record<typeof ITEMS[number]["key"], string> = {
    genres: genres ?? DEFAULT_GENRES,
    released: released ?? DEFAULT_RELEASED,
    streams: streams ?? DEFAULT_STREAMS,
    response: responseTime ?? DEFAULT_RESPONSE,
  };

  return (
    <section
      aria-label="At a glance"
      className="mx-auto mt-6 max-w-6xl px-6 sm:px-10"
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-[rgb(var(--border-subtle))] py-6 sm:grid-cols-4 sm:gap-x-8">
        {ITEMS.map((item) => (
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
