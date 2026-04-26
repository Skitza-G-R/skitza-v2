import type { OnboardingStep } from "~/app/(onboarding)/onboarding/decide-redirect";

// Story 09 — Centralised forward-step routing for the onboarding wizard.
//
// The 4-step wizard is a strict linear flow:
//
//   /onboarding/studio  →  /onboarding/service
//                       →  /onboarding/availability
//                       →  /onboarding/portfolio
//                       →  /dashboard            (end of wizard)
//
// Each step page already exports its own `nextRouteAfter*` helper
// (Story 04 onwards) — those still exist and are still used by their
// respective client components. This helper is the single-source-of-
// truth aliased version, useful when:
//
//   • A test wants to assert the overall sequence in one place rather
//     than across 4 step files.
//   • Future automated tooling (e.g. a "skip remaining steps" admin
//     action) needs to compute the wizard's exit URL from any step.
//   • The Setup-nudge banner (PRD §4.1) needs to deep-link the
//     producer back to "wherever they last were" without hardcoding.
//
// Pure function — no I/O, no side effects, no branch on environment.
// Tested in next-step.test.ts.
//
// Why the return type is a string-literal union: TypeScript's stricter
// inference catches typos at compile time. Renaming a step in the
// OnboardingStep type forces a corresponding update here, which the
// test suite then verifies.

export type NextStepRoute =
  | "/onboarding/service"
  | "/onboarding/availability"
  | "/onboarding/portfolio"
  | "/dashboard";

/**
 * Map a wizard step to the URL the wizard advances to next.
 *
 * Step 4 (`portfolio`) is the final step — its "next" is `/dashboard`,
 * which is the wizard's exit. This is also where Skip-from-Step-4 ends
 * up, since Skip and Continue share the destination at the last step
 * (the difference is telemetry, not routing — see story 08).
 */
export function nextStepFor(current: OnboardingStep): NextStepRoute {
  switch (current) {
    case "studio":
      return "/onboarding/service";
    case "service":
      return "/onboarding/availability";
    case "availability":
      return "/onboarding/portfolio";
    case "portfolio":
      return "/dashboard";
  }
}
