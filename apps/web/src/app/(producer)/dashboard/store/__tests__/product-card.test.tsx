import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-card.tsx"), "utf8");

describe("ProductCard shell", () => {
  it("imports TypeTile and Toggle", () => {
    expect(SRC).toMatch(/from\s+["']\.\/type-tile["']/);
    expect(SRC).toMatch(/from\s+["']\.\/toggle["']/);
  });

  it("renders the GripVertical drag handle", () => {
    expect(SRC).toMatch(/GripVertical/);
  });

  it("renders the Pencil edit icon and Trash2 delete icon", () => {
    expect(SRC).toMatch(/Pencil/);
    expect(SRC).toMatch(/Trash2|X /);
  });

  it("uses formatMoney for the price", () => {
    expect(SRC).toMatch(/formatMoney/);
  });

  it("uses kindToTile to derive the tile type", () => {
    expect(SRC).toMatch(/kindToTile/);
  });

  it("derives the tagline from the first line of description", () => {
    expect(SRC).toMatch(/split\(\s*["']\\n["']\s*\)\[0\]/);
  });

  it("blocks card-click bubble on action area via no-card-click-block", () => {
    expect(SRC).toMatch(/no-card-click-block/);
  });
});
