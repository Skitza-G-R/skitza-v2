export type ReviewReadinessFacts = {
  product: {
    active: boolean;
    durationMin: number;
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
  const hoursNotNeeded = product.durationMin === 0;
  if (!hoursNotNeeded && availabilityCount === 0) {
    return { ready: false, redirect: "/onboarding/availability" };
  }
  return {
    ready: true,
    hoursNotNeeded,
    alreadyPublished: product.active,
  };
}
