import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { totalFor } from "~/lib/pricing";
import { PREVIEW_QTYS, seedPerSongTiers } from "../pricing-step";

// Repo convention: vitest runs in `node` env, no jsdom, no
// @testing-library/react. Pure helpers + source-grep on the JSX
// shell. If the helpers + grepped strings are right, the component's
// only job is stitching spans together — which typecheck + lint
// cover.

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

// ─── PREVIEW_QTYS — math-regression sample (no longer rendered) ──────

describe("PREVIEW_QTYS", () => {
  it("samples 1 / 3 / 5 / 10 songs", () => {
    expect([...PREVIEW_QTYS]).toEqual([1, 3, 5, 10]);
  });

  it("agrees with totalFor() for the seeded discount ladder", () => {
    const tiers = seedPerSongTiers(20000);
    expect(totalFor(1, tiers)).toBe(20000);
    expect(totalFor(3, tiers)).toBe(60000);
    expect(totalFor(5, tiers)).toBe(85000);
    expect(totalFor(10, tiers)).toBe(170000);
  });
});

// ─── Source-grep — toggle, rate card, artist-facing footer ──────────

describe("pricing-step.tsx source", () => {
  it("renders both toggle options (flat / per song with discounts)", () => {
    expect(source).toMatch(/one flat price/i);
    expect(source).toMatch(/per song with discounts/i);
  });

  it("renders the pricing-ladder eyebrow on the per-song panel", () => {
    expect(source).toMatch(/pricing ladder/i);
  });

  it("renders the base row label ('1 song') and the discount-row 'or more songs' suffix", () => {
    expect(source).toMatch(/1 song/);
    expect(source).toMatch(/or more songs/i);
  });

  it("renders the 'add another tier' affordance inside the rate card", () => {
    expect(source).toMatch(/add another tier/i);
  });

  it("renders the artist-facing 'From $X/song' preview line", () => {
    expect(source).toMatch(/from \{formatCurrency/i);
    expect(source).toMatch(/\/ song/i);
  });

  it("renders the 'Discounts for bigger projects' tail when tiers exist", () => {
    expect(source).toMatch(/discounts for bigger projects/i);
  });

  it("imports the shared pricing math from ~/lib/pricing", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/pricing['"]/);
  });

  it("renders the 'Sessions per song' eyebrow on the per-song panel", () => {
    expect(source).toMatch(/sessions per song/i);
  });

  it("renders an 'Unlimited' toggle inside the per-song panel (not just flat)", () => {
    // Both panels share the same control labels, so we expect ≥2 hits.
    const matches = source.match(/Unlimited/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
