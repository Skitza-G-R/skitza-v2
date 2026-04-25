// Compare — DARK world. 2-column comparison: the unbundled producer
// stack (6 separate tools) vs Skitza (one tool). Restyled in S3 to use
// landing.css `.compare-grid` + `.compare-card` (added to landing.css
// as part of S3). No Tailwind, no project tokens.
//
// New section in S3 (no source HTML equivalent — the source's
// "consolidation" section serves a similar narrative purpose but uses a
// chip layout, not a 2-column compare). This card pair leads with the
// concrete pain (4 tools, 12 logins, 47 emails) before pivoting to the
// Skitza side, mirroring the founder note's "5 logins, 5 places for
// something to go wrong" beat.
//
// Server component: pure JSX, no state.

const OLD_STACK = [
  { tool: "Calendly", role: "Booking" },
  { tool: "Samply", role: "File review" },
  { tool: "Notion", role: "Project notes" },
  { tool: "DocuSign", role: "Contracts" },
  { tool: "Stripe (manual)", role: "Invoicing" },
  { tool: "WhatsApp", role: "Everything else" },
] as const;

const NEW_STACK = [
  { row: "Booking, contracts, audio, payments, CRM" },
  { row: "One URL per producer" },
  { row: "Clients sign + pay + review without an account" },
  { row: "Master files gated until the invoice clears" },
  { row: "Desktop app + mobile companion" },
  { row: "Single subscription. Single login." },
] as const;

export function Compare() {
  return (
    <section className="section" id="compare">
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">02</span>
          <span className="label">Why Skitza</span>
          <h2 className="syne">
            One tool replaces<br />the whole stack.
          </h2>
          <p className="body-text" style={{ marginLeft: 0 }}>
            The math on the unbundled producer setup: 6 logins, 6 monthly
            fees, 4 contexts to switch between, and a client who has to
            remember which app you sent the link in.
          </p>
        </div>

        <div className="compare-grid">
          <div className="compare-card reveal-up">
            <span className="compare-eyebrow">Without Skitza</span>
            <h3>The unbundled stack</h3>
            <ul className="compare-list">
              {OLD_STACK.map((item) => (
                <li key={item.tool} className="compare-row">
                  <span className="compare-mark bad" aria-hidden>
                    ×
                  </span>
                  <span>
                    <strong style={{ color: "var(--dark-text)", fontWeight: 500 }}>
                      {item.tool}
                    </strong>
                    {" — "}
                    {item.role}
                  </span>
                </li>
              ))}
            </ul>
            <div className="compare-cost">
              ≈ 6 tools · 6 monthly fees · 47 emails per session
            </div>
          </div>

          <div className="compare-card is-skitza reveal-up delay-1">
            <span className="compare-eyebrow">With Skitza</span>
            <h3>One unified studio</h3>
            <ul className="compare-list">
              {NEW_STACK.map((item) => (
                <li key={item.row} className="compare-row">
                  <span className="compare-mark good" aria-hidden>
                    ✓
                  </span>
                  <span>{item.row}</span>
                </li>
              ))}
            </ul>
            <div className="compare-cost">
              1 tool · 1 subscription · 1 link your clients remember
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
