import { SignUp } from "@clerk/nextjs";

// Default sign-up surface. Used by:
//   - /join/<slug> CTA → routes to the sibling /sign-up/join/<slug>
//     (NOT this page) so it can attach unsafeMetadata.
//   - Direct /sign-up visits + landing-page CTAs.
//
// 2026-05-06 — Removed `fallbackRedirectUrl` (prior value
// `/dashboard`). Post-auth routing is now centralized at /post-signup,
// configured in the Clerk dashboard's "After sign-up fallback"
// setting. Keeping a component-level fallback here would drift from
// the dashboard config — and Clerk applies the dashboard value first,
// so the prop was already a no-op in production. Removing it makes
// the routing surface match what's actually live.
//
// 2026-04-22 — `forceRedirectUrl` was dropped earlier (audit Task 15)
// because it overrode the /join → artist-welcome flow's redirect
// query param. The current shape (no forceRedirectUrl + no
// fallbackRedirectUrl) lets the dashboard config own the destination.
export default function Page() {
  return <SignUp signInUrl="/sign-in" />;
}
