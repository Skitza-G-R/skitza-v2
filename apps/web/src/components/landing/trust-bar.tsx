// TrustBar — LIGHT world. Quiet credibility strip that sits between the
// warm Hero and the dark `<main className="dark-world">` block. No
// fabricated logos — this is a publication-mention placeholder strip
// rendered as text wordmarks in the Syne display font, so the visual
// weight stays small and we never imply an endorsement we don't have.
//
// New section in S3 (no source HTML equivalent). Uses landing.css
// classes only: .trust-strip, .container, .trust-strip-inner, .label,
// .trust-logos, .trust-logo, .trust-divider. No Tailwind, no project
// tokens.
//
// When the rollout has real publication mentions, swap PUBLICATIONS for
// the actual list — keep the same visual treatment.
const PUBLICATIONS = [
  "Pitchfork",
  "Resident Advisor",
  "Bandcamp Daily",
  "MusicTech",
  "Production Expert",
] as const;

export function TrustBar() {
  return (
    <section className="trust-strip" aria-label="Press and publication mentions">
      <div className="container">
        <div className="trust-strip-inner">
          <span className="label">As featured in</span>
          <div className="trust-logos syne">
            {PUBLICATIONS.map((name, i) => (
              <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 32 }}>
                <span className="trust-logo">{name}</span>
                {i < PUBLICATIONS.length - 1 ? (
                  <span className="trust-divider" aria-hidden>
                    ·
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
