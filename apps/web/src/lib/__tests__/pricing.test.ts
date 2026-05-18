import { describe, expect, it } from "vitest";

import {
  computeProjectSessionCount,
  fromPrice,
  totalFor,
  unitPriceFor,
  validateTiers,
} from "../pricing";

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

describe("totalFor", () => {
  it("multiplies qty by active tier", () => {
    expect(totalFor(5, TIERS)).toBe(75000);
  });
  it("returns 0 for qty 0", () => {
    expect(totalFor(0, TIERS)).toBe(0);
  });
});

describe("fromPrice", () => {
  it("returns the cheapest pricePerUnitCents", () => {
    expect(fromPrice(TIERS)).toBe(12000);
  });
  it("returns 0 when tiers empty", () => {
    expect(fromPrice([])).toBe(0);
  });
  it("works with a single base tier", () => {
    expect(fromPrice([{ minQty: 1, pricePerUnitCents: 20000 }])).toBe(20000);
  });
});

describe("computeProjectSessionCount", () => {
  it("returns product.sessionCount as-is for flat products", () => {
    expect(
      computeProjectSessionCount({ pricingModel: "flat", sessionCount: 3 }, 5),
    ).toBe(3);
  });
  it("multiplies sessionCount by songQty for per_song products", () => {
    expect(
      computeProjectSessionCount(
        { pricingModel: "per_song", sessionCount: 2 },
        5,
      ),
    ).toBe(10);
  });
  it("returns 0 when product.sessionCount is 0 (unlimited stays unlimited)", () => {
    expect(
      computeProjectSessionCount(
        { pricingModel: "per_song", sessionCount: 0 },
        5,
      ),
    ).toBe(0);
  });
  it("treats null songQty as 1 for per_song (defensive against legacy bookings)", () => {
    expect(
      computeProjectSessionCount(
        { pricingModel: "per_song", sessionCount: 2 },
        null,
      ),
    ).toBe(2);
  });
  it("treats undefined songQty as 1 for per_song", () => {
    expect(
      computeProjectSessionCount(
        { pricingModel: "per_song", sessionCount: 2 },
        undefined,
      ),
    ).toBe(2);
  });
  it("ignores songQty entirely for bundle / hourly products", () => {
    expect(
      computeProjectSessionCount(
        { pricingModel: "bundle", sessionCount: 4 },
        7,
      ),
    ).toBe(4);
    expect(
      computeProjectSessionCount(
        { pricingModel: "hourly", sessionCount: 1 },
        7,
      ),
    ).toBe(1);
  });
});

describe("validateTiers", () => {
  it("returns no errors for a valid ascending ladder", () => {
    expect(validateTiers(TIERS)).toEqual({ errors: [], warnings: [] });
  });
  it("errors on duplicate minQty", () => {
    const bad = [
      { minQty: 1, pricePerUnitCents: 20000 },
      { minQty: 1, pricePerUnitCents: 17000 },
    ];
    expect(validateTiers(bad).errors).toContain("DUPLICATE_MIN_QTY");
  });
  it("errors on minQty < 1", () => {
    expect(validateTiers([{ minQty: 0, pricePerUnitCents: 100 }]).errors).toContain(
      "MIN_QTY_TOO_LOW",
    );
  });
  it("warns when price doesn't decrease with quantity", () => {
    const flat = [
      { minQty: 1, pricePerUnitCents: 20000 },
      { minQty: 5, pricePerUnitCents: 25000 },
    ];
    expect(validateTiers(flat).warnings).toContain("PRICE_NOT_DECREASING");
  });
});
