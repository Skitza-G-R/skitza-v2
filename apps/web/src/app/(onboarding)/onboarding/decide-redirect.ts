import type { UserRole } from "~/server/auth/role";

// Routing policy for the /onboarding producer wizard.
//
// Added 2026-04-22 as part of audit Task 16 (strict role isolation).
// Before this, (onboarding)/layout.tsx ran no role check — so an
// artist could bypass (app)/layout.tsx by typing /onboarding directly
// and land on the producer wizard. This pure function encodes the
// mapping from UserRole → redirect target (or null = render).
//
// Decisions baked in (confirmed with Gili 2026-04-22):
//   - Q1: "producer-complete" → /dashboard (fully-onboarded producers
//         have no business on /onboarding — Settings is for re-edits)
//   - Core fix: "artist" → /artist (the hard wall)
//   - "orphan" → null/render (webhook race; action is idempotent)
//
// Tested separately in __tests__/decide-redirect.test.ts.

export type OnboardingRedirect =
  | "/sign-in"
  | "/artist"
  | "/dashboard"
  | null; // null means "render the wizard"

export function decideOnboardingRedirect(role: UserRole): OnboardingRedirect {
  switch (role.kind) {
    case "unauthenticated":
      return "/sign-in";
    case "artist":
      return "/artist";
    case "producer-complete":
      return "/dashboard";
    case "producer-incomplete":
    case "orphan":
      return null;
  }
}
