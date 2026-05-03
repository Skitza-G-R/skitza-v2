import { describe, expect, it } from "vitest";

import {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_TITLE,
  SERVICE_STEP_SUBTITLE,
  nextRouteAfterService,
  routeOnBackFromService,
  routeOnSkipFromService,
  ONBOARDING_STEP_NAME,
} from "../page";

// Step 3 (service) page contract. T8 bumped index 2 → 3 (services
// chip step now sits between studio and service). Repo runs vitest in
// `node` env (no jsdom) so we pin pure constants + helpers, no JSX.

describe("Step 3 (service) page contract", () => {
  describe("constants", () => {
    it("renders as Step 3 of the 6-step shell", () => {
      expect(SERVICE_STEP_INDEX).toBe(3);
    });

    it("uses the architecture-mandated title 'Add your first service.'", () => {
      expect(SERVICE_STEP_TITLE).toBe("Add your first service.");
    });

    it("subtitle stays welcoming (mentions reversibility / freedom to skip)", () => {
      expect(SERVICE_STEP_SUBTITLE.toLowerCase()).toMatch(/later|skip|change|edit/);
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      expect(ONBOARDING_STEP_NAME).toBe("service");
    });
  });

  describe("nextRouteAfterService (form-success advance)", () => {
    it("routes to Step 4 (/onboarding/availability) after createPackage succeeds", () => {
      expect(nextRouteAfterService()).toBe("/onboarding/availability");
    });
  });

  describe("routeOnSkipFromService (Skip ghost link)", () => {
    it("advances to /onboarding/availability without saving", () => {
      expect(routeOnSkipFromService()).toBe("/onboarding/availability");
    });

    it("targets the same destination as the form-success route (one path forward)", () => {
      expect(routeOnSkipFromService()).toBe(nextRouteAfterService());
    });
  });

  describe("routeOnBackFromService (Back button — T8 added)", () => {
    it("returns to Step 2 (/onboarding/services)", () => {
      expect(routeOnBackFromService()).toBe("/onboarding/services");
    });
  });
});
