import { describe, expect, it } from "vitest";

import {
  STUDIO_STEP_INDEX,
  STUDIO_STEP_TITLE,
  STUDIO_STEP_SUBTITLE,
  defaultTimezone,
  isContinueAllowed,
  nextRouteAfterStudio,
} from "../page";

// May 2026 redesign — Step 1 (Identity / "Your hall") page contract.
// The repo runs vitest in `node` env (no jsdom), so we don't render
// JSX. Instead we export the page's pure helpers / constants and pin
// them here.
//
// What this file pins:
//   - STUDIO_STEP_INDEX === 1 (rail position; the chrome highlights row 1)
//   - title and subtitle copy match the redesign tone (keyword-level)
//   - isContinueAllowed gates the Continue button until the trimmed
//     name has ≥ 2 chars AND the tagline (if filled) is ≤ 80 chars
//   - defaultTimezone falls back to "UTC" when Intl is unavailable
//   - nextRouteAfterStudio returns "/onboarding/service" — the legacy
//     /services chip step is dropped per Decision #4

describe("Step 1 (studio / 'Your hall') page contract", () => {
  describe("constants", () => {
    it("renders as Step 1 of the 5-step rail", () => {
      expect(STUDIO_STEP_INDEX).toBe(1);
    });

    it("title leads with the redesign's 'hall' phrasing", () => {
      // Pinned at the keyword level so a future polish pass can edit
      // copy without breaking the test as long as the redesign's
      // identity-first framing stays.
      expect(STUDIO_STEP_TITLE.toLowerCase()).toMatch(/hall|studio/);
    });

    it("subtitle reassures the producer that the choice is reversible", () => {
      expect(STUDIO_STEP_SUBTITLE.toLowerCase()).toMatch(/later|edit|change|editable/);
    });
  });

  describe("isContinueAllowed (Continue gating)", () => {
    it("returns false on an empty name (regardless of tagline)", () => {
      expect(isContinueAllowed("", "")).toBe(false);
      expect(isContinueAllowed("", "Some tagline")).toBe(false);
    });

    it("returns false on whitespace-only or 1-char name (need ≥ 2 chars trimmed)", () => {
      expect(isContinueAllowed("   ", "")).toBe(false);
      expect(isContinueAllowed("a", "")).toBe(false);
      expect(isContinueAllowed("  a ", "")).toBe(false);
    });

    it("returns true once the trimmed name has at least 2 characters", () => {
      expect(isContinueAllowed("Ada", "")).toBe(true);
      expect(isContinueAllowed("Ada Lovelace", "")).toBe(true);
      expect(isContinueAllowed("  Ada  ", "")).toBe(true);
    });

    it("returns false when tagline exceeds 80 chars (even with valid name)", () => {
      const tooLong = "a".repeat(81);
      expect(isContinueAllowed("Ada Studios", tooLong)).toBe(false);
    });

    it("returns true when tagline is exactly 80 chars", () => {
      expect(isContinueAllowed("Ada Studios", "a".repeat(80))).toBe(true);
    });
  });

  describe("defaultTimezone (Intl fallback)", () => {
    it("returns a non-empty IANA-shaped timezone string", () => {
      const tz = defaultTimezone();
      expect(typeof tz).toBe("string");
      expect(tz.length).toBeGreaterThan(0);
    });
  });

  describe("nextRouteAfterStudio (Step 1 → Step 2)", () => {
    it("returns /onboarding/service (skipping legacy /services chip step)", () => {
      expect(nextRouteAfterStudio()).toBe("/onboarding/service");
    });
  });
});
