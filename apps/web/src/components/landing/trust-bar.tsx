// Trust bar — LIGHT world, sits directly under the hero. Small strip
// of placeholder label wordmarks rendered as text (no real logos). The
// disclaimer underneath is deliberate honesty — we don't want a visitor
// to think these are endorsements yet.
export function TrustBar() {
  return (
    <section
      aria-label="Early-user labels"
      className="relative border-y border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] py-6 sm:py-8"
    >
      <div className="mx-auto max-w-6xl px-6">
        <p className="text-center font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Producers working with labels and rooms like
        </p>
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:gap-x-12">
          {LABELS.map((l) => (
            <li
              key={l}
              className="font-display text-[0.95rem] font-semibold tracking-[0.18em] text-[rgb(var(--fg-muted))] opacity-70 transition-opacity hover:opacity-100 sm:text-base"
              style={{ letterSpacing: "0.22em" }}
            >
              {l}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-center font-mono text-[10px] text-[rgb(var(--fg-muted))]">
          Showcase of early-user labels — rollout soon
        </p>
      </div>
    </section>
  );
}

const LABELS = [
  "UNIVERSAL",
  "SONY",
  "STONES THROW",
  "GHOSTLY",
  "MAJESTIC CASUAL",
  "INGROOVES",
] as const;
