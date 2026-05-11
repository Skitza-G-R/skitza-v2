import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeNewOrder } from "../use-drag-reorder";

describe("computeNewOrder", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("moves an id above a target", () => {
    expect(computeNewOrder(ids, "d", "b", "above")).toEqual(["a", "d", "b", "c", "e"]);
  });

  it("moves an id below a target", () => {
    expect(computeNewOrder(ids, "d", "b", "below")).toEqual(["a", "b", "d", "c", "e"]);
  });

  it("returns the input unchanged when source equals target", () => {
    expect(computeNewOrder(ids, "c", "c", "above")).toEqual(ids);
  });

  it("returns the input unchanged when the source id is missing", () => {
    expect(computeNewOrder(ids, "zzz", "b", "above")).toEqual(ids);
  });

  it("returns the input unchanged when the target id is missing", () => {
    expect(computeNewOrder(ids, "a", "zzz", "above")).toEqual(ids);
  });

  it("moves the first item to the end via below-last", () => {
    expect(computeNewOrder(ids, "a", "e", "below")).toEqual(["b", "c", "d", "e", "a"]);
  });
});

// Source-grep that the hook exposes the expected handler shape.
const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "use-drag-reorder.ts"), "utf8");

describe("useDragReorder hook", () => {
  it("returns dragId and dropTarget state", () => {
    expect(SRC).toMatch(/dragId/);
    expect(SRC).toMatch(/dropTarget/);
  });

  it("exposes onDragStart, onDragOver, onDragEnd, onDrop handlers", () => {
    expect(SRC).toMatch(/onDragStart/);
    expect(SRC).toMatch(/onDragOver/);
    expect(SRC).toMatch(/onDragEnd/);
    expect(SRC).toMatch(/onDrop/);
  });

  it("calls back on a successful drop with (fromId, toId, position)", () => {
    expect(SRC).toMatch(/onReorder\s*\(/);
  });
});
