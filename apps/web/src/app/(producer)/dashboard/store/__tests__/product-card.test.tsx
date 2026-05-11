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

  it("accepts an optional drag prop wired to draggable + native HTML5 handlers", () => {
    expect(SRC).toMatch(/drag\?:\s*DragRowHandlers/);
    expect(SRC).toMatch(/draggable=\{!!drag\}/);
    expect(SRC).toMatch(/onDragStart=\{drag\?\.onDragStart\}/);
    expect(SRC).toMatch(/onDragOver=\{drag\?\.onDragOver\}/);
    expect(SRC).toMatch(/onDragEnd=\{drag\?\.onDragEnd\}/);
    expect(SRC).toMatch(/onDrop=\{drag\?\.onDrop\}/);
  });

  it("renders a drop indicator above or below by dropPosition", () => {
    expect(SRC).toMatch(/drag\?\.dropPosition\s*===\s*["']above["']/);
    expect(SRC).toMatch(/drag\?\.dropPosition\s*===\s*["']below["']/);
    expect(SRC).toMatch(/rgb\(var\(--brand-primary\)\)/);
  });

  it("applies is-dragging affordance (opacity 0.4 + scale)", () => {
    expect(SRC).toMatch(/drag\?\.isDragging\s*\?\s*["']opacity-40\s+scale-\[0\.98\]/);
  });

  it("plumbs recentlyAdded -> sk-shimmer-glow", () => {
    expect(SRC).toMatch(/recentlyAdded\s*\?\s*["']sk-shimmer-glow["']/);
  });

  it("marks the drag handle with sk-drag-handle for the touch-hide media query", () => {
    expect(SRC).toMatch(/sk-drag-handle/);
  });
});
