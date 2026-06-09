import { describe, expect, it } from "vitest";

import {
  snapshotProductPrice,
  validatePerSongUnit,
} from "../price-snapshot";

const TIERS = [
  { minQty: 1, pricePerUnitCents: 10_000 },
  { minQty: 5, pricePerUnitCents: 8_000 },
  { minQty: 10, pricePerUnitCents: 6_000 },
];

describe("snapshotProductPrice", () => {
  it("flat → canonical priceCents, no per-unit/qty", () => {
    const snap = snapshotProductPrice({
      pricingModel: "flat",
      priceCents: 250_000,
      hourlyRateCents: null,
      volumeTiers: null,
    });
    expect(snap).toEqual({ priceCents: 250_000, unitPriceCents: null, songQty: null });
  });

  it("bundle → canonical priceCents (same as flat)", () => {
    const snap = snapshotProductPrice({
      pricingModel: "bundle",
      priceCents: 990_000,
      hourlyRateCents: null,
      volumeTiers: null,
    });
    expect(snap).toEqual({ priceCents: 990_000, unitPriceCents: null, songQty: null });
  });

  it("hourly → locks the hourly rate as both price and unit", () => {
    const snap = snapshotProductPrice({
      pricingModel: "hourly",
      priceCents: 0,
      hourlyRateCents: 15_000,
      volumeTiers: null,
    });
    expect(snap).toEqual({ priceCents: 15_000, unitPriceCents: 15_000, songQty: null });
  });

  it("hourly with no rate set → 0 (caller rejects on priceCents<=0)", () => {
    const snap = snapshotProductPrice({
      pricingModel: "hourly",
      priceCents: 0,
      hourlyRateCents: null,
      volumeTiers: null,
    });
    expect(snap.priceCents).toBe(0);
  });

  it("per_song → songQty × unit, carries qty + unit", () => {
    const snap = snapshotProductPrice(
      { pricingModel: "per_song", priceCents: 0, hourlyRateCents: null, volumeTiers: TIERS },
      { songQty: 5, unitPriceCents: 8_000 },
    );
    expect(snap).toEqual({ priceCents: 40_000, unitPriceCents: 8_000, songQty: 5 });
  });

  it("per_song with no opts → falls back to qty 1 at first tier (never NaN)", () => {
    const snap = snapshotProductPrice({
      pricingModel: "per_song",
      priceCents: 0,
      hourlyRateCents: null,
      volumeTiers: TIERS,
    });
    expect(snap).toEqual({ priceCents: 10_000, unitPriceCents: 10_000, songQty: 1 });
  });

  it("unknown/legacy model → treated as flat", () => {
    const snap = snapshotProductPrice({
      pricingModel: "mystery",
      priceCents: 12_345,
      hourlyRateCents: null,
      volumeTiers: null,
    });
    expect(snap).toEqual({ priceCents: 12_345, unitPriceCents: null, songQty: null });
  });
});

describe("validatePerSongUnit", () => {
  it("accepts a unit price that matches the tier ladder", () => {
    expect(validatePerSongUnit({ volumeTiers: TIERS }, 10, 6_000)).toEqual({
      ok: true,
      songQty: 10,
      unitPriceCents: 6_000,
    });
  });

  it("rejects a tampered (too cheap) unit price", () => {
    expect(validatePerSongUnit({ volumeTiers: TIERS }, 1, 6_000)).toEqual({ ok: false });
  });

  it("rejects missing qty/unit", () => {
    expect(validatePerSongUnit({ volumeTiers: TIERS }, null, 10_000)).toEqual({ ok: false });
    expect(validatePerSongUnit({ volumeTiers: TIERS }, 5, null)).toEqual({ ok: false });
  });

  it("rejects non-positive / non-integer qty", () => {
    expect(validatePerSongUnit({ volumeTiers: TIERS }, 0, 10_000)).toEqual({ ok: false });
    expect(validatePerSongUnit({ volumeTiers: TIERS }, 2.5, 10_000)).toEqual({ ok: false });
  });
});
