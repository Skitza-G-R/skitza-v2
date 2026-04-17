import Link from "next/link";

import { WaitlistForm } from "./waitlist-form";

// Final CTA — transitions BACK to LIGHT, mirroring the landing's own
// light → dark → light dramaturgy. Matches index.html §9.

export function FinalCTA() {
  return (
    <section
      data-theme="chrome-light"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute left-1/2 top-1/3 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full blur-[120px]"
          style={{ background: "rgba(212,150,10,0.12)" }}
        />
      </div>
      <div className="relative mx-auto max-w-2xl px-6 text-center">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Ready?
        </p>
        <h2
          className="mt-4 font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[1] tracking-tight"
          style={{ fontWeight: 800 }}
        >
          The studio that
          <span className="mt-1 block italic text-[rgb(var(--brand-primary))]">
            runs itself is here.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-[rgb(var(--fg-secondary))]">
          Stop spending hours on admin. Make the music you actually want to make.
        </p>
        <div id="waitlist-final" className="mx-auto mt-10 max-w-md">
          <WaitlistForm source="landing-final-cta" cta="Join The Waiting List" compact />
        </div>
      </div>

      {/* Footer strip. Legal + producer log-in link for existing users. */}
      <footer className="relative mx-auto mt-20 max-w-6xl border-t border-[rgb(var(--border-subtle))] px-6 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            © {String(new Date().getFullYear())} Skitza · Made for producers who ship
          </p>
          <nav className="flex items-center gap-5 font-mono text-xs text-[rgb(var(--fg-secondary))]">
            <Link href="/about" className="transition-colors hover:text-[rgb(var(--fg-primary))]">About</Link>
            <Link href="/privacy" className="transition-colors hover:text-[rgb(var(--fg-primary))]">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-[rgb(var(--fg-primary))]">Terms</Link>
            <Link href="/sign-in" className="transition-colors hover:text-[rgb(var(--brand-primary))]">Sign in →</Link>
          </nav>
        </div>
      </footer>
    </section>
  );
}
