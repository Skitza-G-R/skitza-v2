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

// Story 08 (α-trimmed) — Step 4 (portfolio) page contract. Mirrors the
// constants-and-helpers-only test pattern Stories 03 + 04 + 05 used (the
// repo runs vitest in `node` env — no jsdom — so we don't render JSX).
//
// What this file pins:
//   - PORTFOLIO_STEP_INDEX === 4 (shell renders Step 4 of 4)
//   - PORTFOLIO_STEP_TITLE === "Show your work."
//   - subtitle copy mentions Setup/Portfolio (the deferred-upload
//     surface) so a future edit that drops it requires a deliberate
//     update — without that hint the producer might think track upload
//     is impossible, when really it's just one screen away in Setup.
//   - helper copy stays welcoming (substring match — "optional" or
//     "skip"-equivalent)
//   - ONBOARDING_STEP_NAME === "portfolio" — the OnboardingStep tag
//     passed to decideOnboardingRedirect at the page-level role guard
//   - routeOnContinueFromPortfolio → "/dashboard" (end of wizard)
//   - routeOnSkipFromPortfolio → "/dashboard" (same — telemetry-only
//     distinction)
//   - routeOnBackFromPortfolio → "/onboarding/availability" (Step 3)

describe("Step 4 (portfolio) page contract", () => {
  describe("constants", () => {
    it("renders as Step 4 of the 4-step shell", () => {
      expect(PORTFOLIO_STEP_INDEX).toBe(4);
    });

    it("uses the architecture-mandated title 'Show your work.'", () => {
      expect(PORTFOLIO_STEP_TITLE).toBe("Show your work.");
    });

    it("subtitle surfaces the deferred-upload path so producers know where to add tracks later", () => {
      // The track-upload widget was deferred (Story 07 schema blocker).
      // Producers can still upload in Setup → Portfolio. The subtitle
      // must mention that path so the deferral isn't invisible.
      expect(PORTFOLIO_STEP_SUBTITLE.toLowerCase()).toMatch(
        /setup|portfolio|later/,
      );
    });

    it("helper copy stays welcoming (mentions optionality)", () => {
      // Producer-facing reassurance: not every platform is required.
      // Pin a substring so a future copy edit that goes formal/legalese
      // forces a deliberate update.
      expect(PORTFOLIO_HELPER_COPY.toLowerCase()).toMatch(
        /optional|skip|fill what|none/,
      );
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      // The server-component role guard (in page.tsx default export)
      // calls decideOnboardingRedirect(role, ONBOARDING_STEP_NAME).
      // Pinning the literal here prevents a typo from silently
      // bypassing the step-aware redirect.
      expect(ONBOARDING_STEP_NAME).toBe("portfolio");
    });
  });

  describe("routeOnContinueFromPortfolio (Continue completes the wizard)", () => {
    it("routes to /dashboard (end of onboarding)", () => {
      // Step 4 is the last step. Continue ends the wizard.
      expect(routeOnContinueFromPortfolio()).toBe("/dashboard");
    });
  });

  describe("routeOnSkipFromPortfolio (Skip ghost link)", () => {
    it("also routes to /dashboard (no save, but same destination)", () => {
      expect(routeOnSkipFromPortfolio()).toBe("/dashboard");
    });

    it("targets the same destination as the Continue route (telemetry-only divergence)", () => {
      // This invariant is load-bearing: if Skip and Continue diverged
      // the wizard would branch. Keeping them aligned means the only
      // difference is whether saveExternalLinks runs + which telemetry
      // event fires (step_completed vs step_skipped).
      expect(routeOnSkipFromPortfolio()).toBe(routeOnContinueFromPortfolio());
    });
  });

  describe("routeOnBackFromPortfolio (Back button)", () => {
    it("returns to Step 3 (/onboarding/availability)", () => {
      // Back hops one step. The wizard is a strict 4-step linear flow;
      // Back from Step 4 lands on Step 3 (availability). Pin the literal
      // so an off-by-one is caught at test time.
      expect(routeOnBackFromPortfolio()).toBe("/onboarding/availability");
    });
  });
});
