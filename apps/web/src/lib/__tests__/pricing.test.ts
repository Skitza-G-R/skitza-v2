import { describe, expect, it } from "vitest";

import { unitPriceFor } from "../pricing";

const TIERS = [
  { minQty: 1, pricePerUnitCents: 20000 },
  { minQty: 3, pricePerUnitCents: 17000 },
  { minQty: 5, pricePerUnitCents: 15000 },
  { minQty: 10, pricePerUnitCents: 12000 },
];

describe("unitPriceFor", () => {
  it("returns base tier for 1 song", () => {
    expect(unitPriceFor(1, TIERS)).toBe(20000);
  });
  it("returns base tier for 2 songs (below first discount)", () => {
    expect(unitPriceFor(2, TIERS)).toBe(20000);
  });
  it("returns 3-tier price for exactly 3 songs", () => {
    expect(unitPriceFor(3, TIERS)).toBe(17000);
  });
  it("returns 3-tier price for 4 songs (between tiers)", () => {
    expect(unitPriceFor(4, TIERS)).toBe(17000);
  });
  it("returns 5-tier price for 5 songs", () => {
    expect(unitPriceFor(5, TIERS)).toBe(15000);
  });
  it("returns 10-tier price for 100 songs", () => {
    expect(unitPriceFor(100, TIERS)).toBe(12000);
  });
  it("falls back to base when qty is 0 (defensive)", () => {
    expect(unitPriceFor(0, TIERS)).toBe(20000);
  });
  it("returns 0 when tiers array is empty (defensive)", () => {
    expect(unitPriceFor(5, [])).toBe(0);
  });
});
