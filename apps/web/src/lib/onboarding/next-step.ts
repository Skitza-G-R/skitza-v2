import type { OnboardingStep } from "~/app/(onboarding)/onboarding/decide-redirect";

// Centralised forward-step routing for the producer onboarding wizard.
//
// May 2026 redesign — the legacy /services chip-multi-select step is
// dropped (Decision #4: drop service_roles entirely), and portfolio
// is reordered BEFORE payment. New flow:
//
//   /onboarding/studio       →  /onboarding/service
//                            →  /onboarding/availability
//                            →  /onboarding/portfolio
//                            →  /onboarding/payment
//                            →  /onboarding/complete
//
// "services" remains in the OnboardingStep type for back-compat
// (legacy URLs in old emails / bookmarks may still hit it), but
// nextStepFor("services") falls through to /onboarding/service so
// the redirect path is graceful.
//
// Each step page also exports its own `nextRouteAfter*` helper. This
// helper is the single-source-of-truth aliased version, useful when:
//
//   • A test wants to assert the overall sequence in one place.
//   • Future automated tooling (e.g. a "skip remaining steps" admin
//     action) needs to compute the wizard's exit URL from any step.
//   • The Setup-nudge banner needs to deep-link the producer back to
//     wherever they last were without hardcoding.
//
// Pure function — no I/O, no side effects. Tested in next-step.test.ts.

export type NextStepRoute =
  | "/onboarding/welcome"
  | "/onboarding/studio"
  | "/onboarding/service"
  | "/onboarding/availability"
  | "/onboarding/portfolio"
  | "/onboarding/payment"
  | "/onboarding/complete"
  | "/dashboard";

/**
 * Map a wizard step to the URL the wizard advances to next.
 *
 * `complete` is the terminal data-capture step before the celebration
 * screen; the celebration screen exits to `/dashboard` when the
 * producer clicks the CTA, but that exit is owned by the page (it's
 * a user click, not a wizard advance).
 */
export function nextStepFor(current: OnboardingStep): NextStepRoute {
  switch (current) {
    case "studio":
      return "/onboarding/service";
    case "services":
      // Back-compat: legacy URL bookmarks land on /services, which
      // redirects forward to /service (the redesign collapses both
      // into the single template-picker step).
      return "/onboarding/service";
    case "service":
      return "/onboarding/availability";
    case "availability":
      return "/onboarding/portfolio";
    case "portfolio":
      return "/onboarding/payment";
    case "payment":
      return "/onboarding/complete";
    case "complete":
      return "/dashboard";
  }
}
