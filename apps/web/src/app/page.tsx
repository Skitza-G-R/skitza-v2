import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { Button } from "~/components/ui/button";

// Public marketing landing page. Signed-in visitors are sent straight to the
// dashboard — we don't want producers landing on a "sign up" CTA they've
// already used. Unsigned visitors get the pitch.
export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      {/* Ambient hero background — green/amber gradient blobs, barely there. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-[-8rem] h-[36rem] w-[36rem] rounded-full bg-[rgb(var(--brand-primary)/0.10)] blur-[120px]" />
        <div className="absolute right-[-14rem] top-[24rem] h-[28rem] w-[28rem] rounded-full bg-[rgb(var(--brand-accent)/0.10)] blur-[120px]" />
      </div>

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <Mark />
          <span className="font-display text-xl tracking-tight">Skitza</span>
        </Link>
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Start free</Link>
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6">
        {/* Hero. The signature moment — Fraunces pulled large with optical
            sizing makes the display face actually earn its place. */}
        <section className="py-16 md:py-28">
          <p className="reveal-up inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-secondary))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
            Beta — for independent producers
          </p>
          <h1
            className="reveal-up-delay-1 mt-6 max-w-3xl font-display text-[clamp(2.75rem,7.5vw,5.75rem)] leading-[0.96] tracking-tight"
            style={{ fontVariationSettings: '"opsz" 144' }}
          >
            The studio,
            <span className="block italic text-[rgb(var(--brand-primary))]" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
              in one link.
            </span>
          </h1>
          <p className="reveal-up-delay-2 mt-6 max-w-xl text-lg leading-relaxed text-[rgb(var(--fg-secondary))]">
            Skitza replaces the six apps holding your studio together. Booking, portfolio,
            contracts, collaboration, payments — all behind a single magic link you send
            to a lead.
          </p>
          <div className="reveal-up-delay-3 mt-10 flex flex-wrap items-center gap-3">
            <Button asChild size="xl">
              <Link href="/sign-up">Claim your studio URL →</Link>
            </Button>
            <Button asChild variant="outline" size="xl">
              <Link href="/sign-in">I have an account</Link>
            </Button>
          </div>
          <p className="reveal-up-delay-4 mt-6 font-mono text-xs text-[rgb(var(--fg-muted))]">
            Free during beta · English-only at launch · No credit card required
          </p>
        </section>

        {/* Three feature rows — editorial, not grid-of-boxes. */}
        <section className="border-t border-[rgb(var(--border-subtle))] py-16 md:py-24">
          <h2 className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            What's inside
          </h2>
          <div className="mt-10 grid gap-12 md:grid-cols-3 md:gap-8">
            <FeatureRow
              num="01"
              title="Smart Lead Links"
              body="Mint a single URL that sends a cold lead through your portfolio, booking, and deposit — with analytics at every step."
            />
            <FeatureRow
              num="02"
              title="Portfolio + Feedback"
              body="Your showcase plus a real audio review room: waveform comments, versions, A/B compares — not a Dropbox share link."
            />
            <FeatureRow
              num="03"
              title="CRM that runs itself"
              body="Leads, sessions, and balances derived from events. No dual-entry. No forgotten follow-ups. No invoice chasing."
            />
          </div>
        </section>

        <section className="border-t border-[rgb(var(--border-subtle))] py-16 md:py-24">
          <div className="grid items-center gap-10 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="max-w-2xl font-display text-3xl leading-tight tracking-tight md:text-4xl">
                Built for one producer.
                <span className="block text-[rgb(var(--fg-secondary))]">Not a label. Not a studio franchise.</span>
              </h2>
              <p className="mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
                Most tools in this space are built for rooms, not people. Skitza is the
                first studio-business platform where the producer — their brand, their
                voice, their workflow — sits at the center.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/sign-up">Start your studio</Link>
            </Button>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[rgb(var(--border-subtle))] py-10">
          <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            © {new Date().getFullYear()} Skitza · Made for producers who ship
          </p>
          <nav className="flex items-center gap-4 font-mono text-xs text-[rgb(var(--fg-secondary))]">
            <Link href="/about" className="hover:text-[rgb(var(--fg-primary))]">About</Link>
            <Link href="/privacy" className="hover:text-[rgb(var(--fg-primary))]">Privacy</Link>
            <Link href="/terms" className="hover:text-[rgb(var(--fg-primary))]">Terms</Link>
          </nav>
        </footer>
      </main>
    </div>
  );
}

function FeatureRow({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="relative border-l border-[rgb(var(--border-subtle))] pl-6">
      <span className="font-mono text-xs tracking-widest text-[rgb(var(--brand-primary))]">
        {num}
      </span>
      <h3 className="mt-3 font-display text-2xl leading-tight tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">{body}</p>
    </div>
  );
}

function Mark() {
  return (
    <svg aria-hidden width="26" height="26" viewBox="0 0 28 28">
      <defs>
        <linearGradient id="land-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-primary))" />
          <stop offset="100%" stopColor="rgb(var(--brand-accent))" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="rgb(var(--bg-elevated))" stroke="rgb(var(--border-strong))" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="url(#land-mark)" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2" fill="url(#land-mark)" />
    </svg>
  );
}
