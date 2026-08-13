import Link from "next/link";

import { Button } from "~/components/ui/button";

export const metadata = { title: "About" };

// About — Phase 3 (v3 — docs/qa/phase-3-handoff.md). Replaced the
// Phase D copy ("Built for producers. Not for rooms.") with a tighter
// founder-tone variant aligned to the v3 landing's "from the founder"
// section — same voice, ~150 words, no team photos / mission
// statement boilerplate.
export default function AboutPage() {
  return (
    <div className="py-16 md:py-24">
      <p className="font-mono text-[0.72rem] tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
        About
      </p>
      <h1 className="font-syne mt-3 text-5xl leading-[0.98] font-extrabold tracking-tight sm:text-6xl">
        For solo music producers
        <span className="block" style={{ color: "rgb(var(--brand-primary))" }}>
          running a one-person business.
        </span>
      </h1>

      <div className="mt-10 space-y-6 text-lg leading-relaxed text-[rgb(var(--fg-secondary))]">
        <p>
          Skitza was built after a mix went unpaid. No accepted agreement, no clear delivery record
          — the artist disappeared, and I had nothing solid to point at.
        </p>
        <p>
          The tools to prevent it existed: Calendly for booking, Samply for files, Notion for notes,
          DocuSign for the contract, Stripe for the deposit, WhatsApp for everything else. Too many
          tools, too many logins, and too much context switching. The friction <em>was</em> the
          product.
        </p>
        <p>
          Skitza is what I wish I&apos;d had that night — one link, every client, every dollar
          tracked. Built so you can spend Friday night mixing instead of resending a WAV for the
          third time.
        </p>
        <p
          className="pt-2 font-mono text-sm tracking-[0.14em] uppercase"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          — Gili Asraf, founder
        </p>
      </div>

      <div className="mt-14 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-7 sm:p-8">
        <h2 className="font-syne text-2xl font-extrabold tracking-tight">Producer access</h2>
        <p className="mt-2 text-[rgb(var(--fg-secondary))]">
          Producer access is invitation-only. Artists create accounts through a Producer&apos;s
          Skitza link.
        </p>
        <Button asChild size="lg" className="mt-5 rounded-[var(--radius-lg)]">
          <Link href="/producer-access">Learn about access →</Link>
        </Button>
      </div>
    </div>
  );
}
