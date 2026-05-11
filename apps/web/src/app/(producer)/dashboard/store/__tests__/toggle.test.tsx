import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "toggle.tsx"), "utf8");

describe("Toggle component shell", () => {
  it("declares the 44 by 24 dimensions per spec", () => {
    expect(SRC).toMatch(/width:\s*44/);
    expect(SRC).toMatch(/height:\s*24/);
  });

  it("uses the springy thumb easing curve from the spec", () => {
    expect(SRC).toContain("cubic-bezier(.34,1.56,.64,1)");
  });

  it("flips aria-pressed based on the on prop", () => {
    expect(SRC).toMatch(/aria-pressed=\{on\}/);
  });

  it("uses the success token for the on background", () => {
    expect(SRC).toMatch(/--fg-success/);
  });
});
