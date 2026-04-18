// Security — DARK world. Three pillars, inline SVG icons, no external
// logos or badges we haven't earned. Reads as a confident paragraph, not
// a compliance brochure.
export function Security() {
  return (
    <section
      data-theme="chrome-dark"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            Security & trust
          </p>
          <h2
            className="mt-3 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Your masters,
            <span className="block italic text-[rgb(var(--brand-primary))]">
              actually safe.
            </span>
          </h2>
          <p className="mt-5 text-[rgb(var(--fg-secondary))]">
            Audio and contracts move across the internet every day. Here's what
            happens to yours.
          </p>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {PILLARS.map((p) => (
            <article
              key={p.title}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
            >
              <span
                aria-hidden
                className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
              >
                {p.icon}
              </span>
              <h3
                className="mt-5 font-display text-xl tracking-tight"
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

        <p className="mt-10 text-center font-mono text-[11px] text-[rgb(var(--fg-muted))]">
          Hosted on Vercel + Cloudflare R2 · auth via Clerk · all traffic TLS 1.3
        </p>
      </div>
    </section>
  );
}

const PILLARS: readonly { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: "Audio storage",
    body: "Cloudflare R2 at rest with AES-256. Every playback and download uses a short-lived signed URL scoped to the client — your stems are never publicly listable.",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Contracts & signatures",
    body: "PDF/A output for long-term archiving, PKCS#7 digital sealing, and a full audit trail (IP, user-agent, timestamps, geolocation) attached to every signed agreement. Exportable on demand.",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6M9 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Access & identity",
    body: "Clerk-backed auth with SOC-2-aligned controls, MFA supported on every account, and session revocation from any device. Client access always rides on single-use magic links — no standing credentials.",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 018 0v3" />
        <circle cx="12" cy="15.5" r="1.2" fill="currentColor" />
      </svg>
    ),
  },
];
