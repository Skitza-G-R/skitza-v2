export type ReviewReadinessFacts = {
  product: {
    active: boolean;
    bookingEnabled: boolean;
  } | null;
  availabilityCount: number;
};

export type ReviewReadiness =
  | { ready: false; redirect: "/onboarding/service" | "/onboarding/availability" }
  | { ready: true; hoursNotNeeded: boolean; alreadyPublished: boolean };

export function reviewReadiness({
  product,
  availabilityCount,
}: ReviewReadinessFacts): ReviewReadiness {
  if (!product) {
    return { ready: false, redirect: "/onboarding/service" };
  }
  const hoursNotNeeded = !product.bookingEnabled;
  if (!hoursNotNeeded && availabilityCount === 0) {
    return { ready: false, redirect: "/onboarding/availability" };
  }
  return {
    ready: true,
    hoursNotNeeded,
    alreadyPublished: product.active,
  };
}
