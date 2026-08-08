import { describe, expect, it } from "vitest";

import { offeredPlans, planIsOffered } from "../request-helpers";

describe("purchase request payment plans", () => {
  it("returns every authored plan without mutating the product value", () => {
    const paymentPlans = [
      { kind: "full" as const },
      { kind: "split_50_50" as const },
      { kind: "monthly" as const, installments: 4 },
    ];

    const offered = offeredPlans({ paymentPlans });

    expect(offered).toEqual(paymentPlans);
    expect(offered).not.toBe(paymentPlans);
  });

  it("requires an exact installment count for monthly selections", () => {
    const offered = [{ kind: "monthly" as const, installments: 4 }];

    expect(planIsOffered({ kind: "monthly", installments: 4 }, offered)).toBe(true);
    expect(planIsOffered({ kind: "monthly", installments: 6 }, offered)).toBe(false);
    expect(planIsOffered({ kind: "full" }, offered)).toBe(false);
  });
});
