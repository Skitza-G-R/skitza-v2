import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PREVIEW_QTYS, seedPerSongTiers } from "../pricing-step";

// Repo convention: vitest runs in `node` env, no jsdom, no
// @testing-library/react. We extract pure helpers from the component
// and source-grep the JSX shell to pin the toggle / panel / preview
// invariants. If the helpers are right, the component's only job is
// stitching spans together — which typecheck + lint cover.

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "pricing-step.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

// ─── seedPerSongTiers — pre-fill on first toggle-on ──────────────────

describe("seedPerSongTiers", () => {
  it("returns base tier + 1 discount tier (15% off at 5 songs) from a flat price", () => {
    expect(seedPerSongTiers(20000)).toEqual([
      { minQty: 1, pricePerUnitCents: 20000 },
      { minQty: 5, pricePerUnitCents: 17000 },
    ]);
  });

  it("rounds the 15% off discount to the nearest cent", () => {
    expect(seedPerSongTiers(15000)).toEqual([
      { minQty: 1, pricePerUnitCents: 15000 },
      { minQty: 5, pricePerUnitCents: 12750 },
    ]);
  });

  it("seeds both tiers at 0 when price is 0", () => {
    expect(seedPerSongTiers(0)).toEqual([
      { minQty: 1, pricePerUnitCents: 0 },
      { minQty: 5, pricePerUnitCents: 0 },
    ]);
  });
});

// ─── PREVIEW_QTYS — the 4 live-preview rows ───────────────────────────

describe("PREVIEW_QTYS", () => {
  it("samples 1 / 3 / 5 / 10 songs", () => {
    expect([...PREVIEW_QTYS]).toEqual([1, 3, 5, 10]);
  });
});

// ─── Source-grep — toggle, per-song panel, live-preview shell ────────

describe("pricing-step.tsx source", () => {
  it("renders both toggle options (one flat / per song)", () => {
    expect(source).toMatch(/one flat price/i);
    expect(source).toMatch(/per song/i);
  });

  it("renders the base-price-per-song input label", () => {
    expect(source).toMatch(/base price per song/i);
  });

  it("renders the 'add another discount' affordance", () => {
    expect(source).toMatch(/add another discount/i);
  });

  it("renders the live preview header", () => {
    expect(source).toMatch(/live preview/i);
  });

  it("imports the shared pricing math from ~/lib/pricing", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/pricing['"]/);
  });
});
