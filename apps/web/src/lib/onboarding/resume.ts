export type OnboardingResumeRoute =
  | "/onboarding/welcome"
  | "/onboarding/studio"
  | "/onboarding/service"
  | "/onboarding/availability"
  | "/onboarding/review"
  | "/onboarding/complete";

export type OnboardingResumeFacts = {
  identityComplete: boolean;
  firstNonArchivedProduct: {
    active: boolean;
    durationMin: number;
  } | null;
  availabilityCount: number;
};

/**
 * Resolve the next producer-onboarding screen from durable product facts.
 *
 * Unsaved form state deliberately does not participate here. A product with
 * durationMin === 0 has no bookable sessions, so availability is not required.
 */
export function resolveOnboardingResume({
  identityComplete,
  firstNonArchivedProduct,
  availabilityCount,
}: OnboardingResumeFacts): OnboardingResumeRoute {
  if (!identityComplete) {
    return "/onboarding/welcome";
  }

  if (!firstNonArchivedProduct) {
    return "/onboarding/service";
  }

  const needsAvailability = firstNonArchivedProduct.durationMin > 0;
  if (needsAvailability && availabilityCount === 0) {
    return "/onboarding/availability";
  }

  return firstNonArchivedProduct.active ? "/onboarding/complete" : "/onboarding/review";
}
