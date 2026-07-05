import { describe, expect, it } from "vitest";
import type { PaymentPlan } from "@skitza/db";

import {
  generateRefNumber,
  isUniqueViolation,
  offeredPlans,
  planIsOffered,
} from "~/lib/purchase/request-helpers";

describe("planIsOffered", () => {
  const offered: PaymentPlan[] = [
    { kind: "full" },
    { kind: "monthly", installments: 6 },
  ];

  it("accepts a plan the product offers (by kind)", () => {
    expect(planIsOffered({ kind: "full" }, offered)).toBe(true);
  });

  it("rejects a plan the product doesn't offer", () => {
    expect(planIsOffered({ kind: "split_50_50" }, offered)).toBe(false);
  });

  it("matches monthly only when the installment count matches", () => {
    expect(planIsOffered({ kind: "monthly", installments: 6 }, offered)).toBe(true);
    expect(planIsOffered({ kind: "monthly", installments: 3 }, offered)).toBe(false);
  });

  it("rejects anything against an empty offer list", () => {
    expect(planIsOffered({ kind: "full" }, [])).toBe(false);
  });
});

describe("generateRefNumber", () => {
  it("matches the SK-XXXXXX format (6 uppercase base36 chars)", () => {
    expect(generateRefNumber()).toMatch(/^SK-[0-9A-Z]{6}$/);
  });

  it("is overwhelmingly unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateRefNumber());
    // Allow a vanishingly small collision tolerance; in practice 0.
    expect(seen.size).toBeGreaterThan(4990);
  });
});

describe("isUniqueViolation", () => {
  it("detects postgres unique-violation shapes", () => {
    expect(isUniqueViolation(new Error("duplicate key value violates unique constraint"))).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("offeredPlans (BE-2)", () => {
  it("passes through the paymentPlans array", () => {
    expect(
      offeredPlans({
        paymentPlans: [{ kind: "full" }],
        depositModel: "flat",
        milestones: null,
      }),
    ).toEqual([{ kind: "full" }]);
  });

  it("appends a virtual milestones plan when the deposit model is milestone-based", () => {
    const ms = [
      { label: "Booking", pct: 50 },
      { label: "Delivery", pct: 50 },
    ];
    const plans = offeredPlans({
      paymentPlans: [{ kind: "full" }],
      depositModel: "milestones",
      milestones: ms,
    });
    expect(plans).toEqual([
      { kind: "full" },
      { kind: "milestones", milestones: ms },
    ]);
  });

  it("ignores an empty milestone schedule", () => {
    expect(
      offeredPlans({
        paymentPlans: [{ kind: "full" }],
        depositModel: "milestones",
        milestones: [],
      }),
    ).toEqual([{ kind: "full" }]);
  });

  it("a milestones CHOICE matches an offered milestones plan by kind", () => {
    const offered = offeredPlans({
      paymentPlans: [],
      depositModel: "milestones",
      milestones: [{ label: "All", pct: 100 }],
    });
    expect(planIsOffered({ kind: "milestones" }, offered)).toBe(true);
    expect(planIsOffered({ kind: "full" }, offered)).toBe(false);
  });
});
