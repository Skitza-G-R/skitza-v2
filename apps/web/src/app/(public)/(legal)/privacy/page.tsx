export const metadata = { title: "Privacy" };

// Placeholder privacy policy — plain-language bullets, honest about
// what we collect, why, and what we don't. Replace with a proper legal
// version before public launch; this is the minimal responsible shape.
export default function PrivacyPage() {
  return (
    <div className="py-16 md:py-24">
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Privacy
      </p>
      <h1 className="font-syne mt-3 text-5xl font-extrabold leading-tight tracking-tight">
        What we collect.
      </h1>
      <p className="mt-2 font-mono text-sm text-[rgb(var(--fg-muted))]">
        Last updated: April 2026 · Plain English · Tell us at privacy@skitza.app if
        anything reads wrong.
      </p>

      <div className="mt-12 space-y-10 text-[rgb(var(--fg-secondary))]">
        <Section title="As a producer">
          We collect your email, display name, studio URL (slug), currency, timezone, and
          brand settings — the things you enter during onboarding and in /dashboard/settings.
          We store these to render your portfolio and operate your studio. We store
          nothing you don&apos;t tell us.
        </Section>

        <Section title="When a lead opens your link">
          When someone clicks a /m/&lt;token&gt; URL you sent, we log: the time of the open,
          an approximate IP (from the proxy headers), a short user-agent string, and the
          referring URL (if the browser provides one). This is shown to you as analytics
          (opens, devices, dwell time). We do not share this with anyone.
        </Section>

        <Section title="What we don&apos;t do">
          <ul className="mt-3 space-y-2">
            <Neg>No third-party analytics, trackers, or ad pixels.</Neg>
            <Neg>No cross-site cookies.</Neg>
            <Neg>No selling or sharing of producer or lead data.</Neg>
            <Neg>No email marketing lists built from your lead opens.</Neg>
          </ul>
        </Section>

        <Section title="Magic link tokens">
          The raw tokens we issue are never stored — only a SHA-256 hash. If the database
          is leaked, an attacker cannot recover working URLs from the hash alone.
        </Section>

        <Section title="Data you own, data you can delete">
          You can delete your profile and all related data (portfolio tracks, magic links,
          analytics) by emailing privacy@skitza.app — we&apos;ll comply within 7 days. A
          self-serve delete button lands soon.
        </Section>

        <Section title="Processors we use">
          <ul className="mt-3 space-y-2 font-mono text-sm">
            <Row>Authentication — Clerk (USA)</Row>
            <Row>Database — Neon Postgres (EU · Frankfurt)</Row>
            <Row>Hosting — Vercel (USA / Global edge)</Row>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-syne text-2xl font-bold tracking-tight text-[rgb(var(--fg-primary))]">
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

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-1 block h-1.5 w-1.5 rounded-full bg-[rgb(var(--fg-muted))]" />
      <span>{children}</span>
    </li>
  );
}
