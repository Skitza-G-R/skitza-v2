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
        product: { active: false, bookingEnabled: true },
        availabilityCount: 0,
      }),
    ).toEqual({ ready: false, redirect: "/onboarding/availability" });

    expect(
      reviewReadiness({
        product: { active: false, bookingEnabled: false },
        availabilityCount: 0,
      }),
    ).toEqual({
      ready: true,
      hoursNotNeeded: true,
      alreadyPublished: false,
    });
  });

  it("uses bookingEnabled even when legacy duration data disagrees", () => {
    const bookingDisabledWithDuration = {
      active: false,
      bookingEnabled: false,
      durationMin: 60,
    };
    const bookingEnabledWithoutDuration = {
      active: false,
      bookingEnabled: true,
      durationMin: 0,
    };

    expect(
      reviewReadiness({
        product: bookingDisabledWithDuration,
        availabilityCount: 0,
      }),
    ).toEqual({
      ready: true,
      hoursNotNeeded: true,
      alreadyPublished: false,
    });

    expect(
      reviewReadiness({
        product: bookingEnabledWithoutDuration,
        availabilityCount: 0,
      }),
    ).toEqual({ ready: false, redirect: "/onboarding/availability" });
  });

  it("reports a product that is already published", () => {
    expect(
      reviewReadiness({
        product: { active: true, bookingEnabled: true },
        availabilityCount: 1,
      }),
    ).toEqual({
      ready: true,
      hoursNotNeeded: false,
      alreadyPublished: true,
    });
  });
});
