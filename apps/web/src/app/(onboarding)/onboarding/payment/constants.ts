import type { OnboardingStep } from "../decide-redirect";

// Pure constants for Step 5 (payment / "Get paid"). NO server-only
// imports — same RSC-boundary discipline as the other steps.
//
// May 2026 redesign — was Step 5 of 6 in the legacy flow; now Step 5
// of 5 (rail position unchanged). Routing changed: Back goes to
// /onboarding/portfolio (was /availability), Continue goes to
// /onboarding/complete (was /portfolio). Payment is still a v1
// placeholder — the cards + buttons are inert until Stripe Connect
// ships per PRD.

/** 1-indexed rail position. Pinned by tests. */
export const PAYMENT_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 5;

export const PAYMENT_STEP_TITLE = "Get paid directly.";

export const PAYMENT_STEP_SUBTITLE =
  "Pick a payout method. Skip and connect later from Settings.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "payment";

/** Step 5 → completion screen. */
export function nextRouteAfterPayment(): "/onboarding/complete" {
  return "/onboarding/complete";
}

/** Step 5 Skip target — same as Continue. */
export function routeOnSkipFromPayment(): "/onboarding/complete" {
  return "/onboarding/complete";
}

/** Step 5 → Step 4 route for the Back button. */
export function routeOnBackFromPayment(): "/onboarding/portfolio" {
  return "/onboarding/portfolio";
}
