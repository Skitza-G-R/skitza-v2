import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "search-input.tsx"), "utf8");

describe("SearchInput shell", () => {
  it("renders an input element", () => {
    expect(SRC).toMatch(/<input/);
  });

  it("accepts an external ref via forwardRef so the / handler can focus it", () => {
    expect(SRC).toMatch(/forwardRef/);
  });

  it("includes the search Lucide icon", () => {
    expect(SRC).toMatch(/Search/);
  });

  it("renders the / keyboard hint chip", () => {
    expect(SRC).toMatch(/KeyboardHintChip/);
    expect(SRC).toMatch(/label="\/"/);
  });
});
