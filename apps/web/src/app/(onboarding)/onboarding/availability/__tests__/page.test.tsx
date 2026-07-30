import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "page.tsx"),
  "utf8",
);

// Working hours are the fourth durable milestone because account creation is
// already complete on first paint.
// Repo runs vitest in `node` env (no jsdom) so we pin pure constants
// + helpers, no JSX.

describe("Working-hours page contract", () => {
  describe("constants", () => {
    it("renders as milestone 4 of 5", () => {
      expect(AVAILABILITY_STEP_INDEX).toBe(4);
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

    it("Continue validates the producer's confirmed hours", () => {
      expect(AVAILABILITY_CONTINUE_ALWAYS_ENABLED).toBe(false);
    });
  });

  describe("nextRouteAfterAvailability (Continue advance)", () => {
    it("routes to final review", () => {
      expect(nextRouteAfterAvailability()).toBe("/onboarding/review");
    });
  });

  describe("routeOnSkipFromAvailability (Skip ghost link)", () => {
    it("leaves required hours unfinished and returns to the unlocked dashboard", () => {
      expect(routeOnSkipFromAvailability()).toBe("/dashboard");
    });
  });

  describe("routeOnBackFromAvailability (Back button)", () => {
    it("returns to Step 2 (/onboarding/service)", () => {
      expect(routeOnBackFromAvailability()).toBe("/onboarding/service");
    });
  });

  it("skips working hours when the persisted product disables artist booking", () => {
    expect(pageSource).toContain(
      'if (!firstProduct.bookingEnabled) redirect("/onboarding/review")',
    );
    expect(pageSource).not.toContain(
      'if (firstProduct.durationMin === 0) redirect("/onboarding/review")',
    );
  });
});
