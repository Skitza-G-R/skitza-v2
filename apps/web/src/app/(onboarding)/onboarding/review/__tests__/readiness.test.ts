import { describe, expect, it } from "vitest";

import { reviewReadiness } from "../readiness";

describe("onboarding review readiness", () => {
  it("returns to product setup when no product exists", () => {
    expect(reviewReadiness({ product: null, availabilityCount: 0 })).toEqual({
      ready: false,
      redirect: "/onboarding/service",
    });
  });

  it("requires hours only for a product with bookable sessions", () => {
    expect(
      reviewReadiness({
        product: { active: false, durationMin: 60 },
        availabilityCount: 0,
      }),
    ).toEqual({ ready: false, redirect: "/onboarding/availability" });

    expect(
      reviewReadiness({
        product: { active: false, durationMin: 0 },
        availabilityCount: 0,
      }),
    ).toEqual({
      ready: true,
      hoursNotNeeded: true,
      alreadyPublished: false,
    });
  });

  it("reports a product that is already published", () => {
    expect(
      reviewReadiness({
        product: { active: true, durationMin: 30 },
        availabilityCount: 1,
      }),
    ).toEqual({
      ready: true,
      hoursNotNeeded: false,
      alreadyPublished: true,
    });
  });
});
