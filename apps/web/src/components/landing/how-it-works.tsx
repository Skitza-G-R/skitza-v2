// How It Works — DARK world. 3 onboarding steps that mirror the actual
// onboarding wizard: pick your URL, share it, run the work. Each step
// is concrete, not aspirational.
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
            Onboarding
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Up and running
            <span className="block italic text-[rgb(var(--brand-primary))]">
              in ten minutes.
            </span>
          </h2>
          <p className="mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
            The onboarding wizard walks you through the whole thing — your URL, your
            services, your contract template, your first lead. No empty-state maze.
          </p>
        </div>

        <ol className="mt-14 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li
              key={s.num}
              className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
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
              <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                {s.hint}
              </p>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-center font-mono text-xs text-[rgb(var(--fg-muted))]">
          Set your link → Share → Book, sign, work, get paid
        </p>
      </div>
    </section>
  );
}

const STEPS = [
  {
    num: "01",
    title: "Set your link",
    body: "Pick your URL (skitza.app/you), upload a portfolio track or two, write your services. The wizard handles the rest — including a default contract you can edit.",
    hint: "≈ 5 minutes",
  },
  {
    num: "02",
    title: "Share it",
    body: "Paste it in your bio, your DMs, your email signature. When a lead clicks, Skitza tracks the open, the dwell, the device — so you know who's warm.",
    hint: "1 URL · 0 extra apps",
  },
  {
    num: "03",
    title: "Book, sign, work, get paid",
    body: "Clients pick a slot, sign the contract, pay the deposit. You do the session. Final stems stay locked until the balance clears. The dashboard tracks every step.",
    hint: "You stay in the room",
  },
] as const;
