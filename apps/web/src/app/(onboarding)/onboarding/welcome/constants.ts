// Pure constants + helpers for Step 0 (Welcome). NO server-only
// imports — same RSC-boundary discipline as the other steps so the
// constants can be imported by both the server page module and the
// client component without a "use client" hop.
//
// Welcome is the context-set screen introduced by the May 2026 redesign.
// It sits BEFORE Step 1 and is NOT counted in the shell's "Step N of 6"
// numbering — that's why this file deliberately does not export a
// WELCOME_STEP_INDEX.

/**
 * Route the "Start setting up" CTA navigates to. Welcome is purely
 * presentational; advancing means jumping to Step 1 (studio).
 */
export function nextRouteAfterWelcome(): "/onboarding/studio" {
  return "/onboarding/studio";
}
