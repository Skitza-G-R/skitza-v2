import { describe, expect, it } from "vitest";

import { tokenizeShortcut } from "../keyboard-hint";

describe("tokenizeShortcut", () => {
  it("splits on whitespace and trims", () => {
    expect(tokenizeShortcut("G T")).toEqual(["G", "T"]);
    expect(tokenizeShortcut("  G   T  ")).toEqual(["G", "T"]);
  });

  it("keeps multi-char modifiers intact", () => {
    expect(tokenizeShortcut("⌘ K")).toEqual(["⌘", "K"]);
    expect(tokenizeShortcut("Ctrl Shift P")).toEqual(["Ctrl", "Shift", "P"]);
  });

  it("returns an empty array for empty/whitespace input", () => {
    expect(tokenizeShortcut("")).toEqual([]);
    expect(tokenizeShortcut("   ")).toEqual([]);
  });

  it("preserves single-key shortcuts", () => {
    expect(tokenizeShortcut("?")).toEqual(["?"]);
    expect(tokenizeShortcut("c")).toEqual(["c"]);
  });
});
