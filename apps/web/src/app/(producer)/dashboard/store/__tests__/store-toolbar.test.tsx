import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-toolbar.tsx"), "utf8");

describe("StoreToolbar shell", () => {
  it("composes SegmentedTabs and SearchInput", () => {
    expect(SRC).toMatch(/SegmentedTabs/);
    expect(SRC).toMatch(/SearchInput/);
  });

  it("uses the FilterTab type from the helper", () => {
    expect(SRC).toMatch(/FilterTab/);
  });

  it("does not expose the removed Store table control", () => {
    expect(SRC).not.toMatch(/ViewToggle|ViewMode|enableTable|Table/);
  });

  it("only mounts search for a larger catalog or an active query", () => {
    expect(SRC).toMatch(/totalCount\s*>=\s*8\s*\|\|\s*search\.length\s*>\s*0/);
  });

  it("offers an explicit Reorder and Done mode", () => {
    expect(SRC).toContain("Reorder");
    expect(SRC).toContain("Done");
    expect(SRC).toMatch(/onReorderingChange/);
  });

  it("keeps reorder controls at least 44px through tablet widths", () => {
    expect(SRC).toMatch(/h-11[\s\S]*lg:h-9/);
    expect(SRC).not.toMatch(/sm:h-9/);
  });
});
