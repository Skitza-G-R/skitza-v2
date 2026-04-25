// Founder — DARK world. Single-column editorial note signed by the
// founder. Restyled in S3 to use landing.css `.founder-wrap`,
// `.founder-portrait`, `.founder-body`, `.founder-signoff` (all added
// to landing.css as part of S3). No Tailwind, no project tokens.
//
// Editorial weight is intentional — the section is short, narrow, and
// reads like a personal note instead of a marketing tile. The portrait
// is a circular gradient placeholder with the founder's initials in
// Syne; swap for a real photo later by replacing the inner span with
// an <Image>.
//
// Server component: pure JSX, no state.
export function Founder() {
  return (
    <section className="section" id="founder">
      <div className="container">
        <div className="founder-wrap">
          <span className="label reveal-up">From the founder</span>

          <div className="founder-portrait reveal-up delay-1" aria-hidden>
            GA
          </div>

          <div className="founder-body">
            <p className="reveal-up delay-2">
              I built Skitza after losing a $4k mix. No signed contract,
              no proof of delivery — the artist ghosted, and I had nothing
              to point at. The tools to prevent it existed; they were just
              scattered across six different apps.
            </p>
            <p className="reveal-up delay-3">
              Calendly for booking. Samply for files. Notion for project
              notes. DocuSign for the contract. Stripe for the deposit.
              WhatsApp for everything else. The friction <em>was</em> the
              product, and every solo producer I knew lived inside it.
            </p>
            <p className="reveal-up delay-4">
              Skitza is the tool I wish I'd had that night. One link.
              Every client. Every session. Every dollar tracked. Built so
              you can spend Friday night mixing instead of resending a
              WAV for the third time.
            </p>
          </div>

          <div className="founder-signoff reveal-up delay-5">
            — Gili Asraf, founder
          </div>
        </div>
      </div>
    </section>
  );
}
