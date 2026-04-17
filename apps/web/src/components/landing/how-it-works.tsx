// How It Works — DARK world. 3 setup steps. Matches index.html §6.

export function HowItWorks() {
  return (
    <section
      data-theme="chrome-dark"
      id="how-it-works"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <span
            aria-hidden
            className="block font-display text-[clamp(4rem,10vw,8rem)] leading-none opacity-[0.04]"
            style={{ fontWeight: 800 }}
          >
            04
          </span>
          <p className="mt-[-3rem] font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            Setup
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Set it up once.
            <span className="block">Let it run forever.</span>
          </h2>
        </div>

        <ol className="mt-14 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li
              key={s.num}
              className="relative rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
            >
              <span
                aria-hidden
                className="block font-display text-sm text-[rgb(var(--brand-primary))]"
                style={{ fontWeight: 700, letterSpacing: "0.1em" }}
              >
                {s.num}
              </span>
              <h3
                className="mt-3 font-display text-xl tracking-tight"
                style={{ fontWeight: 700 }}
              >
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const STEPS = [
  {
    num: "01",
    title: "Connect your studio",
    body: "Link your calendar, WhatsApp, payment method, and file storage in under 10 minutes.",
  },
  {
    num: "02",
    title: "Set your rules",
    body: "Your rates, your availability, your workflow. Skitza learns how you work and automates it exactly.",
  },
  {
    num: "03",
    title: "Focus on music",
    body: "New session? Handled. Payment due? Handled. File delivered? Handled. You just open your DAW.",
  },
] as const;
