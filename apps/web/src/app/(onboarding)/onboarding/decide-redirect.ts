import type { UserRole } from "~/server/auth/role";

// Role wall for producer onboarding. Identity completion unlocks the
// dashboard, but it does not lock the producer out of onboarding: every
// completed producer step remains available for exact resume and back/edit.

export type OnboardingRedirect = "/sign-in" | "/artist" | "/onboarding/studio" | null; // null means "render the wizard"

export type OnboardingStep =
  | "studio"
  | "services"
  | "service"
  | "availability"
  | "payment"
  | "portfolio"
  | "complete";

// Guard-only destinations can be added without changing the legacy
// forward-navigation switch that still consumes OnboardingStep.
export type OnboardingGuardStep = OnboardingStep | "review";

// T8 — order matters for stepFromPath. "services" must come before
// "service" because /onboarding/services starts with /onboarding/service
// — without this ordering the prefix match would resolve "services" to
// "service" and the step-aware redirect would mis-classify the page.
const STEP_NAMES: readonly OnboardingGuardStep[] = [
  "studio",
  "services",
  "service",
  "availability",
  "review",
  "payment",
  "portfolio",
  "complete",
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
export function stepFromPath(pathname: string | null | undefined): OnboardingGuardStep {
  if (!pathname) return "studio";
  for (const step of STEP_NAMES) {
    if (pathname.startsWith(`/onboarding/${step}`)) return step;
  }
  return "studio";
}

export function decideOnboardingRedirect(
  role: UserRole,
  currentStep: OnboardingGuardStep = "studio",
): OnboardingRedirect {
  switch (role.kind) {
    case "unauthenticated":
      return "/sign-in";
    case "artist":
      return "/artist";
    case "producer-complete":
      return null;
    case "producer-incomplete":
    case "orphan":
      return currentStep === "studio" ? null : "/onboarding/studio";
  }
}
