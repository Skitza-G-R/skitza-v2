// HowItWorks — verbatim port of source HTML lines 1707-1734.
//
// Server component: pure JSX. Three step cards on a horizontal flow
// line. The reveal-up delay-{1,2,3} classes fan the cards in as the
// section enters the viewport.
export function HowItWorks() {
  return (
    <section className="section" id="how-it-works">
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">04</span>
          <span className="label">Setup</span>
          <h2 className="syne">
            Set it up once.<br />Let it run forever.
          </h2>
        </div>

        <div className="steps-layout">
          <div className="steps-line" />
          <div className="step-card reveal-up delay-1">
            <div className="step-num">01</div>
            <h3>Connect your studio</h3>
            <p>
              Link your calendar, WhatsApp, payment method,
              <br />
              and file storage in under 10 minutes.
            </p>
          </div>
          <div className="step-card reveal-up delay-2">
            <div className="step-num">02</div>
            <h3>Set your rules</h3>
            <p>
              Your rates, your availability, your workflow.
              <br />
              Skitza learns how you work and automates it exactly.
            </p>
          </div>
          <div className="step-card reveal-up delay-3">
            <div className="step-num">03</div>
            <h3>Focus on music</h3>
            <p>
              New session? Handled.
              <br />
              Payment due? Handled.
              <br />
              File delivered? Handled.
              <br />
              You just open your DAW.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
