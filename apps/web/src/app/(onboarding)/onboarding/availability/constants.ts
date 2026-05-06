import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 4 (availability). NO server-
// only imports — both the Server Component (page.tsx) and the Client
// Component (availability-step-client.tsx) import from here. See
// CLAUDE.md mistake log 2026-04-23 (RSC boundary violation): if the
// client component imports from page.tsx, the bundler transitively
// pulls in page.tsx's server-only deps (auth, fetchUserRole, appRouter
// → next/headers via public-profile.ts) and the build fails.
//
// T8 — step index bumped 3→4; Continue / Skip now route to the new
// /onboarding/payment step (Step 5).

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const AVAILABILITY_STEP_INDEX: 1 | 2 | 3 | 4 | 5 | 6 = 4;

/** H1 displayed by the shell. Pinned by tests + architecture §6. */
export const AVAILABILITY_STEP_TITLE = "When are you open?";

/** Subtitle reassuring producers they don't need to be perfect here. */
export const AVAILABILITY_STEP_SUBTITLE =
  "Set your weekly hours. Tap Continue to save and move on.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "availability";

/** Continue is always enabled on Step 4 — children auto-save on change. */
export const AVAILABILITY_CONTINUE_ALWAYS_ENABLED = true;

/** Step 4 → Step 5 route after Continue. */
export function nextRouteAfterAvailability(): "/onboarding/payment" {
  return "/onboarding/payment";
}

/** Step 4 Skip-ghost-link target — same destination as Continue. */
export function routeOnSkipFromAvailability(): "/onboarding/payment" {
  return "/onboarding/payment";
}

/** Step 4 → Step 3 route for the Back button. */
export function routeOnBackFromAvailability(): "/onboarding/service" {
  return "/onboarding/service";
}
