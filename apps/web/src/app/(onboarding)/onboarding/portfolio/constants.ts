import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 6 (portfolio). NO server-
// only imports — both the Server Component (page.tsx) and the Client
// Component (portfolio-step-client.tsx) import from here. See CLAUDE.md
// mistake log 2026-04-23 (RSC boundary violation).
//
// T8 — step index bumped 4→6; Continue / Skip now route to the new
// /onboarding/complete completion screen; Back hops to /onboarding/payment.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const PORTFOLIO_STEP_INDEX: 1 | 2 | 3 | 4 | 5 | 6 = 6;

/** H1 displayed by the shell. */
export const PORTFOLIO_STEP_TITLE = "Show your work.";

/**
 * Subtitle copy. Surfaces the deferred-upload path so Step 6 doesn't
 * feel incomplete (track-upload widget was deferred — schema FK blocker
 * on track_versions → projectTracks; producers upload via Setup →
 * Portfolio for now).
 */
export const PORTFOLIO_STEP_SUBTITLE =
  "Add your streaming links — you can upload tracks later from Setup → Portfolio.";

/** Helper copy rendered above the link inputs. */
export const PORTFOLIO_HELPER_COPY =
  "All three are optional — fill what you have, skip what you don't.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "portfolio";

/** Continue route — Step 6 hands off to the completion screen. */
export function routeOnContinueFromPortfolio(): "/onboarding/complete" {
  return "/onboarding/complete";
}

/** Skip ghost link target — same destination as Continue (telemetry-only divergence). */
export function routeOnSkipFromPortfolio(): "/onboarding/complete" {
  return "/onboarding/complete";
}

/** Step 6 → Step 5 route for the Back button. */
export function routeOnBackFromPortfolio(): "/onboarding/payment" {
  return "/onboarding/payment";
}
