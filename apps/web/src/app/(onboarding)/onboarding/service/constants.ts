import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 2 (service / "First service").
// NO server-only imports — both page.tsx (server) and the client
// component import from here. The split avoids an RSC boundary
// violation: when the client bundle imports from page.tsx, the
// bundler transitively pulls in page.tsx's server-only deps. Extracting
// the pure exports here breaks that transitivity.
//
// May 2026 redesign — was Step 3 of 6 in the legacy flow; now Step 2
// of 5 because the legacy /services chip-multi-select step is dropped
// (Decision #4: drop service_roles entirely).

/** 1-indexed outer milestone. The seven Store steps replace this rail while open. */
export const SERVICE_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 3;

export const SERVICE_STEP_TITLE = "Create your first product.";

export const SERVICE_STEP_SUBTITLE =
  "Use the same seven steps as Store. It stays hidden until your final review.";

/** OnboardingStep tag — drives decideOnboardingRedirect at the layout. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "service";

/** A session product needs working hours before review. */
export function nextRouteAfterService(): "/onboarding/availability" {
  return "/onboarding/availability";
}

/** Product → public identity. */
export function routeOnBackFromService(): "/onboarding/studio" {
  return "/onboarding/studio";
}
