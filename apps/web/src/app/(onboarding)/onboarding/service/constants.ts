import type { OnboardingStep } from "../decide-redirect";

// Pure constants + route helpers for Step 2 (service). NO server-only
// imports — both the Server Component (page.tsx) and the Client
// Component (service-step-client.tsx) import from here. The split
// avoids a Next.js RSC boundary violation: when the client bundle
// imports from page.tsx, the bundler transitively pulls in page.tsx's
// server-only deps (auth, fetchUserRole, appRouter → next/headers via
// public-profile.ts). Extracting the pure exports here breaks that
// transitivity. See CLAUDE.md mistake log 2026-04-23 (RSC boundary
// violation) for the same class of bug.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const SERVICE_STEP_INDEX: 1 | 2 | 3 | 4 = 2;

/** H1 displayed by the shell. Pinned by tests + architecture §6. */
export const SERVICE_STEP_TITLE = "Add your first service.";

/** Subtitle copy. Reassures the producer this isn't a final decision. */
export const SERVICE_STEP_SUBTITLE =
  "Sketch out one of your services so clients can book. You can edit it later or add more from Setup.";

/** OnboardingStep tag for this page — used by decideOnboardingRedirect. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "service";

/** Step 2 → Step 3 route after a successful createPackage. */
export function nextRouteAfterService(): "/onboarding/availability" {
  return "/onboarding/availability";
}

/** Step 2 Skip-ghost-link target — same destination as Continue. */
export function routeOnSkipFromService(): "/onboarding/availability" {
  return "/onboarding/availability";
}
