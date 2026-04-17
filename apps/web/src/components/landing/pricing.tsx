import { WaitlistForm } from "./waitlist-form";

// Pricing — DARK world. Single Early Access card. Matches index.html §8.
// CTA fires the same waitlist flow (Stripe checkout comes in Phase C).

export function Pricing() {
  return (
    <section
      data-theme="chrome-dark"
      id="pricing"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute left-[-15%] top-0 h-[28rem] w-[28rem] rounded-full blur-[120px]"
          style={{ background: "rgba(176,104,48,0.08)" }}
        />
      </div>
      <div className="relative mx-auto max-w-xl px-6 text-center">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Pricing
        </p>
        <h2
          className="mt-3 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
          style={{ fontWeight: 800 }}
        >
          One plan.
          <span className="block">No surprises.</span>
        </h2>

        <div className="mt-10 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--bg-elevated))] p-8 text-left shadow-[0_20px_60px_-12px_rgb(var(--brand-primary)/0.25)]">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
            Early Access
          </p>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className="font-display text-6xl leading-none text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 800 }}
            >
              $29
            </span>
            <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">/month</span>
          </div>
          <p className="mt-1 font-mono text-xs text-[rgb(var(--fg-muted))] line-through">
            $79 after launch
          </p>
          <p className="mt-3 text-sm font-semibold text-[rgb(var(--brand-primary))]">
            Lock in this price forever
          </p>

          <ul className="mt-6 space-y-2 text-sm text-[rgb(var(--fg-primary))]">
            {[
              "Unlimited sessions & bookings",
              "Automated invoicing & payments",
              "Branded file delivery",
              "Full client CRM",
              "WhatsApp & email automation",
              "Lead management & follow-ups",
              "Priority support",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <span aria-hidden className="mt-1 text-[rgb(var(--brand-primary))]">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div id="waitlist-pricing" className="mt-8">
            <WaitlistForm source="landing-pricing" cta="Claim Early Access →" compact />
          </div>
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            14-day free trial · Cancel anytime · No credit card required
          </p>
        </div>
      </div>
    </section>
  );
}
