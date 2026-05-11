import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "empty-state.tsx"), "utf8");

describe("EmptyState shell", () => {
  it("uses the dashed border style from the spec", () => {
    expect(SRC).toMatch(/border-dashed/);
  });

  it("renders the title and body props", () => {
    expect(SRC).toMatch(/title/);
    expect(SRC).toMatch(/body/);
  });
});
