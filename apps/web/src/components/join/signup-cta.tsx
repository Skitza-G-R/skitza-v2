import Link from "next/link";

import { JoinSocialLinks } from "./join-social-links";

// Dark CTA + contact section at the bottom of `/join/<slug>`.
//
// Per design context 2026: an inverted (dark cream → near-black)
// section with a centered editorial headline ("Let's make something
// that lasts."), a primary "Book a session →" CTA, and a row of
// social-link chips. The dark band creates closure for the page —
// a visitor who scrolls all the way down lands here and either books
// (signs up) or follows a streaming link.
//
// Wave 1 booking flow: the CTA points to the dedicated /sign-up/join/<slug>
// route, which sets `unsafeMetadata={signupOrigin:"join", producerSlug}`
// on Clerk's <SignUp>, so the webhook branches correctly and the
// post-signup redirect lands on the artist-welcome splash. NOT a real
// booking modal — that's Phase H. Phase H also brings real Stripe
// checkout in step 3.
//
// English-only, LTR-only per CLAUDE.md i18n scope.

interface SignupCtaProps {
  slug: string;
  socialLinks: ReadonlyArray<{
    id: string;
    platform: string;
    url: string;
    title: string | null;
    position: number;
  }>;
}

export function SignupCta({ slug, socialLinks }: SignupCtaProps) {
  const href = `/sign-up/join/${encodeURIComponent(slug)}`;

  return (
    <section
      id="contact"
      aria-label="Book a session"
      className="relative mt-20 overflow-hidden bg-[rgb(var(--fg-primary))] px-6 py-20 text-[rgb(var(--bg-base))] sm:mt-24 sm:px-10 sm:py-24"
    >
      {/* Subtle ambient drift on the dark band — anchors the brand
          voice all the way to the page footer. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute left-1/2 top-1/2 h-[24rem] w-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
          style={{
            background: "rgb(var(--brand-primary) / 0.12)",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <h2
          className="font-extrabold text-[clamp(2.2rem,5vw,3.4rem)] leading-[1.05] tracking-[-0.028em]"
          style={{ fontFamily: "var(--font-head), var(--font-display)" }}
        >
          Let&apos;s make something that lasts.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-[rgb(var(--bg-base)/0.7)] sm:text-lg">
          Reach out anywhere — replies usually land within a day.
        </p>

        <div className="mt-9 flex flex-col items-center gap-4 sm:gap-5">
          <Link
            href={href}
            className={[
              "sk-cta-shine pulse-glow inline-flex min-h-12 w-full items-center justify-center whitespace-nowrap",
              "rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))]",
              "px-8 py-4 text-base font-bold text-[rgb(var(--fg-primary))] sm:w-auto sm:text-lg",
              "shadow-[0_6px_20px_-4px_rgb(var(--brand-primary)/0.4)]",
              "transition-transform hover:-translate-y-[1px] active:translate-y-[1px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--fg-primary))]",
            ].join(" ")}
          >
            <span className="relative z-10">Book a session →</span>
          </Link>

          <JoinSocialLinks links={socialLinks} />
        </div>

        <p className="mt-10 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--bg-base)/0.4)] sm:text-[0.66rem]">
          Page by Skitza · Free to join · No credit card
        </p>
      </div>
    </section>
  );
}
