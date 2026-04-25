// SolutionFlow — verbatim port of source HTML lines 1413-1441.
//
// Server component: pure JSX, zero state. The flow-line-active fill
// animation (source script lines 1966-1974) is wired in landing.css
// to expand from 0→100% width when the parent gains `.is-revealed`
// via IntersectionObserver — no JS needed at the React layer; the
// scroll-reveal client component already handles the trigger.
export function SolutionFlow() {
  return (
    <section className="section" id="solution">
      <div
        className="blob-amber ambient-blob"
        style={{ top: "50%", right: -200 }}
      />
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">02</span>
          <span className="label">Enter Skitza</span>
          <h2 className="syne">
            One platform.<br />Everything automated.<br />Nothing missed.
          </h2>
          <p
            className="body-text"
            style={{ marginLeft: 0, marginBottom: 12 }}
          >
            Skitza connects to your calendar, payments, and messaging — and
            runs your entire client workflow automatically.
          </p>
          <p
            className="body-text"
            style={{
              marginLeft: 0,
              color: "var(--dark-body)",
              lineHeight: 2.2,
              fontSize: 15,
            }}
          >
            📅 Clients book themselves — you just show up
            <br />
            💸 Invoices sent and chased automatically
            <br />
            📁 Files delivered securely — no WhatsApp links
            <br />
            💬 Follow-ups and reminders — done for you
          </p>
        </div>

        <div className="solution-flow reveal-up delay-2" id="flow-diagram">
          <div className="flow-line" />
          <div className="flow-line-active" id="flow-line-active" />

          <div className="flow-node">
            Lead <span className="check">✓</span>
          </div>
          <div className="flow-node">
            Booking <span className="check">✓</span>
          </div>
          <div className="flow-node">
            Session <span className="check">✓</span>
          </div>
          <div className="flow-node">
            Invoice <span className="check">✓</span>
          </div>
          <div className="flow-node">
            Delivery <span className="check">✓</span>
          </div>
          <div className="flow-node">
            Follow-up <span className="check">✓</span>
          </div>
        </div>
      </div>
    </section>
  );
}
