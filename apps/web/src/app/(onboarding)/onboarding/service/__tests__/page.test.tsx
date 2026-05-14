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

// May 2026 redesign — Step 2 (service / "First service") page contract.
// Was Step 3 of 6 in the legacy flow; now Step 2 of 5 because the
// /services chip-multi-select step is dropped (Decision #4).
// Repo runs vitest in `node` env (no jsdom) so we pin pure constants
// + helpers, no JSX.

describe("Step 2 (service / 'First service') page contract", () => {
  describe("constants", () => {
    it("renders as Step 2 of the 5-step rail", () => {
      expect(SERVICE_STEP_INDEX).toBe(2);
    });

    it("title is about choosing/picking a first service (keyword-level)", () => {
      expect(SERVICE_STEP_TITLE.toLowerCase()).toMatch(/service/);
    });

    it("subtitle stays welcoming (mentions reversibility / freedom to skip)", () => {
      expect(SERVICE_STEP_SUBTITLE.toLowerCase()).toMatch(/later|skip|change|edit|done/);
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      expect(ONBOARDING_STEP_NAME).toBe("service");
    });
  });

  describe("nextRouteAfterService (form-success advance)", () => {
    it("routes to Step 3 (/onboarding/availability) after createPackage succeeds", () => {
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

  describe("routeOnBackFromService (Back button — May 2026 redesign)", () => {
    it("returns to Step 1 (/onboarding/studio) — /services chip step dropped", () => {
      expect(routeOnBackFromService()).toBe("/onboarding/studio");
    });
  });
});
