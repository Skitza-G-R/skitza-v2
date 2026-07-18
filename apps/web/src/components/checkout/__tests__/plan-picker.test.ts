import { describe, it, expect } from "vitest";
import { planKey, requestPlanLabel } from "../plan-picker-helpers";

// Pure string formatter — cents in, USD dollars out.
const fmt = (c: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(c / 100);

describe("planKey", () => {
  it("returns 'full' for a full plan", () => {
    expect(planKey({ kind: "full" })).toBe("full");
  });

  it("returns 'split_50_50' for a 50/50 plan", () => {
    expect(planKey({ kind: "split_50_50" })).toBe("split_50_50");
  });

  it("embeds installments count for monthly plans", () => {
    expect(planKey({ kind: "monthly", installments: 3 })).toBe("monthly_3");
    expect(planKey({ kind: "monthly", installments: 12 })).toBe("monthly_12");
  });

  it("distinguishes monthly plans with different installment counts", () => {
    expect(planKey({ kind: "monthly", installments: 3 })).not.toBe(
      planKey({ kind: "monthly", installments: 6 }),
    );
  });
});

describe("requestPlanLabel", () => {
  it("uses the immutable acceptance and artist-approval triggers", () => {
    expect(requestPlanLabel({ kind: "full" }, 10_000, fmt)).toBe(
      "Pay in full — $100 at acceptance",
    );
    expect(requestPlanLabel({ kind: "split_50_50" }, 10_001, fmt)).toBe(
      "50/50 — $50.01 at acceptance, $50 when the artist approves the final version",
    );
    expect(requestPlanLabel({ kind: "monthly", installments: 3 }, 10_003, fmt)).toBe(
      "Monthly — 3 payments; $33.35 at acceptance, then $33.34 monthly",
    );
  });
});
