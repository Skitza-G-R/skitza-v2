import Link from "next/link";

// Pricing — verbatim port of source HTML lines 1763-1795.
//
// Server component: pure JSX, the only state in the source was the
// hover-tilt 3D effect (script lines 1987-2008) which is decorative
// and absent here — landing.css `:hover` rules already give the
// pricing card a subtle lift; the 3D mouse-track is overkill for
// the launch pass.
//
// CTA "Claim Early Access Pricing →" → <Link> "Sign up now →"
// pointing at /sign-up?redirect_url=%2Fonboarding (Clerk honours the
// redirect after sign-up).
export function Pricing() {
  return (
    <section className="section" id="pricing">
      <div
        className="blob-copper ambient-blob"
        style={{ top: 0, left: -200 }}
      />
      <div className="container">
        <div
          className="section-header reveal-up"
          style={{ margin: "0 auto 40px", textAlign: "center" }}
        >
          <span
            className="watermark"
            style={{ left: "50%", transform: "translateX(-50%)" }}
          >
            06
          </span>
          <span className="label">Pricing</span>
          <h2 className="syne">
            One plan.<br />No surprises.
          </h2>
        </div>

        <div className="pricing-wrap reveal-up delay-1">
          <div className="pricing-card" id="pricing-card-3d">
            <span className="price-plan">Early Access</span>
            <div className="price-amount">$29</div>
            <span className="price-period">/month</span>
            <span className="price-strike">$79 after launch</span>
            <span className="price-sub">Lock in this price forever</span>

            <ul className="pricing-features">
              <li>Unlimited sessions &amp; bookings</li>
              <li>Automated invoicing &amp; payments</li>
              <li>Branded file delivery</li>
              <li>Full client CRM</li>
              <li>WhatsApp &amp; email automation</li>
              <li>Lead management &amp; follow-ups</li>
              <li>Priority support</li>
            </ul>

            <Link
              href="/sign-up?redirect_url=%2Fonboarding"
              className="btn-primary full"
            >
              Sign up now →
            </Link>
            <span className="price-footer">
              14-day free trial · Cancel anytime · No credit card required
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
