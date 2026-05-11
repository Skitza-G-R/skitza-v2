import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-row.tsx"), "utf8");

describe("ProductRow", () => {
  it("uses the 5-column grid template from the design brief", () => {
    expect(SRC).toMatch(/minmax\(0,\s*1fr\)\s+140px\s+110px\s+80px\s+130px/);
  });

  it("renders a small type chip via TypeTile size 32", () => {
    expect(SRC).toMatch(/TypeTile/);
    expect(SRC).toMatch(/size=\{?32\}?/);
  });

  it("derives the type label by uppercasing the tile name", () => {
    expect(SRC).toMatch(/tile\.toUpperCase\(\)/);
  });

  it("uses the tile accent color for the type label", () => {
    expect(SRC).toMatch(/TILE_THEME\[tile\]\.accent/);
  });

  it("renders the live dot with sk-live-pulse when product.active is true", () => {
    expect(SRC).toMatch(/product\.active[\s\S]{0,400}sk-live-pulse/);
  });

  it("renders Hidden text when product.active is false", () => {
    expect(SRC).toMatch(/Hidden/);
  });

  it("opens the editor via onOpen when the row body is clicked", () => {
    expect(SRC).toMatch(/onClick=\{onOpen\}/);
  });

  it("blocks action-area clicks from bubbling", () => {
    expect(SRC).toMatch(/no-card-click-block|stopPropagation/);
  });

  it("plays the sk-row-in entry animation", () => {
    expect(SRC).toMatch(/sk-row-in/);
  });
});
