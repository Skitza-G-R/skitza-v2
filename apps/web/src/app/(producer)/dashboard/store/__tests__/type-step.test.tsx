import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "type-step.tsx"), "utf8");

describe("TypeStep", () => {
  it("imports the TYPE_PRESETS data", () => {
    expect(SRC).toMatch(/from\s+["']\.\.\/type-presets["']/);
  });

  it("renders a 2x2 grid of preset cards", () => {
    expect(SRC).toMatch(/grid|cols-2/);
  });

  it("highlights the picked preset via a thicker amber border", () => {
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("calls onPick with the preset id", () => {
    expect(SRC).toMatch(/onPick\s*\(\s*p\.id|onPick\(preset\.id/);
  });

  it("renders the Blank preset with a dashed border to mark it as start-from-scratch", () => {
    expect(SRC).toMatch(/p\.id\s*===\s*["']blank["'][\s\S]{0,200}border-dashed/);
  });
});
