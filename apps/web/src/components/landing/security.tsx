// Security — DARK world. 3-card pillar layout (Privacy / Storage /
// Auth). Restyled in S3 to use landing.css `.security-grid` +
// `.security-card` (added to landing.css as part of S3). No Tailwind,
// no project tokens.
//
// New section in S3 (no source HTML equivalent). Concrete facts, not
// compliance theater — every claim maps to a real piece of infra
// already in the codebase: R2 + signed URLs + Clerk + row-level
// tenant scoping. Unicode glyph icons (🔒 ☁️ 🛡️) match the source
// design's tactile-warm aesthetic without introducing an SVG sprite.
//
// Server component: pure JSX, no state.

const PILLARS = [
  {
    icon: "🔒",
    title: "Privacy",
    body: "GDPR-ready architecture. Single-tenant audit log per producer. Row-level isolation enforced at the query layer — no silent cross-tenant leaks, ever.",
  },
  {
    icon: "☁️",
    title: "Storage",
    body: "Cloudflare R2 with AES-256 at rest. Every audio playback uses a short-lived signed URL scoped to the client. 90-day rolling backup of all metadata.",
  },
  {
    icon: "🛡️",
    title: "Auth",
    body: "Clerk-backed sessions with MFA-ready accounts. Client access rides on single-use magic links — no standing credentials. SOC 2 Type II in progress.",
  },
] as const;

export function Security() {
  return (
    <section className="section" id="security">
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">08</span>
          <span className="label">Enterprise-grade by default</span>
          <h2 className="syne">
            Your masters never<br />leave the building.
          </h2>
          <p className="body-text" style={{ marginLeft: 0 }}>
            Audio and contracts move across the internet every day. Here's
            what happens to yours when they pass through Skitza.
          </p>
        </div>

        <div className="security-grid">
          {PILLARS.map((pillar, i) => (
            <article
              key={pillar.title}
              className={`security-card reveal-up delay-${String(i + 1)}`}
            >
              <span className="security-icon" aria-hidden>
                {pillar.icon}
              </span>
              <h3 className="syne">{pillar.title}</h3>
              <p>{pillar.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
