import { describe, it, expect } from "vitest";
import { calculateCharges, advancePlanState } from "./plan";

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

describe("advancePlanState", () => {
  const baseProject = {
    chargesCompleted: 0,
    chargesTotal: 2,
    stage: "lead" as const,
  };

  it("first successful charge → active + completed=1", () => {
    const next = advancePlanState(baseProject, { type: "charge_succeeded" });
    expect(next.chargesCompleted).toBe(1);
    expect(next.stage).toBe("active");
  });

  it("final successful charge → paid", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, stage: "active" },
      { type: "charge_succeeded" },
    );
    expect(next.chargesCompleted).toBe(2);
    expect(next.stage).toBe("paid");
  });

  it("exhausted retries → payment_paused", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, chargesTotal: 4, stage: "active" },
      { type: "retries_exhausted" },
    );
    expect(next.stage).toBe("payment_paused");
    // Counter not incremented — charge didn't succeed
    expect(next.chargesCompleted).toBe(1);
  });

  it("resume from paused on next successful charge", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, chargesTotal: 4, stage: "payment_paused" },
      { type: "charge_succeeded" },
    );
    expect(next.stage).toBe("active");
    expect(next.chargesCompleted).toBe(2);
  });

  it("cancel event → cancelled, stops charges", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, chargesTotal: 4, stage: "active" },
      { type: "cancelled" },
    );
    expect(next.stage).toBe("cancelled");
    expect(next.chargesCompleted).toBe(1);
  });

  it("never exceeds chargesTotal (idempotency invariant)", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 2, chargesTotal: 2, stage: "paid" },
      { type: "charge_succeeded" },
    );
    // Already paid — duplicate webhook must not over-count
    expect(next.chargesCompleted).toBe(2);
    expect(next.stage).toBe("paid");
  });

  it("retries_exhausted is idempotent when already paused", () => {
    const already = { chargesCompleted: 1, chargesTotal: 4, stage: "payment_paused" as const };
    const next = advancePlanState(already, { type: "retries_exhausted" });
    expect(next.stage).toBe("payment_paused");
    expect(next.chargesCompleted).toBe(1);
  });
});
