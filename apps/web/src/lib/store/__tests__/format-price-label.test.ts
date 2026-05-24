import { describe, expect, it } from "vitest";

import {
  formatCents,
  formatPriceLabel,
  planLabel,
} from "../format-price-label";

describe("formatCents", () => {
  it("renders USD with $ glyph", () => {
    expect(formatCents(12_50, "USD")).toBe("$12.5");
  });
  it("renders ILS with ₪ glyph", () => {
    expect(formatCents(10_000, "ILS")).toBe("₪100");
  });
  it("falls back to currency code when unknown", () => {
    expect(formatCents(5_00, "JPY")).toBe("JPY 5");
  });
});

describe("planLabel", () => {
  it("maps each pricing model to its label", () => {
    expect(planLabel("flat")).toBe("pay once");
    expect(planLabel("per_song")).toBe("per song");
    expect(planLabel("hourly")).toBe("per hour");
    expect(planLabel("bundle")).toBe("bundle");
  });
});

describe("formatPriceLabel", () => {
  it("flat → straight currency", () => {
    expect(
      formatPriceLabel({
        priceCents: 100_00,
        currency: "USD",
        pricingModel: "flat",
        volumeTiers: null,
      }),
    ).toBe("$100");
  });

  it("per_song with tiers → 'From $X/song'", () => {
    expect(
      formatPriceLabel({
        priceCents: 0,
        currency: "USD",
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 50_00 },
          { minQty: 5, pricePerUnitCents: 40_00 },
        ],
      }),
    ).toMatch(/from \$40\/song/i);
  });

  it("per_song with no tiers + no price → 'Variable'", () => {
    expect(
      formatPriceLabel({
        priceCents: 0,
        currency: "USD",
        pricingModel: "per_song",
        volumeTiers: null,
      }),
    ).toBe("Variable");
  });

  it("hourly → 'from $X'", () => {
    expect(
      formatPriceLabel({
        priceCents: 60_00,
        currency: "USD",
        pricingModel: "hourly",
        volumeTiers: null,
      }),
    ).toBe("from $60");
  });
});
