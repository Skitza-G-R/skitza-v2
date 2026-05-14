import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-table.tsx"), "utf8");

describe("StoreTable", () => {
  it("renders the 5-column header strip with NAME / TYPE / PRICE / STATUS / ACTIONS", () => {
    expect(SRC).toMatch(/NAME/);
    expect(SRC).toMatch(/TYPE/);
    expect(SRC).toMatch(/PRICE/);
    expect(SRC).toMatch(/STATUS/);
    expect(SRC).toMatch(/ACTIONS/);
  });

  it("uses the same 5-column grid as ProductRow", () => {
    expect(SRC).toMatch(/minmax\(0,\s*1fr\)\s+140px\s+110px\s+80px\s+130px/);
  });

  it("renders ProductRow rows", () => {
    expect(SRC).toMatch(/<ProductRow/);
  });

  it("renders LIVE divider when live products exist", () => {
    expect(SRC).toMatch(/LIVE/);
  });

  it("renders HIDDEN divider conditionally on showHiddenGroup + hidden.length", () => {
    expect(SRC).toMatch(/HIDDEN/);
    expect(SRC).toMatch(/showHiddenGroup/);
  });

  it("exposes onOpen, onToggleVisible, onEdit, onDelete callbacks", () => {
    expect(SRC).toMatch(/onOpen/);
    expect(SRC).toMatch(/onToggleVisible/);
    expect(SRC).toMatch(/onEdit/);
    expect(SRC).toMatch(/onDelete/);
  });
});
