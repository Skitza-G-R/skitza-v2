// Testimonials — DARK world. 3 placeholder quotes (real quotes come
// once there's a real beta cohort). Matches index.html §7.

export function Testimonials() {
  return (
    <section
      data-theme="chrome-dark"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <span
            aria-hidden
            className="block font-display text-[clamp(4rem,10vw,8rem)] leading-none opacity-[0.04]"
            style={{ fontWeight: 800 }}
          >
            05
          </span>
          <p className="mt-[-3rem] font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            Producers who got their time back
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Real results.
            <span className="block">No fluff.</span>
          </h2>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {QUOTES.map((q) => (
            <figure
              key={q.author}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
            >
              <blockquote className="text-[rgb(var(--fg-primary))]">
                &ldquo;{q.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-4 font-mono text-[0.72rem] uppercase tracking-widest text-[rgb(var(--fg-muted))]">
                — {q.author}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

const QUOTES = [
  {
    quote: "I used to spend 2 hours a day just managing bookings and chasing invoices. Now I check Skitza once a week.",
    author: "Jordan M., Mixing Engineer",
  },
  {
    quote: "My clients think I have a whole team behind me. It's just me and Skitza.",
    author: "Davi R., Music Producer",
  },
  {
    quote: "First month in, I recovered 3 unpaid invoices I'd completely forgotten about.",
    author: "Kai T., Beatmaker",
  },
] as const;
