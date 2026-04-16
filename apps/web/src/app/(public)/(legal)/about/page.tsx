import Link from "next/link";

import { Button } from "~/components/ui/button";

export const metadata = { title: "About" };

// About page — marketing context beyond the landing hero. Explains the
// problem + the bet + what's in v1 vs. what's coming. Written to be
// skimmable and honest about what's not built yet.
export default function AboutPage() {
  return (
    <div className="py-16 md:py-24">
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        About
      </p>
      <h1
        className="mt-3 font-display text-5xl leading-[0.98] tracking-tight sm:text-6xl"
        style={{ fontVariationSettings: '"opsz" 144' }}
      >
        Built for producers.
        <span className="block italic text-[rgb(var(--brand-primary))]">Not for rooms.</span>
      </h1>

      <div className="mt-10 space-y-8 text-lg leading-relaxed text-[rgb(var(--fg-secondary))]">
        <p>
          Most studio SaaS is built for facilities with rooms — complex booking engines for
          twenty engineers and a coffee bar. The rest is generic creative-services CRM that
          doesn&apos;t know what an audio stem is, or beautiful waveform-feedback tools that
          don&apos;t know what a contract is.
        </p>
        <p>
          Skitza is for the solo music producer running a one-person business. One URL
          turns a cold lead into a paying signed booking: portfolio, booking, deposit,
          contract, collaboration, invoice — all behind a single magic link you send.
        </p>
      </div>

      <div className="mt-16 grid gap-8 md:grid-cols-2">
        <Section title="What&apos;s in v1 today">
          <ul className="mt-3 space-y-2 font-mono text-sm text-[rgb(var(--fg-secondary))]">
            <Check>Producer onboarding + brand settings</Check>
            <Check>Public portfolio at /p/&lt;you&gt;</Check>
            <Check>Smart lead links (magic URL + analytics)</Check>
            <Check>Dwell-time, open count, device + referrer per view</Check>
            <Check>Dark-first, mobile-first, fast</Check>
          </ul>
        </Section>
        <Section title="What&apos;s coming">
          <ul className="mt-3 space-y-2 font-mono text-sm text-[rgb(var(--fg-secondary))]">
            <Dot>Cal.com-powered public booking</Dot>
            <Dot>Project Rooms (files + waveform feedback + messages)</Dot>
            <Dot>Stripe Connect for deposits + milestone invoices</Dot>
            <Dot>Contract templates with e-sign</Dot>
            <Dot>Email a lead the magic link from inside Skitza</Dot>
            <Dot>Wavesurfer audio + version stacking + A/B compare</Dot>
          </ul>
        </Section>
      </div>

      <div className="mt-16 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-8">
        <h2 className="font-display text-2xl tracking-tight">Start your studio</h2>
        <p className="mt-2 text-[rgb(var(--fg-secondary))]">
          Free during beta. Takes under two minutes. Your URL is yours immediately.
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link href="/sign-up">Claim your studio URL →</Link>
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6">
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      {children}
    </div>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-0.5 text-[rgb(var(--brand-primary))]">✓</span>
      <span>{children}</span>
    </li>
  );
}

function Dot({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-1 block h-1.5 w-1.5 rounded-full bg-[rgb(var(--fg-muted))]" />
      <span>{children}</span>
    </li>
  );
}
