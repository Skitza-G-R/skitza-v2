import type { OnboardingStep } from "../decide-redirect";

// Pure constants for the optional post-publish payment-details task.
// NO server-only imports — same RSC-boundary discipline as the other steps.

/** Required by WizardChrome but hidden for this optional post-publish task. */
export const PAYMENT_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 5;

export const PAYMENT_STEP_TITLE = "Payments stay external.";

export const PAYMENT_STEP_SUBTITLE =
  "Artists pay you directly; Skitza does not process or route money.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "payment";

type OptionalCompletionRoute = "/onboarding/complete" | "/onboarding/complete?__preview=1";

function optionalCompletionRoute(previewMode = false): OptionalCompletionRoute {
  return previewMode ? "/onboarding/complete?__preview=1" : "/onboarding/complete";
}

/** Return to the published-page completion screen after saving. */
export function nextRouteAfterPayment(previewMode = false): OptionalCompletionRoute {
  return optionalCompletionRoute(previewMode);
}

/** Skip leaves the optional task without changing anything. */
export function routeOnSkipFromPayment(previewMode = false): OptionalCompletionRoute {
  return optionalCompletionRoute(previewMode);
}

/** Back returns to the same post-publish completion screen. */
export function routeOnBackFromPayment(previewMode = false): OptionalCompletionRoute {
  return optionalCompletionRoute(previewMode);
}
