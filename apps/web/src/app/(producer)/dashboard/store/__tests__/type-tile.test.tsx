import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "type-tile.tsx"), "utf8");

describe("TypeTile component shell", () => {
  it("imports the tile theme and the kind-to-tile types", () => {
    expect(SRC).toMatch(/from\s+["']\.\/tile-theme["']/);
    expect(SRC).toMatch(/from\s+["']\.\/kind-to-tile["']/);
  });

  it("imports lucide-react for the icon", () => {
    expect(SRC).toMatch(/from\s+["']lucide-react["']/);
  });

  it("renders 60 and 32 sizes", () => {
    expect(SRC).toContain('size === 60');
    expect(SRC).toContain('size === 32');
  });

  it("applies the eye-off overlay when hidden prop is set", () => {
    expect(SRC).toMatch(/EyeOff|eye-off/);
    expect(SRC).toMatch(/hidden\?/);
  });

  it("uses inset shadows on the tile per the design spec", () => {
    expect(SRC).toContain("inset 0 1px 0 rgba(255,255,255");
    expect(SRC).toContain("inset 0 -10px 16px rgba(0,0,0");
  });

  it("centers the icon with stroke width 2.2", () => {
    expect(SRC).toMatch(/strokeWidth=\{2\.2\}/);
  });
});
