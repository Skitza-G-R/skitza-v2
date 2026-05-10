import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "new-product-button.tsx"), "utf8");

describe("NewProductButton shell", () => {
  it("uses the amber brand background", () => {
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("includes the Plus lucide icon", () => {
    expect(SRC).toMatch(/Plus/);
  });

  it("renders the N keyboard hint chip", () => {
    expect(SRC).toMatch(/KeyboardHintChip/);
    expect(SRC).toMatch(/label="N"/);
  });

  it("declares the button label '+ New product'", () => {
    expect(SRC).toContain("New product");
  });
});
