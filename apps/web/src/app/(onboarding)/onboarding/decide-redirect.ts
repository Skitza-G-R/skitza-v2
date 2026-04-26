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
// Story 04 (2026-04-25) — Step-aware extension.
//
// The 4-step rebuild lives at /onboarding/{studio,service,availability,
// portfolio}. After Step 1 commits, the producer becomes "complete"
// (display name + slug set), but they're still mid-flow on Steps 2-4
// in the same session. So the redirect rule for "complete" must
// depend on which step they're hitting:
//
//   producer-complete on /onboarding/studio  → /dashboard (no Step-1 loop)
//   producer-complete on /onboarding/{2,3,4} → null      (let them finish)
//
// Symmetrically, an "incomplete" or "orphan" deep-linking past Step 1
// hasn't done the studio capture yet — bounce them back to the start
// so the slug + display name are guaranteed before any further writes:
//
//   producer-incomplete or orphan on /onboarding/studio → null (render)
//   producer-incomplete or orphan on /onboarding/{2,3,4} → /onboarding/studio
//
// Artist + unauthenticated rules don't depend on step — the role wall
// fires the same redirect for every URL inside (onboarding).
//
// The default arg `currentStep = "studio"` preserves backward compat
// with single-arg callers (notably the layout's role gate, which has
// not been updated to read the path yet — done in a follow-up so the
// existing 5-test suite keeps passing without modification).
//
// Tested separately in __tests__/decide-redirect.test.ts.

export type OnboardingRedirect =
  | "/sign-in"
  | "/artist"
  | "/dashboard"
  | "/onboarding/studio"
  | null; // null means "render the wizard"

export type OnboardingStep =
  | "studio"
  | "service"
  | "availability"
  | "portfolio";

const STEP_NAMES: readonly OnboardingStep[] = [
  "studio",
  "service",
  "availability",
  "portfolio",
];

/**
 * Map a request pathname to the OnboardingStep tag the layout should
 * use when calling decideOnboardingRedirect. The layout reads the
 * pathname from the `x-pathname` request header (forwarded by
 * middleware on /onboarding/* — see middleware.ts).
 *
 * The match is "starts-with" rather than "equals" so trailing slashes
 * and query strings don't bypass the step check. Anything that doesn't
 * match a known step (most notably the bare `/onboarding` index)
 * defaults to "studio" — that route only redirects (page.tsx redirects
 * to /onboarding/studio), so the default is harmless there. Callers
 * passing null/undefined (e.g. local-dev edge case where middleware
 * didn't run) also fall back to "studio".
 *
 * Pinned by unit tests in __tests__/decide-redirect.test.ts so that
 * the path-to-step mapping is locked separately from the routing
 * matrix.
 */
export function stepFromPath(
  pathname: string | null | undefined,
): OnboardingStep {
  if (!pathname) return "studio";
  for (const step of STEP_NAMES) {
    if (pathname.startsWith(`/onboarding/${step}`)) return step;
  }
  return "studio";
}

export function decideOnboardingRedirect(
  role: UserRole,
  currentStep: OnboardingStep = "studio",
): OnboardingRedirect {
  switch (role.kind) {
    case "unauthenticated":
      return "/sign-in";
    case "artist":
      return "/artist";
    case "producer-complete":
      // Fully-onboarded producers belong on /dashboard if they hit the
      // studio (Step 1) URL — re-doing Step 1 makes no product sense.
      // Steps 2-4 must render, however, because that's how a producer
      // who just finished Step 1 in the same tab continues the flow.
      return currentStep === "studio" ? "/dashboard" : null;
    case "producer-incomplete":
    case "orphan":
      // Step 1 (studio) renders for both incomplete and orphan — the
      // form's UPSERT is idempotent so a webhook race that hasn't yet
      // produced a producers row is no problem. Any deep-link past
      // Step 1 (service / availability / portfolio) bounces back to
      // studio so the producers row exists before downstream writes.
      return currentStep === "studio" ? null : "/onboarding/studio";
  }
}
