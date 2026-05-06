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
};

export function AuthHero({ eyebrow, title, blurb }: AuthHeroProps) {
  return (
    <header className="mb-7">
      <div
        className="font-mono mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {eyebrow}
      </div>
      <h1
        className="font-syne mb-2 text-[30px] font-extrabold leading-[1.1]"
        style={{
          letterSpacing: "-0.025em",
          color: "rgb(var(--fg-primary))",
        }}
      >
        {title}
        <span
          aria-hidden
          style={{ color: "rgb(var(--brand-primary))" }}
        >
          .
        </span>
      </h1>
      <p
        className="text-[13.5px] leading-[1.5]"
        style={{ color: "rgb(var(--fg-secondary))" }}
      >
        {blurb}
      </p>
    </header>
  );
}
