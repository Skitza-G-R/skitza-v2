import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  appendInclusion,
  MAX_INCLUSION_LENGTH,
  MAX_INCLUSIONS,
} from "../editor-steps/includes-step";
import { MAX_PRODUCT_TAGLINE_LENGTH } from "../product-editor-draft";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "includes-step.tsx"), "utf8");

describe("IncludesStep shell", () => {
  it("renders the product name input", () => {
    expect(SRC).toMatch(/<input/);
    expect(SRC).toMatch(/name/i);
  });

  it("renders a required, bounded artist-facing tagline", () => {
    expect(SRC).toMatch(/Tagline/);
    expect(SRC).toMatch(/tagline=\{draft\.tagline\}|value=\{tagline\}/);
    expect(SRC).toMatch(/maxLength=\{MAX_PRODUCT_TAGLINE_LENGTH\}/);
    expect(MAX_PRODUCT_TAGLINE_LENGTH).toBe(160);
    expect(SRC).toMatch(/exact line appears on the artist/i);
  });

  it("does not force focus and open the mobile keyboard when Details appears", () => {
    expect(SRC).not.toMatch(/autoFocus/);
  });

  it("renders the selected chips area + suggested extras", () => {
    expect(SRC).toMatch(/Suggested for/);
    expect(SRC).toMatch(/selected/);
  });

  it("renders the Add your own custom input", () => {
    expect(SRC).toMatch(/Add your own/);
  });

  it("uses brand-amber for the selected-chips dropzone tint", () => {
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("imports TYPE_PRESETS or getPreset to pull baseline/extras", () => {
    expect(SRC).toMatch(/from\s+["']\.\.\/type-presets["']/);
  });

  it("caps inclusions at the same ten-item limit as the save contract", () => {
    const full = Array.from({ length: MAX_INCLUSIONS }, (_, index) => `Item ${String(index + 1)}`);
    expect(appendInclusion(full, "One too many")).toEqual(full);
    expect(appendInclusion(full.slice(0, -1), "Final item")).toHaveLength(MAX_INCLUSIONS);
    expect(appendInclusion([], "x".repeat(MAX_INCLUSION_LENGTH + 1))).toEqual([]);
    expect(SRC).toMatch(/Maximum reached/);
    expect(SRC).toMatch(/maxLength=\{200\}/);
    expect(SRC).toMatch(/maxLength=\{MAX_INCLUSION_LENGTH\}/);
  });
});
