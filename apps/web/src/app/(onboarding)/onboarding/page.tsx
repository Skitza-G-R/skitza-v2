import { redirect } from "next/navigation";

// Story 03 — /onboarding now redirects to /onboarding/studio (Step 1
// of the 4-step wizard). The previous single-screen page (display
// name + slug + currency + timezone all on one form) was replaced by
// a per-step flow:
//   /onboarding/studio       — Step 1: display name (this redirect)
//   /onboarding/service      — Step 2 (Story 04)
//   /onboarding/availability — Step 3 (Story 05)
//   /onboarding/portfolio    — Step 4 (Story 08)
//
// The (onboarding)/layout.tsx role gate runs first, so unauthorised
// or already-complete producers never reach this redirect; only
// producer-incomplete + orphan callers fall through to /onboarding/studio.
export default function OnboardingIndexPage() {
  redirect("/onboarding/studio");
}
