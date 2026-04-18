// Consolidation — DARK world. "Cancel the rest." Replaces the old
// 9-tool flat list with a clearer 7-bucket grid: every tool in the
// competing producer stack, grouped by what it does, each row showing
// the Skitza feature that eats it.
export function Consolidation() {
  return (
    <section
      data-theme="chrome-dark"
      id="consolidation"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            One tool. Full stop.
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Replace 7 tools with
            <span className="block italic text-[rgb(var(--brand-primary))]">one Skitza.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
            Most producers are paying for and context-switching between half a dozen
            SaaS. Skitza replaces the lot — one subscription, one login, one place
            where everything talks to everything.
          </p>
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {REPLACEMENTS.map((r) => (
            <article
              key={r.purpose}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
            >
              <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                {r.purpose}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.tools.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2.5 py-1 font-mono text-[10px] text-[rgb(var(--fg-muted))] line-through"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-start gap-2 border-t border-[rgb(var(--border-subtle))] pt-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--brand-primary))]"
                >
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
                  {r.skitza}
                </p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { num: "7+", label: "tools replaced" },
            { num: "1", label: "subscription" },
            { num: "$0", label: "extra apps to learn" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-6 py-8 text-center"
            >
              <p
                className="font-display text-5xl leading-none text-[rgb(var(--brand-primary))]"
                style={{ fontWeight: 800 }}
              >
                {s.num}
              </p>
              <p className="mt-2 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const REPLACEMENTS: readonly { purpose: string; tools: readonly string[]; skitza: string }[] = [
  {
    purpose: "Booking",
    tools: ["Calendly", "SavvyCal"],
    skitza: "Skitza booking with service kinds, buffers, blackouts",
  },
  {
    purpose: "Audio review",
    tools: ["Samply", "WeTransfer"],
    skitza: "Skitza audio library with waveform comments + version stacks",
  },
  {
    purpose: "Contracts",
    tools: ["DocuSign", "PandaDoc", "Documenso"],
    skitza: "Skitza contracts with PKCS#7 e-sign + PDF/A archive",
  },
  {
    purpose: "CRM & pipeline",
    tools: ["Notion", "Airtable"],
    skitza: "Skitza pipeline with client history and project stages",
  },
  {
    purpose: "Payments",
    tools: ["Stripe invoices", "PayPal"],
    skitza: "Skitza deposits + balances via Stripe Connect",
  },
  {
    purpose: "File delivery",
    tools: ["Google Drive", "Dropbox"],
    skitza: "Skitza signed-URL delivery, locked until paid",
  },
  {
    purpose: "Scheduling DMs",
    tools: ["WhatsApp", "Gmail drafts"],
    skitza: "Skitza magic links — one click, zero follow-up chains",
  },
];
