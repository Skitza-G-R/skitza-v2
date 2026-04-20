import Link from "next/link";

// Signup CTA for `/join/<slug>`.
//
// Wave 1 scope: a plain Link to `/sign-up` with the post-signup
// redirect encoded as a query param. The artist-welcome page for this
// producer handles the auto-attach flow in Wave 2 (see arch doc
// §Wave 2). Wave 1 just gets visitors into the signup funnel.
//
// Deliberately NOT using Clerk's `<SignUpButton>` client wrapper —
// keeping this a plain link means (a) the CTA renders in the static
// HTML for SEO + no-JS visitors, (b) no Clerk provider needs to wrap
// the public page. Clerk still owns the destination at `/sign-up`.
//
// Server component. The button itself is static; nothing here needs
// React state. If we later want an optimistic "signing up" spinner we
// can split into a client shell.

interface SignupCtaProps {
  slug: string;
}

export function SignupCta({ slug }: SignupCtaProps) {
  // Redirect target is `/artist-welcome/<slug>` (placeholder until
  // Wave 2 builds the first-time splash). Clerk's sign-up page reads
  // `redirect_url` and bounces there after the account is provisioned.
  // Use plain URLSearchParams so special chars in `slug` are encoded
  // (unlikely — slugs are kebab-case — but belt + suspenders).
  const redirectTarget = `/artist-welcome/${encodeURIComponent(slug)}`;
  const href = `/sign-up?redirect_url=${encodeURIComponent(redirectTarget)}`;

  return (
    <section
      aria-label="Sign up"
      className="mx-auto mt-14 max-w-3xl px-6 text-center sm:px-10"
    >
      <Link
        href={href}
        className={[
          // Match the landing hero's primary CTA anatomy: big gradient
          // button, pulse-glow, cta-shine on hover. Also: generous tap
          // target (min-h-14) — this is the conversion moment on mobile.
          "sk-cta-shine pulse-glow inline-flex min-h-14 w-full items-center justify-center whitespace-nowrap",
          "rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))]",
          "px-8 py-4 text-base font-semibold text-[#0C0A07] sm:text-lg",
          "shadow-[0_6px_20px_-4px_rgb(var(--brand-primary)/0.4)]",
          "transition-transform hover:scale-[1.02] hover:-translate-y-[1px] active:translate-y-[1px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
          "sm:w-auto",
        ].join(" ")}
      >
        <span className="relative z-10">
          Sign up to hear the full catalog + book a session →
        </span>
      </Link>

      <p className="mt-5 font-mono text-xs uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Free to join · No credit card
      </p>
    </section>
  );
}
