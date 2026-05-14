import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "keyboard-hint-chip.tsx"), "utf8");

describe("KeyboardHintChip shell", () => {
  it("renders the kbd label inside a small chip", () => {
    expect(SRC).toMatch(/<kbd/);
    expect(SRC).toMatch(/font-mono/);
  });

  it("is purely presentational (aria-hidden)", () => {
    expect(SRC).toContain("aria-hidden");
  });
});
