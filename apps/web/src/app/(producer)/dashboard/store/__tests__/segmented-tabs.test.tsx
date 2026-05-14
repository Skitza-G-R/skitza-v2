import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "segmented-tabs.tsx"), "utf8");

describe("SegmentedTabs shell", () => {
  it("renders a button per item", () => {
    expect(SRC).toMatch(/items\.map/);
    expect(SRC).toMatch(/<button/);
  });

  it("flips aria-pressed on the active tab", () => {
    expect(SRC).toMatch(/aria-pressed=\{[^}]*active/);
  });

  it("renders the count badge when count > 0", () => {
    expect(SRC).toMatch(/count\s*>\s*0/);
  });

  it("groups tabs in role group with an aria-label", () => {
    expect(SRC).toContain('role="group"');
    expect(SRC).toMatch(/aria-label/);
  });
});
