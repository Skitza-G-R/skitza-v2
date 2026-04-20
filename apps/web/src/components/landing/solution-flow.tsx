// Solution section — DARK world. The canonical 6-step flow
// (Lead → Booking → Session → Invoice → Delivery → Follow-up).
// Matches index.html §3. Mobile: nodes scroll horizontally; desktop:
// full row visible.

export function SolutionFlow() {
  return (
    <section
      data-theme="chrome-dark"
      id="solution"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute right-[-10%] top-[50%] h-[28rem] w-[28rem] rounded-full blur-[120px]"
          style={{
            background: "rgba(212,150,10,0.08)",
            animation: "skitza-drift 25s ease-in-out infinite alternate",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <span
            aria-hidden
            className="block font-display text-[clamp(4rem,10vw,8rem)] leading-none opacity-[0.04]"
            style={{ fontWeight: 800 }}
          >
            02
          </span>
          <p className="mt-[-3rem] font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            Enter Skitza
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            One platform.
            <span className="block">Everything automated.</span>
            <span className="block">Nothing missed.</span>
          </h2>
          <p className="mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
            Skitza connects to your calendar, payments, and messaging — and runs your
            entire client workflow automatically.
          </p>
          <ul className="mt-6 space-y-2 text-[rgb(var(--fg-secondary))]">
            {[
              "Clients book themselves — you just show up",
              "Invoices sent and chased automatically",
              "Files delivered via signed links — no WhatsApp chains",
              "Follow-ups and reminders — done for you",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                />
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* Flow diagram — 6 nodes, horizontal pipeline with connectors.
            `sk-scroll-x` makes the narrow-viewport swipe feel native. */}
        <div className="sk-scroll-x mt-16 overflow-x-auto pb-4">
          <ol className="flex min-w-max items-center gap-3 sm:gap-5">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3 sm:gap-5">
                <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-2 text-sm font-medium text-[rgb(var(--fg-primary))]">
                  {s}
                  <span className="text-[rgb(var(--brand-primary))]">✓</span>
                </div>
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className="h-px w-8 bg-gradient-to-r from-[rgb(var(--brand-primary)/0.35)] to-[rgb(var(--brand-primary)/0.15)]"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const STEPS = ["Lead", "Booking", "Session", "Invoice", "Delivery", "Follow-up"] as const;
