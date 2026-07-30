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
    bookingEnabled: boolean;
  } | null;
  availabilityCount: number;
};

/**
 * Resolve the next producer-onboarding screen from durable product facts.
 *
 * Unsaved form state deliberately does not participate here. A product with
 * bookingEnabled is the persisted source of truth for whether availability is
 * required. Duration alone cannot tell us whether artists may self-book.
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

  const needsAvailability = firstNonArchivedProduct.bookingEnabled;
  if (needsAvailability && availabilityCount === 0) {
    return "/onboarding/availability";
  }

  return firstNonArchivedProduct.active ? "/onboarding/complete" : "/onboarding/review";
}
