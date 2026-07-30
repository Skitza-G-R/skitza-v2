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
// Minimal capture: just the studio/producer name. Slug remains
// server-derived hidden (Decision #1).
// Repo runs vitest in `node` env (no jsdom) so we pin pure constants
// + helpers, no JSX.

describe("Public identity page contract", () => {
  describe("constants", () => {
    it("renders after the already-complete account milestone", () => {
      expect(STUDIO_STEP_INDEX).toBe(2);
    });

    it("uses plain public-page language", () => {
      expect(STUDIO_STEP_TITLE.toLowerCase()).toMatch(/public|name/);
      expect(STUDIO_STEP_TITLE.toLowerCase()).not.toContain("hall");
    });

    it("subtitle reassures the producer that the choice is reversible", () => {
      expect(STUDIO_STEP_SUBTITLE.toLowerCase()).toMatch(/later|edit|change|editable/);
    });
  });

  describe("isContinueAllowed (Continue gating)", () => {
    it("returns false on an empty name", () => {
      expect(isContinueAllowed("")).toBe(false);
    });

    it("returns false on whitespace-only or 1-char name (need ≥ 2 chars trimmed)", () => {
      expect(isContinueAllowed("   ")).toBe(false);
      expect(isContinueAllowed("a")).toBe(false);
      expect(isContinueAllowed("  a ")).toBe(false);
    });

    it("returns true once the trimmed name has at least 2 characters", () => {
      expect(isContinueAllowed("Ada")).toBe(true);
      expect(isContinueAllowed("Ada Lovelace")).toBe(true);
      expect(isContinueAllowed("  Ada  ")).toBe(true);
    });
  });

  describe("defaultTimezone (Intl fallback)", () => {
    it("returns a non-empty IANA-shaped timezone string", () => {
      const tz = defaultTimezone();
      expect(typeof tz).toBe("string");
      expect(tz.length).toBeGreaterThan(0);
    });
  });

  describe("nextRouteAfterStudio", () => {
    it("returns /onboarding/service (skipping legacy /services chip step)", () => {
      expect(nextRouteAfterStudio()).toBe("/onboarding/service");
    });
  });
});
