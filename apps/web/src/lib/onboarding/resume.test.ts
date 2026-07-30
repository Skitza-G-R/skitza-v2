import { describe, expect, it } from "vitest";

import { resolveOnboardingResume } from "./resume";

describe("resolveOnboardingResume", () => {
  it("starts with the short welcome when identity is incomplete", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: false,
        firstNonArchivedProduct: null,
        availabilityCount: 0,
      }),
    ).toBe("/onboarding/welcome");
  });

  it("continues to the first product when identity is complete and no product exists", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: true,
        firstNonArchivedProduct: null,
        availabilityCount: 0,
      }),
    ).toBe("/onboarding/service");
  });

  it("requires working hours for a bookable product with no availability", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: true,
        firstNonArchivedProduct: {
          active: false,
          durationMin: 60,
        },
        availabilityCount: 0,
      }),
    ).toBe("/onboarding/availability");
  });

  it("does not treat an already-active bookable product as ready without hours", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: true,
        firstNonArchivedProduct: {
          active: true,
          durationMin: 60,
        },
        availabilityCount: 0,
      }),
    ).toBe("/onboarding/availability");
  });

  it("sends a hidden bookable product with hours to review", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: true,
        firstNonArchivedProduct: {
          active: false,
          durationMin: 60,
        },
        availabilityCount: 1,
      }),
    ).toBe("/onboarding/review");
  });

  it("sends an active bookable product with hours to complete", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: true,
        firstNonArchivedProduct: {
          active: true,
          durationMin: 60,
        },
        availabilityCount: 1,
      }),
    ).toBe("/onboarding/complete");
  });

  it("skips working hours for a hidden non-bookable product", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: true,
        firstNonArchivedProduct: {
          active: false,
          durationMin: 0,
        },
        availabilityCount: 0,
      }),
    ).toBe("/onboarding/review");
  });

  it("skips working hours for an active non-bookable product", () => {
    expect(
      resolveOnboardingResume({
        identityComplete: true,
        firstNonArchivedProduct: {
          active: true,
          durationMin: 0,
        },
        availabilityCount: 0,
      }),
    ).toBe("/onboarding/complete");
  });
});
