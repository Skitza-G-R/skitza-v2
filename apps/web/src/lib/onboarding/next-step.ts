import type { OnboardingStep } from "~/app/(onboarding)/onboarding/decide-redirect";

// T8 — Centralised forward-step routing for the 6-step onboarding wizard.
//
//   /onboarding/studio       →  /onboarding/services
//                            →  /onboarding/service
//                            →  /onboarding/availability
//                            →  /onboarding/payment
//                            →  /onboarding/portfolio
//                            →  /onboarding/complete    (completion screen)
//
// Each step page also exports its own `nextRouteAfter*` helper. This
// helper is the single-source-of-truth aliased version, useful when:
//
//   • A test wants to assert the overall sequence in one place rather
//     than across step files.
//   • Future automated tooling (e.g. a "skip remaining steps" admin
//     action) needs to compute the wizard's exit URL from any step.
//   • The Setup-nudge banner needs to deep-link the producer back to
//     wherever they last were without hardcoding.
//
// Pure function — no I/O, no side effects. Tested in next-step.test.ts.

export type NextStepRoute =
  | "/onboarding/services"
  | "/onboarding/service"
  | "/onboarding/availability"
  | "/onboarding/payment"
  | "/onboarding/portfolio"
  | "/onboarding/complete"
  | "/dashboard";

/**
 * Map a wizard step to the URL the wizard advances to next.
 *
 * Step 6 (`portfolio`) is the final data-capture step — its "next" is
 * the completion screen `/onboarding/complete`. The completion screen
 * itself exits the wizard to `/dashboard` when the producer clicks the
 * CTA, but that exit is owned by the page (it's a user click, not a
 * wizard advance), so `complete → /dashboard` lives here for callers
 * that need the absolute terminal URL.
 */
export function nextStepFor(current: OnboardingStep): NextStepRoute {
  switch (current) {
    case "studio":
      return "/onboarding/services";
    case "services":
      return "/onboarding/service";
    case "service":
      return "/onboarding/availability";
    case "availability":
      return "/onboarding/payment";
    case "payment":
      return "/onboarding/portfolio";
    case "portfolio":
      return "/onboarding/complete";
    case "complete":
      return "/dashboard";
  }
}
