import { redirect } from "next/navigation";

// May 2026 redesign — /onboarding now redirects to /onboarding/welcome
// (the new pre-step entry screen) instead of straight to
// /onboarding/studio. Welcome sets expectations ("about 2 minutes ·
// 5 short steps · come back later") before the producer commits.
//
// The (onboarding)/layout.tsx role gate runs first, so unauthorised
// or already-complete producers never reach this redirect; only
// producer-incomplete + orphan callers fall through to /onboarding/welcome.
export default function OnboardingIndexPage() {
  redirect("/onboarding/welcome");
}
