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
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        About
      </p>
      <h1 className="font-syne mt-3 text-5xl font-extrabold leading-[0.98] tracking-tight sm:text-6xl">
        For solo music producers
        <span className="block" style={{ color: "rgb(var(--brand-primary))" }}>
          running a one-person business.
        </span>
      </h1>

      <div className="mt-10 space-y-6 text-lg leading-relaxed text-[rgb(var(--fg-secondary))]">
        <p>
          Skitza was built after I lost a $4k mix. No signed contract, no proof of
          delivery — the artist ghosted, and I had nothing to point at.
        </p>
        <p>
          The tools to prevent it existed: Calendly for booking, Samply for files,
          Notion for notes, DocuSign for the contract, Stripe for the deposit,
          WhatsApp for everything else. Six tools, six logins, forty-seven emails per
          session. The friction <em>was</em> the product.
        </p>
        <p>
          Skitza is what I wish I&apos;d had that night — one link, every client,
          every dollar tracked. Built so you can spend Friday night mixing instead of
          resending a WAV for the third time.
        </p>
        <p
          className="font-mono pt-2 text-sm uppercase tracking-[0.14em]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          — Gili Asraf, founder
        </p>
      </div>

      <div className="mt-14 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-7 sm:p-8">
        <h2 className="font-syne text-2xl font-extrabold tracking-tight">
          Start your studio
        </h2>
        <p className="mt-2 text-[rgb(var(--fg-secondary))]">
          Free to start. No card. Three minutes to your first booking link.
        </p>
        <Button asChild size="lg" className="mt-5">
          <Link href="/sign-up?redirect_url=%2Fonboarding">
            Get demo access →
          </Link>
        </Button>
      </div>
    </div>
  );
}
