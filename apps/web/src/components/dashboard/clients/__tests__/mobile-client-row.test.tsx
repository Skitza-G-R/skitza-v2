import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "mobile-client-row.tsx"), "utf8");
const ACTIONS_SRC = readFileSync(join(here, "..", "client-actions-menu.tsx"), "utf8");

describe("MobileClientRow client management actions", () => {
  it("keeps Edit and Archive or Restore in one disclosure outside the row link", () => {
    expect(SRC).toMatch(/onEdit\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toMatch(/onArchive\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toContain("<ClientActionsMenu");
    expect(ACTIONS_SRC).toContain("Edit details");
    expect(ACTIONS_SRC).toContain('archived ? "Restore client" : "Archive client"');
  });

  it("uses one compact row with a 44px action target and overflow guards", () => {
    expect(SRC).toMatch(/min-h-\[72px\]/);
    expect(SRC).toContain("min-w-0");
    expect(ACTIONS_SRC).toMatch(/min-h-11\s+min-w-11/);
    expect(SRC).not.toMatch(/grid-cols-2/);
  });

  it("keeps the roster scan-focused instead of repeating unavailable money", () => {
    expect(SRC).not.toContain("Totals unavailable");
    expect(SRC).not.toContain("commercialUnavailable");
    expect(SRC).not.toContain("formatMoney");
    expect(SRC).toContain("projectSummary");
  });
});
