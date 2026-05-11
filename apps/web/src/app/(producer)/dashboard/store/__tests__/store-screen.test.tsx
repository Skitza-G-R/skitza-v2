import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-screen.tsx"), "utf8");

describe("StoreScreen shell", () => {
  it("uses the existing tRPC server actions", () => {
    expect(SRC).toMatch(/setPackageActive/);
  });

  it("wires the / and N global keyboard shortcuts", () => {
    expect(SRC).toMatch(/key === "\/"|"\\\/"/);
    expect(SRC).toMatch(/key\.toLowerCase\(\) === "n"|key === "N"|key === "n"/);
  });

  it("does NOT link Create or Edit to /dashboard/settings (regression carryover)", () => {
    expect(SRC).not.toMatch(
      /href\s*=\s*[`"']\/dashboard\/settings\?section=services/,
    );
  });

  it("renders the StoreHeader, StoreToolbar, ProductCard, EmptyState pieces", () => {
    expect(SRC).toMatch(/StoreHeader/);
    expect(SRC).toMatch(/StoreToolbar/);
    expect(SRC).toMatch(/ProductCard/);
    expect(SRC).toMatch(/EmptyState/);
  });

  it("renders the HIDDEN section divider when filter is all", () => {
    expect(SRC).toMatch(/HIDDEN/);
  });

  it("no longer uses window.confirm anywhere", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });

  it("mounts the new ProductEditor", () => {
    expect(SRC).toMatch(/<ProductEditor/);
  });

  it("mounts the DeleteConfirmModal", () => {
    expect(SRC).toMatch(/<DeleteConfirmModal/);
  });

  it("no longer mounts NewPackageForm directly", () => {
    expect(SRC).not.toMatch(/NewPackageForm/);
  });

  it("uses useUndoableDelete for the delete flow", () => {
    expect(SRC).toMatch(/useUndoableDelete/);
  });

  it("uses the useDragReorder hook", () => {
    expect(SRC).toMatch(/useDragReorder/);
  });

  it("uses computeNewOrder when applying drag-reorder updates", () => {
    expect(SRC).toMatch(/computeNewOrder\(/);
  });

  it("calls reorderProducts with the new orderedIds on drop", () => {
    expect(SRC).toMatch(/reorderProducts\(\s*\{\s*orderedIds/);
  });

  it("reverts the optimistic state to props on server error", () => {
    expect(SRC).toMatch(/setOptimisticProducts\(products\)/);
  });

  it("passes drag handlers into each ProductCard", () => {
    expect(SRC).toMatch(/drag=\{getHandlersFor\(p\.id\)\}/);
  });

  it("mirrors the products prop into local optimistic state", () => {
    expect(SRC).toMatch(/optimisticProducts/);
    expect(SRC).toMatch(/setOptimisticProducts/);
  });

  it("mounts StoreTable when view is 'table'", () => {
    expect(SRC).toMatch(/StoreTable/);
  });

  it("passes enableTable=true through to the toolbar / view toggle", () => {
    // Accept either the prop on StoreToolbar (Path B) or directly on
    // ViewToggle if StoreScreen passes it inline (rare).
    expect(SRC).toMatch(/enableTable=\{true\}/);
  });

  it("renders the cards block only when view is not 'table'", () => {
    // The branch `view === "table" ? <StoreTable ... /> : <div ...>` is
    // the new render switch. Source-grep for the literal "table" view check.
    expect(SRC).toMatch(/view\s*===\s*["']table["']/);
  });
});
