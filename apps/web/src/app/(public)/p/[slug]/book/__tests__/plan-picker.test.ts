import { describe, it, expect } from "vitest";
import { planKey, planLabel } from "../plan-picker-helpers";

// Pure string formatter — cents in, USD dollars out. Mirrors the
// production formatter in plan-picker.tsx so tests lock in the same
// decimal behavior users see.
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

describe("planLabel", () => {
  it("full plan renders 'Pay in full — $X today'", () => {
    const label = planLabel({ kind: "full" }, 10_000_00, fmt);
    expect(label).toBe("Pay in full — $10,000 today");
  });

  it("50/50 plan splits total evenly", () => {
    const label = planLabel({ kind: "split_50_50" }, 10_000_00, fmt);
    expect(label).toBe("50/50 — $5,000 now, $5,000 on delivery");
  });

  it("50/50 plan puts remainder on first charge when total is odd", () => {
    // 10_001 cents → first 5001, second 5000
    const label = planLabel({ kind: "split_50_50" }, 10_001, fmt);
    // formatter rounds to whole dollars, but the underlying cent math
    // matches calculateCharges (remainder on first)
    expect(label).toMatch(/^50\/50 — /);
    // Invariant: first amount >= second amount. Formatter may include
    // decimals (e.g. "$50.01 now, $50.00 on delivery") so accept both.
    const matches = label.match(/\$([\d,]+(?:\.\d+)?) now, \$([\d,]+(?:\.\d+)?)/);
    expect(matches).not.toBeNull();
    if (!matches) return;
    const firstStr = matches[1];
    const secondStr = matches[2];
    expect(firstStr).toBeDefined();
    expect(secondStr).toBeDefined();
    if (!firstStr || !secondStr) return;
    const first = Number(firstStr.replace(/,/g, ""));
    const second = Number(secondStr.replace(/,/g, ""));
    expect(first).toBeGreaterThanOrEqual(second);
  });

  it("monthly plan shows per-charge + remaining count", () => {
    const label = planLabel(
      { kind: "monthly", installments: 4 },
      10_000_00,
      fmt,
    );
    expect(label).toBe("Monthly — $2,500 today, then $2,500/month for 3 months");
  });

  it("monthly plan with 12 installments", () => {
    const label = planLabel(
      { kind: "monthly", installments: 12 },
      12_000_00,
      fmt,
    );
    expect(label).toContain("for 11 months");
  });

  it("monthly label: remainder on first charge is shown correctly", () => {
    // 10_003 cents / 3 installments: calculateCharges returns [3_335, 3_334, 3_334]
    // Label should reflect first=$33.35, rest=$33.34
    const fmt = (c: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(c / 100);
    const label = planLabel({ kind: "monthly", installments: 3 }, 10_003, fmt);
    expect(label).toMatch(/\$33\.35 today.*\$33\.34\/month for 2 months/);
  });
});
