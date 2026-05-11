import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "includes-step.tsx"), "utf8");

describe("IncludesStep shell", () => {
  it("renders the product name input", () => {
    expect(SRC).toMatch(/<input/);
    expect(SRC).toMatch(/name/i);
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
});
