import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 3 (availability / "When you
// work"). May 2026 redesign — was Step 4 of 6 in the legacy flow;
// now Step 3 of 5.
//
// NO server-only imports — both page.tsx (server) and the client
// component import from here. Same RSC-boundary discipline as the
// other step constants.

/** 1-indexed rail position. Pinned by tests. */
export const AVAILABILITY_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 4;

export const AVAILABILITY_STEP_TITLE = "When should artists be able to book you?";

export const AVAILABILITY_STEP_SUBTITLE =
  "Set your weekly hours. You can edit them anytime from Calendar.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "availability";

/** Continue is gated until at least one valid confirmed window exists. */
export const AVAILABILITY_CONTINUE_ALWAYS_ENABLED = false;

/**
 * Step 3 → Step 4 route. Redesign reorders portfolio BEFORE payment
 * (was payment → portfolio in legacy), so availability now advances
 * to /onboarding/portfolio.
 */
export function nextRouteAfterAvailability(): "/onboarding/review" {
  return "/onboarding/review";
}

/** Skip leaves required hours unfinished so the producer can resume later. */
export function routeOnSkipFromAvailability(): "/dashboard" {
  return "/dashboard";
}

/** Step 3 → Step 2 route for the Back button. */
export function routeOnBackFromAvailability(): "/onboarding/service" {
  return "/onboarding/service";
}
