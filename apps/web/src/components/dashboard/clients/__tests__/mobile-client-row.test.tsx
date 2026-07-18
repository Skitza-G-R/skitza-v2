import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "mobile-client-row.tsx"), "utf8");

describe("MobileClientRow client management actions", () => {
  it("keeps Edit and Archive or Restore visible outside the row link", () => {
    expect(SRC).toMatch(/onEdit\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toMatch(/onArchive\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toContain("Edit");
    expect(SRC).toContain("Archive");
    expect(SRC).toContain("Restore");
  });

  it("uses full-width, 44px touch actions without horizontal overflow", () => {
    expect(SRC).toMatch(/min-h-\[44px\]/);
    expect(SRC).toMatch(/grid-cols-2/);
  });
});
