// Founder — DARK world. Personal note signed by the founder. Keep it
// short; the point is that a human built this, not a VC playbook.
// Only the GitHub link is shown — Twitter/Instagram placeholders were
// removed (audit-report.md Task 10) until real handles exist; a `href=
// "#"` link is a visible credibility hit on a cold visit.
export function Founder() {
  return (
    <section
      data-theme="chrome-dark"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-3xl px-6">
        <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-8 sm:p-12">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            Built in public
          </p>
          <h2
            className="mt-3 font-display text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.1] tracking-tight"
            style={{ fontWeight: 700 }}
          >
            I was tired of stitching
            <span className="block italic text-[rgb(var(--brand-primary))]">
              five apps together.
            </span>
          </h2>

          <div className="mt-6 space-y-4 text-lg leading-relaxed text-[rgb(var(--fg-secondary))]">
            <p>
              I've been producing for a decade. Every time a client booked a session,
              the same dance started: Calendly for the slot, DocuSign for the split
              sheet, Samply for the reviews, Stripe for the deposit, a Notion page
              holding it all loosely together. Five logins. Five places for something
              to go wrong.
            </p>
            <p>
              I built Skitza because I wanted one URL — one place — for the whole
              loop, from cold lead to final bounce. It's the tool I wished existed
              every Friday night when I was meant to be mixing and was instead
              resending a WAV for the third time.
            </p>
          </div>

          <div className="mt-8 flex items-center gap-4 border-t border-[rgb(var(--border-subtle))] pt-6">
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] font-display text-lg text-[#0C0A07]"
              style={{ fontWeight: 800 }}
            >
              GA
            </span>
            <div>
              <p className="font-display text-base tracking-tight" style={{ fontWeight: 700 }}>
                Gili, founder of Skitza
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[0.72rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                <a
                  href="https://github.com/giasraf/skitza-v2"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="transition-colors hover:text-[rgb(var(--brand-primary))]"
                >
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
