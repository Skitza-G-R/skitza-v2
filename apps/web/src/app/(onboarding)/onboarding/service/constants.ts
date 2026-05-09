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

/** 1-indexed rail position. Pinned by tests. */
export const SERVICE_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 2;

export const SERVICE_STEP_TITLE = "Pick your first service.";

export const SERVICE_STEP_SUBTITLE =
  "Pick a starter, tweak the price, you're done. Add more later.";

/** OnboardingStep tag — drives decideOnboardingRedirect at the layout. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "service";

/** Step 2 → Step 3 route. */
export function nextRouteAfterService(): "/onboarding/availability" {
  return "/onboarding/availability";
}

/** Step 2 Skip target — same destination as Continue (no save needed). */
export function routeOnSkipFromService(): "/onboarding/availability" {
  return "/onboarding/availability";
}

/** Step 2 → Step 1 route for the Back button (was /services in legacy). */
export function routeOnBackFromService(): "/onboarding/studio" {
  return "/onboarding/studio";
}
