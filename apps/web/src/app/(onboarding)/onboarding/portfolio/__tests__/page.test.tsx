import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STEP_NAME,
  PORTFOLIO_HELPER_COPY,
  PORTFOLIO_STEP_INDEX,
  PORTFOLIO_STEP_SUBTITLE,
  PORTFOLIO_STEP_TITLE,
  routeOnBackFromPortfolio,
  routeOnContinueFromPortfolio,
  routeOnSkipFromPortfolio,
} from "../page";

// May 2026 redesign — Step 4 (portfolio / "A taste") page contract.
// Was Step 6 of 6 in the legacy flow; now Step 4 of 5 (redesign
// reorders portfolio BEFORE payment).
// Repo runs vitest in `node` env (no jsdom) so we pin pure constants
// + helpers, no JSX.

describe("Step 4 (portfolio / 'A taste') page contract", () => {
  describe("constants", () => {
    it("renders as Step 4 of the 5-step rail", () => {
      expect(PORTFOLIO_STEP_INDEX).toBe(4);
    });

    it("title is about the producer's work / portfolio (keyword-level)", () => {
      expect(PORTFOLIO_STEP_TITLE.toLowerCase()).toMatch(
        /work|taste|sound|show|portfolio/,
      );
    });

    it("subtitle is welcoming and mentions optionality / sample / link", () => {
      expect(PORTFOLIO_STEP_SUBTITLE.toLowerCase()).toMatch(
        /optional|skip|link|later|few|setup|portfolio/,
      );
    });

    it("helper copy stays welcoming (mentions optionality)", () => {
      expect(PORTFOLIO_HELPER_COPY.toLowerCase()).toMatch(
        /optional|skip|fill what|none/,
      );
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      expect(ONBOARDING_STEP_NAME).toBe("portfolio");
    });
  });

  describe("routeOnContinueFromPortfolio (Continue advances to Step 5)", () => {
    it("routes to /onboarding/payment (redesign reorders portfolio→payment→complete)", () => {
      expect(routeOnContinueFromPortfolio()).toBe("/onboarding/payment");
    });
  });

  describe("routeOnSkipFromPortfolio (Skip ghost link)", () => {
    it("also routes to /onboarding/payment (same destination as Continue)", () => {
      expect(routeOnSkipFromPortfolio()).toBe("/onboarding/payment");
    });

    it("targets the same destination as Continue (telemetry-only divergence)", () => {
      expect(routeOnSkipFromPortfolio()).toBe(routeOnContinueFromPortfolio());
    });
  });

  describe("routeOnBackFromPortfolio (Back button)", () => {
    it("returns to Step 3 (/onboarding/availability)", () => {
      expect(routeOnBackFromPortfolio()).toBe("/onboarding/availability");
    });
  });
});
