import type { OnboardingStep } from "../decide-redirect";

// Pure constants for Step 2 (services — multi-select chip step). NO
// server-only imports; same RSC-boundary discipline as the other steps.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const SERVICES_STEP_INDEX: 1 | 2 | 3 | 4 | 5 | 6 = 2;

export const SERVICES_STEP_TITLE = "What do you offer?";

export const SERVICES_STEP_SUBTITLE =
  "Select everything that applies. We'll suggest the right templates next.";

/** OnboardingStep tag — drives decideOnboardingRedirect at the page guard. */
export const ONBOARDING_STEP_NAME: OnboardingStep = "services";

/**
 * 6 multi-select role chips. The label is what producers see; the
 * value is what we persist on producers.service_roles. Slugs are
 * lowercase + underscored to keep the array stable across UI edits.
 */
export const SERVICE_ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "producer", label: "Producer" },
  { value: "mixing_engineer", label: "Mixing Engineer" },
  { value: "mastering_engineer", label: "Mastering Engineer" },
  { value: "recording_artist", label: "Recording Artist" },
  { value: "songwriter", label: "Songwriter" },
  { value: "audio_engineer", label: "Audio Engineer" },
];

/** Continue is allowed once at least one chip is selected. */
export function isContinueAllowed(selected: ReadonlyArray<string>): boolean {
  return selected.length >= 1;
}

/** Step 2 → Step 3 route after a successful saveServiceRoles. */
export function nextRouteAfterServices(): "/onboarding/service" {
  return "/onboarding/service";
}

/** Step 2 Skip-ghost-link target — same destination as Continue (empty save). */
export function routeOnSkipFromServices(): "/onboarding/service" {
  return "/onboarding/service";
}

/** Step 2 → Step 1 route for the Back button. */
export function routeOnBackFromServices(): "/onboarding/studio" {
  return "/onboarding/studio";
}
