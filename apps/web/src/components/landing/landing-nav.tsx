import Link from "next/link";

import { SkitzaMark } from "~/components/brand/skitza-mark";

// Landing-page top nav. Sticky-free (scrolls with page) so the hero
// reads as the first full-viewport moment. "Join The Waiting List" CTA
// anchors to the hero form (avoids an extra modal / duplicate form).
export function LandingNav() {
  return (
    <nav className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:py-6">
      <Link href="/" className="flex items-center gap-2.5 group">
        <SkitzaMark size="sm" />
        <span
          className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))] transition-colors group-hover:text-[rgb(var(--brand-primary))]"
          style={{ fontWeight: 800 }}
        >
          Skitza
        </span>
      </Link>
      <ul className="hidden items-center gap-8 text-sm font-medium text-[rgb(var(--fg-secondary))] md:flex">
        <li>
          <a href="#features" className="transition-colors hover:text-[rgb(var(--fg-primary))]">
            Features
          </a>
        </li>
        <li>
          <a href="#how-it-works" className="transition-colors hover:text-[rgb(var(--fg-primary))]">
            How It Works
          </a>
        </li>
        <li>
          <a href="#pricing" className="transition-colors hover:text-[rgb(var(--fg-primary))]">
            Pricing
          </a>
        </li>
      </ul>
      <a
        href="#waitlist-hero"
        className="pulse-glow inline-flex items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-4 py-2 text-sm font-semibold text-[#0C0A07] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.35)] transition-transform hover:scale-[1.04] hover:-translate-y-[1px] active:translate-y-[1px]"
      >
        Join Waitlist
      </a>
    </nav>
  );
}
