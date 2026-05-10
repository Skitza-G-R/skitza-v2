import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-screen.tsx"), "utf8");

describe("StoreScreen shell", () => {
  it("uses the existing tRPC server actions", () => {
    expect(SRC).toMatch(/setPackageActive/);
    expect(SRC).toMatch(/duplicatePackage/);
    expect(SRC).toMatch(/archivePackage/);
  });

  it("reuses NewPackageForm for create + edit (Phase 2 replaces)", () => {
    expect(SRC).toMatch(/NewPackageForm/);
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
});
