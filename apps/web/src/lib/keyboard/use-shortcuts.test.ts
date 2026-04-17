import { describe, expect, it } from "vitest";

import { isTypingTarget } from "./use-shortcuts";

// Node-environment tests only. The DOM-dependent branches (HTMLElement,
// isContentEditable) get manual QA in the browser — jsdom is not set up
// for this workspace and adding it would shift every other test suite.

describe("isTypingTarget", () => {
  it("returns false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("returns false for plain objects that aren't HTMLElements", () => {
    expect(isTypingTarget({})).toBe(false);
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(false);
  });
});
