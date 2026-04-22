import type { UserRole } from "~/server/auth/role";

// Routing policy for `/artist-welcome` (the no-slug orphan welcome).
//
// Added 2026-04-22 after Gili's manual QA. Before this the page was a
// static Server Component with no role check — so any authed user
// landing here (via layout redirect race, browser back button, a
// reload while the webhook was pending) saw the "ask a producer for
// a link" copy even when their account was fully provisioned.
//
// The page's purpose is to greet TRULY orphan authed users (webhook
// delivery failed or still in flight AND no pre-existing contacts).
// Everyone else should be bounced to their actual destination.
//
// Tested in __tests__/decide-redirect.test.ts.

export type ArtistWelcomeRedirect =
  | "/sign-in"
  | "/artist"
  | "/onboarding"
  | "/dashboard"
  | null; // null = render the orphan welcome copy

export function decideArtistWelcomeRedirect(
  role: UserRole,
): ArtistWelcomeRedirect {
  switch (role.kind) {
    case "unauthenticated":
      return "/sign-in";
    case "artist":
      return "/artist";
    case "producer-incomplete":
      return "/onboarding";
    case "producer-complete":
      return "/dashboard";
    case "orphan":
      return null;
  }
}
