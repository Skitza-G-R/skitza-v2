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
//   - PORTFOLIO_STEP_INDEX === 6 (shell renders Step 6 of 6 — T8)
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

describe("Step 6 (portfolio) page contract", () => {
  describe("constants", () => {
    it("renders as Step 6 of the 6-step shell", () => {
      expect(PORTFOLIO_STEP_INDEX).toBe(6);
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

  describe("routeOnContinueFromPortfolio (Continue advances to completion screen)", () => {
    it("routes to /onboarding/complete (T8 — completion screen)", () => {
      expect(routeOnContinueFromPortfolio()).toBe("/onboarding/complete");
    });
  });

  describe("routeOnSkipFromPortfolio (Skip ghost link)", () => {
    it("also routes to /onboarding/complete (no save, but same destination)", () => {
      expect(routeOnSkipFromPortfolio()).toBe("/onboarding/complete");
    });

    it("targets the same destination as the Continue route (telemetry-only divergence)", () => {
      expect(routeOnSkipFromPortfolio()).toBe(routeOnContinueFromPortfolio());
    });
  });

  describe("routeOnBackFromPortfolio (Back button)", () => {
    it("returns to Step 5 (/onboarding/payment) — T8 reordered", () => {
      expect(routeOnBackFromPortfolio()).toBe("/onboarding/payment");
    });
  });
});
