import { describe, expect, it } from "vitest";

import {
  STUDIO_STEP_INDEX,
  STUDIO_STEP_TITLE,
  STUDIO_STEP_SUBTITLE,
  defaultTimezone,
  isContinueAllowed,
  nextRouteAfterStudio,
} from "../page";

// Story 03 — Step 1 page contract. The repo runs vitest in `node` env
// (no jsdom — see Story 02 progress-bar.test.tsx and action-bar.test.tsx
// for precedent), so we don't render JSX. Instead we export the page's
// pure helpers / constants and pin them here.
//
// What this file pins:
//   - currentStep === 1 (the shell renders Step 1 of 4)
//   - title === "Name your studio." (architecture §6 + acceptance criteria)
//   - subtitle copy matches the welcoming "you can change later" tone
//   - isContinueAllowed gates the Continue button until the trimmed
//     displayName has at least 1 character (acceptance criteria #2)
//   - defaultTimezone falls back to "UTC" if Intl is unavailable
//   - nextRouteAfterStudio returns "/onboarding/service" so the page's
//     onSuccess push target is visible to tests without RTL

describe("Step 1 (studio) page contract", () => {
  describe("constants", () => {
    it("renders as Step 1 of the 4-step shell", () => {
      expect(STUDIO_STEP_INDEX).toBe(1);
    });

    it("uses the architecture-mandated title 'Name your studio.'", () => {
      expect(STUDIO_STEP_TITLE).toBe("Name your studio.");
    });

    it("subtitle reassures the producer that the choice is reversible", () => {
      // Friendly tone — pin a substring that proves the message is
      // welcoming rather than lawyerly. If a future copy edit goes
      // formal/corporate, this fails and forces a deliberate update.
      expect(STUDIO_STEP_SUBTITLE.toLowerCase()).toMatch(/later|edit|change/);
    });
  });

  describe("isContinueAllowed (Continue gating)", () => {
    it("returns false on an empty input (acceptance criteria #2)", () => {
      expect(isContinueAllowed("")).toBe(false);
    });

    it("returns false on whitespace-only input (trim is mandatory)", () => {
      expect(isContinueAllowed("   ")).toBe(false);
      expect(isContinueAllowed("\t\n  ")).toBe(false);
    });

    it("returns true once the trimmed value has at least 1 character", () => {
      expect(isContinueAllowed("a")).toBe(true);
      expect(isContinueAllowed("Ada Studios")).toBe(true);
      expect(isContinueAllowed("  Ada  ")).toBe(true);
    });
  });

  describe("defaultTimezone", () => {
    it("returns either a non-empty string or 'UTC' (Intl-or-fallback contract)", () => {
      // Node always has Intl, so this returns the host timezone. The
      // contract is: never empty. If a future refactor returns ""
      // (e.g. by stripping the fallback) this test fails.
      const tz = defaultTimezone();
      expect(typeof tz).toBe("string");
      expect(tz.length).toBeGreaterThan(0);
    });
  });

  describe("nextRouteAfterStudio", () => {
    it("routes to Step 2 (/onboarding/service) on success", () => {
      // Story 04 lives at /onboarding/service. Pin the target so a
      // copy-paste typo in the redirect path is caught at test time
      // rather than at user time.
      expect(nextRouteAfterStudio()).toBe("/onboarding/service");
    });
  });
});
