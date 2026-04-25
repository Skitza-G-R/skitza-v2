import { describe, it, expect } from "vitest";

import {
  actionBarLayout,
  continueButtonState,
  shouldRenderBack,
  shouldRenderSkip,
} from "../action-bar";

// Story 02: sticky bottom action bar. Layout is Back chip on the
// left (omitted on Step 1), Skip ghost link + Continue primary on
// the right. The visibility rules and Continue button state are
// exposed as pure helpers so we can pin them without RTL.

describe("Onboarding action bar contract (Story 02)", () => {
  describe("shouldRenderBack", () => {
    it("returns false when onBack is undefined (Step 1 case)", () => {
      expect(shouldRenderBack(undefined)).toBe(false);
    });

    it("returns true when onBack is a function (Steps 2-4)", () => {
      expect(shouldRenderBack(() => undefined)).toBe(true);
    });
  });

  describe("shouldRenderSkip", () => {
    it("returns false when onSkip is undefined", () => {
      expect(shouldRenderSkip(undefined)).toBe(false);
    });

    it("returns true when onSkip is a function", () => {
      expect(shouldRenderSkip(() => undefined)).toBe(true);
    });
  });

  describe("continueButtonState", () => {
    it("disabled flag mirrors the continueDisabled prop", () => {
      expect(continueButtonState(false).disabled).toBe(false);
      expect(continueButtonState(true).disabled).toBe(true);
    });

    it("default Continue label is 'Continue →' per architecture §6", () => {
      expect(continueButtonState(false).label).toBe("Continue →");
    });

    it("custom label overrides the default", () => {
      expect(continueButtonState(false, "Enter your studio →").label).toBe(
        "Enter your studio →",
      );
    });
  });

  describe("actionBarLayout", () => {
    it("uses sticky bottom-0 + sk-safe-bottom for iOS home indicator", () => {
      const cls = actionBarLayout();
      expect(cls).toMatch(/sticky/);
      expect(cls).toMatch(/bottom-0/);
      expect(cls).toMatch(/sk-safe-bottom/);
    });

    it("never references hex colors (CSS-vars-only repo rule)", () => {
      expect(actionBarLayout()).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });
  });
});
