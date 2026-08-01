import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for the post-publish portfolio task.
// NO server-only imports — both page.tsx (server) and the client component
// import from here.

/** Required by WizardChrome but hidden for this optional post-publish task. */
export const PORTFOLIO_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 4;

export const PORTFOLIO_STEP_TITLE = "Show artists your work.";

export const PORTFOLIO_STEP_SUBTITLE =
  "Your public page is already ready. Add a few links now, or come back later.";

/** Helper copy rendered above the link inputs. */
export const PORTFOLIO_HELPER_COPY = "All optional. Fill what you have, skip what you don't.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "portfolio";

type OptionalCompletionRoute = "/onboarding/complete" | "/onboarding/complete?__preview=1";

function optionalCompletionRoute(previewMode = false): OptionalCompletionRoute {
  return previewMode ? "/onboarding/complete?__preview=1" : "/onboarding/complete";
}

/** Return to the published-page completion screen after saving. */
export function routeOnContinueFromPortfolio(previewMode = false): OptionalCompletionRoute {
  return optionalCompletionRoute(previewMode);
}

/** Skip leaves the optional task without changing anything. */
export function routeOnSkipFromPortfolio(previewMode = false): OptionalCompletionRoute {
  return optionalCompletionRoute(previewMode);
}

/** Back returns to the same post-publish completion screen. */
export function routeOnBackFromPortfolio(previewMode = false): OptionalCompletionRoute {
  return optionalCompletionRoute(previewMode);
}
