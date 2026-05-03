import type { OnboardingStep } from "../decide-redirect";

// Pure constants for Step 5 (payment). NO server-only imports — same
// RSC-boundary discipline as the other steps.
//
// T8 — payment is a placeholder step in v1: the card + button are
// disabled until Stripe Connect ships. Skip and Continue both forward
// to portfolio without any write. Keeping the shape symmetric with the
// other steps means swapping in a real connect button later is a
// surgical change, not a refactor.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const PAYMENT_STEP_INDEX: 1 | 2 | 3 | 4 | 5 | 6 = 5;

export const PAYMENT_STEP_TITLE = "Connect your payment provider.";

export const PAYMENT_STEP_SUBTITLE =
  "Get paid directly through Skitza. Skip this and connect later from Settings.";

/** OnboardingStep tag — drives decideOnboardingRedirect at the page guard. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "payment";

/** Step 5 → Step 6 route. Continue = Skip in v1 (placeholder). */
export function nextRouteAfterPayment(): "/onboarding/portfolio" {
  return "/onboarding/portfolio";
}

/** Step 5 Skip-ghost-link target — same as Continue. */
export function routeOnSkipFromPayment(): "/onboarding/portfolio" {
  return "/onboarding/portfolio";
}

/** Step 5 → Step 4 route for the Back button. */
export function routeOnBackFromPayment(): "/onboarding/availability" {
  return "/onboarding/availability";
}
