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

  it("keeps the article semantic and exposes each action as a real button", () => {
    expect(SRC).toMatch(/<article/);
    expect(SRC).not.toMatch(/role="button"/);
    expect(SRC).not.toMatch(/tabIndex=\{0\}/);
    expect(SRC).not.toMatch(/draggable=/);
    expect(SRC).toMatch(/aria-label=\{`Edit \$\{product\.name\}`\}/);
  });

  it("renders edit and lifecycle-aware archive/delete icons", () => {
    expect(SRC).toMatch(/Pencil/);
    expect(SRC).toMatch(/Archive/);
    expect(SRC).toMatch(/Trash2/);
    expect(SRC).toMatch(/removalAction/);
  });

  it("uses formatMoney for the price", () => {
    expect(SRC).toMatch(/formatMoney/);
  });

  it("uses kindToTile to derive the tile type", () => {
    expect(SRC).toMatch(/kindToTile/);
  });

  it("derives the short description from the first line of description", () => {
    expect(SRC).toMatch(/split\(\s*["']\\n["']\s*\)\[0\]/);
    expect(SRC).toContain("No short description yet");
    expect(SRC).not.toContain("No tagline yet");
  });

  it("provides touch and keyboard-safe move-up/down controls", () => {
    expect(SRC).toMatch(/canMoveUp:\s*boolean/);
    expect(SRC).toMatch(/canMoveDown:\s*boolean/);
    expect(SRC).toMatch(/onClick=\{onMoveUp\}/);
    expect(SRC).toMatch(/onClick=\{onMoveDown\}/);
    expect(SRC).toMatch(/Move \$\{product\.name\} up/);
    expect(SRC).toMatch(/Move \$\{product\.name\} down/);
    expect(SRC).toMatch(/h-11 w-11/);
    expect(SRC).toMatch(/lg:h-9 lg:w-9/);
    expect(SRC).not.toMatch(/sm:h-9 sm:w-9/);
  });

  it("numbers each row inside its live or hidden reorder group", () => {
    expect(SRC).toMatch(/reorderPosition\?:\s*number/);
    expect(SRC).toMatch(/reorderTotal\?:\s*number/);
    expect(SRC).toMatch(/Position \$\{String\(reorderPosition\)\} of/);
    expect(SRC).toMatch(/padStart\(2,\s*["']0["']\)/);
  });

  it("plumbs recentlyAdded -> sk-shimmer-glow", () => {
    expect(SRC).toMatch(/recentlyAdded\s*\?\s*["']sk-shimmer-glow["']/);
  });

  it("renders a pulsing live dot when product.active is true", () => {
    expect(SRC).toMatch(/sk-live-pulse/);
    expect(SRC).toMatch(/--fg-success/);
  });

  it("labels the removal action exactly instead of always saying Delete", () => {
    expect(SRC).toMatch(/removalLabel/);
    expect(SRC).toMatch(/Archive.*Delete|Delete.*Archive/);
    expect(SRC).toMatch(/aria-label=\{`\$\{removalLabel\}/);
  });

  it("marks the first live product as Featured", () => {
    expect(SRC).toMatch(/featured\?:\s*boolean/);
    expect(SRC).toContain("Featured");
    expect(SRC).toContain("brand-primary-text");
  });

  it("shows ordering controls only during explicit reorder mode", () => {
    expect(SRC).toMatch(/reordering\?:\s*boolean/);
    expect(SRC).toMatch(/reordering\s*\?/);
  });

  it("provides a programmatic focus target for newly created products", () => {
    expect(SRC).toMatch(/focusRef/);
    expect(SRC).toMatch(/data-product-id/);
    expect(SRC).toMatch(/tabIndex=\{recentlyAdded \? -1 : undefined\}/);
  });
});
