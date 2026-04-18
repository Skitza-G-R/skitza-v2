// FAQ — DARK world. Uses `<details>`/`<summary>` so it's zero-JS and
// accessible by default. Each question is a specific, concrete fear a
// producer actually has when evaluating new software.
export function FAQ() {
  return (
    <section
      data-theme="chrome-dark"
      id="faq"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-3xl px-6">
        <p className="text-center font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Frequently asked
        </p>
        <h2
          className="mt-3 text-center font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
          style={{ fontWeight: 800 }}
        >
          Answers, not marketing.
        </h2>

        <div className="mt-12 divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          {QUESTIONS.map((q) => (
            <details key={q.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-left font-display text-lg tracking-tight text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--bg-sunken))] [&::-webkit-details-marker]:hidden">
                <span style={{ fontWeight: 600 }}>{q.q}</span>
                <span
                  aria-hidden
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-secondary))] transition-transform group-open:rotate-45"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <div className="px-6 pb-6 text-[rgb(var(--fg-secondary))]">
                <p className="leading-relaxed">{q.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const QUESTIONS: readonly { q: string; a: string }[] = [
  {
    q: "How does this compare to Samply?",
    a: "Samply is a brilliant audio-review tool — we ship the same waveform-comment core, but we also give you the pipeline, the booking flow, the contract with e-sign, the deposit, the invoice, and the client CRM all behind one URL. You don't stop sending Samply links; you stop sending Samply + Calendly + DocuSign + Stripe + a Notion.",
  },
  {
    q: "Do my clients need to make accounts?",
    a: "No. Every client touchpoint — review a mix, sign a contract, pay a deposit, book a slot — rides on a signed magic link. Your client opens it, does the thing, and that's the last screen they see. No password, no onboarding.",
  },
  {
    q: "Is my audio encrypted?",
    a: "Audio lives on Cloudflare R2 at rest and only renders via short-lived signed URLs. Stems are never public by default — even the download button is gated behind the contract status and, for paid gates, the invoice state.",
  },
  {
    q: "Can I cancel anytime? What about my data?",
    a: "Cancel any month, keep your URL for the rest of the cycle. Every piece of data you put in Skitza is exportable — clients, contracts, projects, audio, invoices — in plain JSON plus the original files. No lock-in, ever.",
  },
  {
    q: "Do you have an API?",
    a: "Yes — tRPC internally, and public webhooks for every major state transition (deal_signed, invoice_paid, file_delivered). The core is open-source; you can self-host if you want the whole thing on your own infra.",
  },
  {
    q: "Can I use my own domain?",
    a: "On the Studio tier you can point sessions.yourname.com at your Skitza workspace with SSL handled automatically. Pro tier runs on skitza.app/yourname, which is what most producers start with.",
  },
  {
    q: "Is this eIDAS-compliant for EU contracts?",
    a: "Every signature is PKCS#7-sealed with a full audit trail (IP, UA, timestamps, PDF/A output). We're on the advanced-electronic-signature side of eIDAS today; qualified-signature upgrade path via a trust-service partnership is on the roadmap for Studio tier.",
  },
  {
    q: "What does Skitza not do?",
    a: "We don't run the session itself — your DAW stays your DAW. We don't replace your accountant. We don't write the music. Everything before and after the bounce: we're your studio around the work.",
  },
];
