import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 3 (availability). NO server-
// only imports — both the Server Component (page.tsx) and the Client
// Component (availability-step-client.tsx) import from here. See
// CLAUDE.md mistake log 2026-04-23 (RSC boundary violation): if the
// client component imports from page.tsx, the bundler transitively
// pulls in page.tsx's server-only deps (auth, fetchUserRole, appRouter
// → next/headers via public-profile.ts) and the build fails.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const AVAILABILITY_STEP_INDEX: 1 | 2 | 3 | 4 = 3;

/** H1 displayed by the shell. Pinned by tests + architecture §6. */
export const AVAILABILITY_STEP_TITLE = "When are you open?";

/** Subtitle reassuring producers they don't need to be perfect here. */
export const AVAILABILITY_STEP_SUBTITLE =
  "Set your weekly hours, default session length, and cancellation policy. You can adjust any of this later from Setup.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "availability";

/** Continue is always enabled on Step 3 — children auto-save on change. */
export const AVAILABILITY_CONTINUE_ALWAYS_ENABLED = true;

/** Step 3 → Step 4 route after Continue. */
export function nextRouteAfterAvailability(): "/onboarding/portfolio" {
  return "/onboarding/portfolio";
}

/** Step 3 Skip-ghost-link target — same destination as Continue. */
export function routeOnSkipFromAvailability(): "/onboarding/portfolio" {
  return "/onboarding/portfolio";
}

/** Step 3 → Step 2 route for the Back button. */
export function routeOnBackFromAvailability(): "/onboarding/service" {
  return "/onboarding/service";
}
