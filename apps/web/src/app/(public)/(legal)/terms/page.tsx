export const metadata = { title: "Terms" };

// Placeholder terms — the minimum responsible shape for a beta. Must
// be replaced by counsel-reviewed terms before public launch. Note to
// future self: the "arbitration" and "liability" clauses need real
// legal input for the jurisdictions we plan to serve.
export default function TermsPage() {
  return (
    <div className="py-16 md:py-24">
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Terms of service
      </p>
      <h1
        className="mt-3 font-display text-5xl leading-tight tracking-tight"
        style={{ fontVariationSettings: '"opsz" 144' }}
      >
        The basics.
      </h1>
      <p className="mt-2 font-mono text-sm text-[rgb(var(--fg-muted))]">
        Last updated: April 2026 · Beta · Plain language · These will be replaced by
        formal terms before public launch.
      </p>

      <div className="mt-12 space-y-10 text-[rgb(var(--fg-secondary))]">
        <Section title="What Skitza is">
          Skitza is a studio-business platform for independent music producers. You use it
          to host a public portfolio, mint smart lead links, and (over time) manage
          bookings, contracts, and payments.
        </Section>

        <Section title="Your content">
          Audio URLs, artwork, display name, and other content you upload remain yours. You
          grant Skitza a license to store, render, and deliver that content solely to
          operate the service for you and your visitors.
        </Section>

        <Section title="Acceptable use">
          <ul className="mt-3 space-y-2">
            <Neg>No content you don&apos;t own the rights to.</Neg>
            <Neg>No malware, phishing, or spam via magic links.</Neg>
            <Neg>No abuse of the analytics pipeline (scripted views to mislead another producer).</Neg>
            <Neg>No use of the service to harass or harm another user.</Neg>
          </ul>
        </Section>

        <Section title="Beta caveats">
          The service is in beta. We may change features, reset non-production data, or
          introduce paid tiers with reasonable notice. Don&apos;t rely on Skitza as the
          sole system of record for a commercial engagement during beta.
        </Section>

        <Section title="Availability">
          We aim for high uptime but don&apos;t guarantee it during beta. Magic links 404 if
          the underlying producer account is deleted, revoked, or expired — by design.
        </Section>

        <Section title="Termination">
          You can close your account any time by emailing privacy@skitza.app. We can close
          accounts that violate these terms, with a best-effort heads-up where possible.
        </Section>

        <Section title="Governing law + contact">
          These terms will be governed by the jurisdiction of Skitza&apos;s operating entity
          (to be formalised before public launch). For anything contractual, reach
          legal@skitza.app.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]">
        {title}
      </h2>
      <div className="mt-3 leading-relaxed">{children}</div>
    </section>
  );
}

function Neg({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-0.5 text-[rgb(var(--fg-danger))]">✕</span>
      <span>{children}</span>
    </li>
  );
}
