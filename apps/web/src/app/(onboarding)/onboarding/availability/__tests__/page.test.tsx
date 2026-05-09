import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_STEP_INDEX,
  AVAILABILITY_STEP_TITLE,
  AVAILABILITY_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  AVAILABILITY_CONTINUE_ALWAYS_ENABLED,
  nextRouteAfterAvailability,
  routeOnSkipFromAvailability,
  routeOnBackFromAvailability,
} from "../page";

// May 2026 redesign — Step 3 (availability / "When you work") page
// contract. Was Step 4 of 6 in the legacy flow; now Step 3 of 5.
// Repo runs vitest in `node` env (no jsdom) so we pin pure constants
// + helpers, no JSX.

describe("Step 3 (availability / 'When you work') page contract", () => {
  describe("constants", () => {
    it("renders as Step 3 of the 5-step rail", () => {
      expect(AVAILABILITY_STEP_INDEX).toBe(3);
    });

    it("title is about working hours / when (keyword-level)", () => {
      expect(AVAILABILITY_STEP_TITLE.toLowerCase()).toMatch(/work|open|hour|when/);
    });

    it("subtitle explains it's editable later or mentions weekly hours", () => {
      expect(AVAILABILITY_STEP_SUBTITLE.toLowerCase()).toMatch(
        /save|continue|edit|later|hour|week|change/,
      );
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      expect(ONBOARDING_STEP_NAME).toBe("availability");
    });

    it("Continue is always enabled (children auto-save)", () => {
      expect(AVAILABILITY_CONTINUE_ALWAYS_ENABLED).toBe(true);
    });
  });

  describe("nextRouteAfterAvailability (Continue advance)", () => {
    it("routes to Step 4 (/onboarding/portfolio) — redesign reordered portfolio before payment", () => {
      expect(nextRouteAfterAvailability()).toBe("/onboarding/portfolio");
    });
  });

  describe("routeOnSkipFromAvailability (Skip ghost link)", () => {
    it("advances to /onboarding/portfolio without saving", () => {
      expect(routeOnSkipFromAvailability()).toBe("/onboarding/portfolio");
    });

    it("targets the same destination as Continue (one path forward)", () => {
      expect(routeOnSkipFromAvailability()).toBe(nextRouteAfterAvailability());
    });
  });

  describe("routeOnBackFromAvailability (Back button)", () => {
    it("returns to Step 2 (/onboarding/service)", () => {
      expect(routeOnBackFromAvailability()).toBe("/onboarding/service");
    });
  });
});
