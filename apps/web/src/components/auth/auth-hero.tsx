// Hero block displayed above the Clerk `<SignIn>` / `<SignUp>` widget on
// each auth page. Replaces Clerk's default `headerTitle` /
// `headerSubtitle` (those are hidden via the ClerkProvider `appearance`
// in `apps/web/src/app/layout.tsx`) so the auth surfaces match the
// locked v3 design source (`/tmp/skitza-design/tabs/auth.jsx`):
//
//   eyebrow  → mono uppercase, tracked, fg-muted
//   title    → Syne 800, fg-primary, with an amber period for accent
//   blurb    → fg-secondary, 1.5 line-height
//
// The amber period is the same accent the landing page uses for the
// hero word ("Skitza." final period) — keeps the auth screens visually
// continuous with marketing.

import type { ReactNode } from "react";

export type AuthHeroProps = {
  eyebrow: string;
  title: string;
  blurb: ReactNode;
  showAccentPeriod?: boolean;
};

export function AuthHero({ eyebrow, title, blurb, showAccentPeriod = true }: AuthHeroProps) {
  return (
    <header className="mb-5 sm:mb-7">
      <div
        className="mb-2 font-mono text-[11px] font-semibold tracking-[0.18em] uppercase sm:mb-3"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {eyebrow}
      </div>
      <h1
        className="font-syne mb-2 text-[26px] leading-[1.1] font-extrabold [overflow-wrap:anywhere] sm:text-[30px]"
        style={{
          letterSpacing: "-0.025em",
          color: "rgb(var(--fg-primary))",
        }}
      >
        {title}
        {showAccentPeriod ? (
          <span aria-hidden style={{ color: "rgb(var(--brand-primary))" }}>
            .
          </span>
        ) : null}
      </h1>
      <p
        className="text-[13.5px] leading-[1.5] [overflow-wrap:anywhere]"
        style={{ color: "rgb(var(--fg-secondary))" }}
      >
        {blurb}
      </p>
    </header>
  );
}
