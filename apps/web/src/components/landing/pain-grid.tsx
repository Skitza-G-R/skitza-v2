// Pain section — DARK world opens here (first scroll past the hero).
// Matches index.html §2. 6 cards. Simplified for tonight: headline +
// subhead + copper accent bar. The elaborate meme-face illustrations
// stay a Phase B polish target.

export function PainGrid() {
  return (
    <section
      data-theme="chrome-dark"
      id="pain"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute left-[-15%] top-[10%] h-[28rem] w-[28rem] rounded-full blur-[120px]"
          style={{ background: "rgba(176,104,48,0.08)" }}
        />
      </div>
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <span
            aria-hidden
            className="block font-display text-[clamp(4rem,10vw,8rem)] leading-none opacity-[0.04]"
            style={{ fontWeight: 800 }}
          >
            01
          </span>
          <p className="mt-[-3rem] font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-accent))]">
            Sound familiar?
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            You became a producer.
            <span className="block">Not a secretary.</span>
          </h2>
          <p className="mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
            Yet here you are — scheduling, invoicing, chasing, reminding, resending,
            following up. Every day. Before you&apos;ve played a single note.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAINS.map((p, i) => (
            <article
              key={p.title}
              className={`rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 reveal-up-delay-${String(Math.min(i + 1, 4))}`}
            >
              <span
                aria-hidden
                className="mb-4 block h-[2px] w-10 rounded-full bg-gradient-to-r from-[rgb(var(--brand-accent))] to-[rgb(var(--brand-primary))]"
              />
              <h3
                className="font-display text-xl tracking-tight text-[rgb(var(--fg-primary))]"
                style={{ fontWeight: 700 }}
              >
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                {p.body}
              </p>
            </article>
          ))}
        </div>

        <p
          className="mt-14 text-center font-display text-xl leading-tight tracking-tight text-[rgb(var(--brand-primary))]"
          style={{ fontWeight: 700 }}
        >
          Skitza kills every one of these. Keep reading. ↓
        </p>
      </div>
    </section>
  );
}

const PAINS = [
  {
    title: `"What are your rates?"`,
    body: `You've copy-pasted that answer so many times you could send it in your sleep.`,
  },
  {
    title: `The scheduling nightmare`,
    body: `6 messages to confirm one session. "Does Tuesday work? Actually Thursday?"`,
  },
  {
    title: `Unpaid invoices stacking up`,
    body: `Chasing clients for money is the worst part of the job. Somehow it's also your job.`,
  },
  {
    title: `"Can you resend the files?"`,
    body: `For the third time. On WhatsApp. At midnight.`,
  },
  {
    title: `Doing it all again tomorrow`,
    body: `Wake up. Answer DMs. Make a beat. Chase payment. Repeat until you hate this.`,
  },
  {
    title: `Mental bandwidth, gone`,
    body: `By the time you open your DAW, you're already running on empty.`,
  },
] as const;
