import { describe, expect, it } from "vitest";

import {
  buildPlanOptions,
  chargesProgress,
  invoiceKindForCharge,
  planOption,
} from "./plan-preview";

describe("planOption / buildPlanOptions", () => {
  it("full plan is a single due-today charge", () => {
    const opt = planOption({ kind: "full" }, 240_000);
    expect(opt.charges).toEqual([240_000]);
    expect(opt.dueNowCents).toBe(240_000);
    expect(opt.labels).toEqual(["Due today"]);
  });

  it("split plan halves with the odd cent up front", () => {
    const opt = planOption({ kind: "split_50_50" }, 90_001);
    expect(opt.charges).toEqual([45_001, 45_000]);
    expect(opt.dueNowCents).toBe(45_001);
    expect(opt.labels).toEqual(["Due today", "On delivery"]);
  });

  it("monthly plan carries installments and month labels", () => {
    const opt = planOption({ kind: "monthly", installments: 3 }, 90_000);
    expect(opt.installments).toBe(3);
    expect(opt.charges).toEqual([30_000, 30_000, 30_000]);
    expect(opt.labels).toEqual(["Due today", "Month 2", "Month 3"]);
  });

  it("milestones plan uses the schedule labels and sums exactly", () => {
    const opt = planOption(
      {
        kind: "milestones",
        milestones: [
          { label: "Booking", pct: 30 },
          { label: "Mix approved", pct: 40 },
          { label: "Delivery", pct: 30 },
        ],
      },
      960_00 + 1, // 96,001 agorot — forces a rounding remainder
    );
    expect(opt.charges.reduce((a, b) => a + b, 0)).toBe(96_001);
    expect(opt.labels).toEqual(["Booking", "Mix approved", "Delivery"]);
  });

  it("buildPlanOptions maps every offered plan", () => {
    const opts = buildPlanOptions([{ kind: "full" }, { kind: "split_50_50" }], 100_000);
    expect(opts.map((o) => o.kind)).toEqual(["full", "split_50_50"]);
  });
});

describe("chargesProgress", () => {
  const charges = [45_000, 45_000];

  it("starts with nothing completed and the first charge due", () => {
    expect(chargesProgress(charges, 0)).toEqual({
      chargesCompleted: 0,
      remainingCents: 90_000,
      reservedCents: 0,
      availableToSubmitCents: 90_000,
      nextDueCents: 45_000,
    });
  });

  it("completes charges cumulatively", () => {
    expect(chargesProgress(charges, 45_000)).toEqual({
      chargesCompleted: 1,
      remainingCents: 45_000,
      reservedCents: 0,
      availableToSubmitCents: 45_000,
      nextDueCents: 45_000,
    });
  });

  it("part-covers the next charge when a proof overshoots a boundary", () => {
    const p = chargesProgress(charges, 60_000);
    expect(p.chargesCompleted).toBe(1);
    expect(p.remainingCents).toBe(30_000);
    expect(p.nextDueCents).toBe(30_000);
  });

  it("fully paid → no next charge", () => {
    expect(chargesProgress(charges, 90_000)).toEqual({
      chargesCompleted: 2,
      remainingCents: 0,
      reservedCents: 0,
      availableToSubmitCents: 0,
      nextDueCents: null,
    });
  });

  it("clamps overpayment to zero remaining", () => {
    expect(chargesProgress(charges, 95_000).remainingCents).toBe(0);
  });

  it("reserves pending proofs so two submissions cannot exceed the balance", () => {
    expect(chargesProgress(charges, 0, 45_000)).toMatchObject({
      remainingCents: 90_000,
      reservedCents: 45_000,
      availableToSubmitCents: 45_000,
    });
    expect(chargesProgress(charges, 30_000, 80_000)).toMatchObject({
      remainingCents: 60_000,
      reservedCents: 60_000,
      availableToSubmitCents: 0,
    });
  });
});

describe("invoiceKindForCharge", () => {
  it("single-charge plans are 'full'", () => {
    expect(invoiceKindForCharge("full", 0, 1)).toBe("full");
  });
  it("first of many is 'deposit', last is 'final', middles are 'milestone'", () => {
    expect(invoiceKindForCharge("milestones", 0, 3)).toBe("deposit");
    expect(invoiceKindForCharge("milestones", 1, 3)).toBe("milestone");
    expect(invoiceKindForCharge("milestones", 2, 3)).toBe("final");
    expect(invoiceKindForCharge("split_50_50", 1, 2)).toBe("final");
  });
});
