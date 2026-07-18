import { describe, it, expect } from "vitest";
import { calculateCharges } from "./plan";

describe("calculateCharges", () => {
  it("returns a single charge for 'full'", () => {
    expect(calculateCharges({ kind: "full" }, 10_000_00))
      .toEqual([10_000_00]);
  });

  it("splits 50/50 evenly", () => {
    expect(calculateCharges({ kind: "split_50_50" }, 10_000_00))
      .toEqual([5_000_00, 5_000_00]);
  });

  it("splits 50/50 with odd cents (remainder on first)", () => {
    // 10_001 cents / 2 → 5001 + 5000
    expect(calculateCharges({ kind: "split_50_50" }, 10_001))
      .toEqual([5_001, 5_000]);
  });

  it("splits monthly evenly", () => {
    expect(calculateCharges({ kind: "monthly", installments: 4 }, 10_000_00))
      .toEqual([2_500_00, 2_500_00, 2_500_00, 2_500_00]);
  });

  it("splits monthly with remainder on first", () => {
    // 10_003 / 3 → 3335 + 3334 + 3334
    expect(calculateCharges({ kind: "monthly", installments: 3 }, 10_003))
      .toEqual([3_335, 3_334, 3_334]);
  });

  it("throws on zero total", () => {
    expect(() => calculateCharges({ kind: "full" }, 0))
      .toThrow(/positive/);
  });

  it("throws on installments < 2", () => {
    expect(() => calculateCharges({ kind: "monthly", installments: 1 }, 100))
      .toThrow(/between 2 and 12/);
  });

  it("throws on installments > 12", () => {
    expect(() => calculateCharges({ kind: "monthly", installments: 13 }, 100))
      .toThrow(/between 2 and 12/);
  });

  it("splits monthly with perfect division (no remainder)", () => {
    // 1200 / 12 → [100] × 12
    expect(calculateCharges({ kind: "monthly", installments: 12 }, 1200))
      .toEqual(Array.from({ length: 12 }, () => 100));
  });

  it("splits 50/50 of 2 cents (boundary) → [1, 1]", () => {
    expect(calculateCharges({ kind: "split_50_50" }, 2))
      .toEqual([1, 1]);
  });

  it("splits 50/50 of 3 cents (boundary, odd) → [2, 1]", () => {
    expect(calculateCharges({ kind: "split_50_50" }, 3))
      .toEqual([2, 1]);
  });

  it("throws on negative total", () => {
    expect(() => calculateCharges({ kind: "full" }, -100))
      .toThrow(/positive integer/);
  });

  it("throws on non-integer total", () => {
    expect(() => calculateCharges({ kind: "full" }, 100.5))
      .toThrow(/positive integer/);
  });
});
