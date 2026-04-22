import { SignUp } from "@clerk/nextjs";

// Default producer sign-up. The landing-page CTAs + direct /sign-up
// visits end up here. Post-signup we want the new Producer on the
// dashboard so /onboarding can greet them.
//
// 2026-04-22 — Dropped `forceRedirectUrl` (see docs/audit-report.md
// Task 15). `forceRedirectUrl` unconditionally overrides any
// `redirect_url` query param, which silently broke the /join →
// artist-welcome flow: even when `SignupCta` passed
// `?redirect_url=/artist-welcome/<slug>` to /sign-up, this page
// force-sent the user to /dashboard anyway.
//
// With only `fallbackRedirectUrl`: /dashboard is still the default,
// but any explicit redirect_url the user arrived with is honored.
// Defense in depth — the /join signup flow now lives on its own
// dedicated route at /sign-up/join/<slug>, but if someone hits
// /sign-up with a redirect_url we respect it rather than ignoring it.
export default function Page() {
  return (
    <SignUp
      signInUrl="/sign-in"
      fallbackRedirectUrl="/dashboard"
    />
  );
}
