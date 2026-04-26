import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 4 (portfolio). NO server-
// only imports — both the Server Component (page.tsx) and the Client
// Component (portfolio-step-client.tsx) import from here. See CLAUDE.md
// mistake log 2026-04-23 (RSC boundary violation): client component
// importing from a Server Component file pulls server-only deps into
// the client bundle and the Vercel build fails.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const PORTFOLIO_STEP_INDEX: 1 | 2 | 3 | 4 = 4;

/** H1 displayed by the shell. */
export const PORTFOLIO_STEP_TITLE = "Show your work.";

/**
 * Subtitle copy. Surfaces the deferred-upload path so Step 4 doesn't
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

/** Continue route — Step 4 is the last step, so Continue exits to /dashboard. */
export function routeOnContinueFromPortfolio(): "/dashboard" {
  return "/dashboard";
}

/** Skip ghost link target — same destination as Continue (telemetry-only divergence). */
export function routeOnSkipFromPortfolio(): "/dashboard" {
  return "/dashboard";
}

/** Step 4 → Step 3 route for the Back button. */
export function routeOnBackFromPortfolio(): "/onboarding/availability" {
  return "/onboarding/availability";
}
