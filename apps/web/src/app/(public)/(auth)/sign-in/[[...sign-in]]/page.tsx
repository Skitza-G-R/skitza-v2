import { SignIn } from "@clerk/nextjs";

// Sign-in surface.
//
// 2026-05-06 — Removed BOTH `forceRedirectUrl` and
// `fallbackRedirectUrl` (prior values were both `/dashboard`).
// Pre-fix, every signed-in user hit /dashboard regardless of role —
// artists got a producer-dashboard flash before the role gate kicked
// them to /artist. Now: post-sign-in routing is centralized at
// /post-signin, configured via the Clerk dashboard's "After sign-in
// fallback" setting. The role resolver picks the role-correct
// destination once, with no flash.
//
// Why both props had to go: `forceRedirectUrl` overrode any
// `redirect_url` query param AND any dashboard setting; even if the
// dashboard had been set to /post-signin, Clerk applied the prop
// instead. Removing both props lets the dashboard config own the
// destination.
export default function Page() {
  return <SignIn signUpUrl="/sign-up" />;
}
