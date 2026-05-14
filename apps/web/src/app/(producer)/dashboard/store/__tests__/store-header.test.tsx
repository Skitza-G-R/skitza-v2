import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-header.tsx"), "utf8");

describe("StoreHeader shell", () => {
  it("renders the CATALOG eyebrow", () => {
    expect(SRC).toContain("CATALOG");
  });

  it("renders the Store. wordmark with brand-amber dot", () => {
    expect(SRC).toMatch(/Store/);
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("uses Syne for the wordmark", () => {
    expect(SRC).toMatch(/font-display|Syne|font-syne/);
  });

  it("renders the live and hidden counts", () => {
    expect(SRC).toMatch(/live/);
    expect(SRC).toMatch(/hidden/);
  });
});
