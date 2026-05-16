import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Repo convention: vitest runs in `node` env, no jsdom, no
// @testing-library/react. We source-grep the JSX shell to pin the
// per-song display invariants. Task 12 plants this test as a
// red-phase fixture for Task 13 (which adds volumeTiers + the new
// "From $X/song" copy to the artist's store card).

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "product-card.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

// ─── Round-trip per-song product → artist card ──────────────────────

describe("artist ProductCard — per-song display", () => {
  it("imports fromPrice from ~/lib/pricing for the 'cheapest tier' calc", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/pricing['"]/);
    expect(source).toMatch(/fromPrice/);
  });

  it("accepts volumeTiers on the product prop", () => {
    expect(source).toMatch(/volumeTiers/);
  });

  it("renders 'From $X/song' (per-song price label)", () => {
    // Matches either "From $...{/song}" or "from $X / song" — the
    // test is intent-based, not a copy-exact regex. Task 13 must
    // surface both "From " and "/song" together in the JSX.
    expect(source).toMatch(/from\b[^\n]{0,40}\/\s*song/i);
  });

  it("renders the 'Discounts for bigger projects' tail when tiers exist", () => {
    expect(source).toMatch(/discounts for bigger projects/i);
  });
});
