import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 4 (portfolio / "A taste").
// NO server-only imports — both page.tsx (server) and the client
// component import from here.
//
// May 2026 redesign — was Step 6 of 6 in the legacy flow; now
// Step 4 of 5 (redesign reorders: portfolio sits BEFORE payment so
// the producer leaves the wizard with a "show your work" capture
// already in hand).

/** 1-indexed rail position. Pinned by tests. */
export const PORTFOLIO_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 4;

export const PORTFOLIO_STEP_TITLE = "A taste of your work.";

/**
 * Subtitle copy. Surfaces the deferred-upload path so Step 4 doesn't
 * feel incomplete (track-upload widget is deferred per Decision #3 —
 * schema FK blocker on track_versions → projectTracks; producers
 * upload via Setup → Portfolio for now).
 */
export const PORTFOLIO_STEP_SUBTITLE =
  "Add a few links so artists know your sound. Optional — skip if you'd rather.";

/** Helper copy rendered above the link inputs. */
export const PORTFOLIO_HELPER_COPY =
  "All optional. Fill what you have, skip what you don't.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "portfolio";

/**
 * Continue route — redesign reorders Step 4 → Step 5 (payment).
 * Was /onboarding/complete in the legacy flow.
 */
export function routeOnContinueFromPortfolio(): "/onboarding/payment" {
  return "/onboarding/payment";
}

/** Skip ghost link target — same as Continue (telemetry-only divergence). */
export function routeOnSkipFromPortfolio(): "/onboarding/payment" {
  return "/onboarding/payment";
}

/** Step 4 → Step 3 route for the Back button. */
export function routeOnBackFromPortfolio(): "/onboarding/availability" {
  return "/onboarding/availability";
}
