import { SignIn } from "@clerk/nextjs";

// 2026-04-22 — Dropped `forceRedirectUrl` (mirrors the same Task-15
// fix on /sign-up). `forceRedirectUrl` unconditionally overrides any
// `redirect_url` query param, which silently broke /join signups
// that fell through to sign-in: a visitor who arrives at
// /sign-up/join/<slug>, discovers their email already has an account,
// and clicks "Sign in" was getting dumped on /dashboard instead of
// bounced back into the artist flow at /artist-welcome/<slug>.
//
// With only `fallbackRedirectUrl`: /dashboard is still the default
// destination when nobody specifies where to go. But any explicit
// `redirect_url=/artist-welcome/<slug>` the user arrives with (or
// any deep-link they were protecting with the middleware) is honored.
export default function Page() {
  return (
    <SignIn
      signUpUrl="/sign-up"
      fallbackRedirectUrl="/dashboard"
    />
  );
}
