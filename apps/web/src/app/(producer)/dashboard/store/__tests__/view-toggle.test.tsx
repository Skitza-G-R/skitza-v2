import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "view-toggle.tsx"), "utf8");

describe("ViewToggle shell", () => {
  it("renders both Cards and Table options", () => {
    expect(SRC).toContain('"cards"');
    expect(SRC).toContain('"table"');
  });

  it("disables the Table option in Phase 1 with a coming-soon hint", () => {
    expect(SRC).toMatch(/disabled/);
    expect(SRC).toMatch(/Coming soon|coming soon|aria-disabled/i);
  });
});
