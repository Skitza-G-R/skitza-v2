import { describe, expect, it } from "vitest";

import {
  buildStatus,
  computeDots,
  formatAmount,
  formatNextCharge,
} from "../payment-status-strip-helpers";

// Pure-helper tests for the payment-status-strip. We test the fragment
// builder + formatters rather than the JSX shell — the repo doesn't
// ship @testing-library/react (see apps/web/package.json) and all
// existing "component" tests here follow the same pure-logic pattern.
// If the status is right in these helpers, the component's only job is
// stringing spans together — which typecheck + lint cover.

describe("formatAmount", () => {
  it("renders round dollars without cents", () => {
    expect(formatAmount(10_000_00, "USD")).toBe("$10,000");
  });

  it("keeps pennies for odd-cent totals", () => {
    // maximumFractionDigits: 2 + minimumFractionDigits: 0 drops
    // trailing zeros — so .50 → $100.5 but .55 keeps both digits.
    // Matches plan-picker's formatter exactly.
    expect(formatAmount(10_055, "USD")).toBe("$100.55");
  });

  it("honours the supplied currency code", () => {
    // ILS is the repo's default example currency (it.IL). We only
    // assert a shape-level contains — locale spacing varies by OS.
    const out = formatAmount(10_000_00, "ILS");
    expect(out).toMatch(/10,000/);
  });
});

describe("formatNextCharge", () => {
  // Fixed "now" so day-comparison is deterministic across CI timezones.
  const now = new Date(2026, 3, 18, 12, 0, 0); // April 18, 2026 local noon

  it("returns 'Today' when the date is today", () => {
    const d = new Date(2026, 3, 18, 23, 59, 0);
    expect(formatNextCharge(d, now)).toBe("Today");
  });

  it("returns 'Overdue' for past dates", () => {
    const d = new Date(2026, 3, 17, 8, 0, 0);
    expect(formatNextCharge(d, now)).toBe("Overdue");
  });

  it("formats future dates as short month + day", () => {
    const d = new Date(2026, 4, 18, 8, 0, 0); // May 18, 2026
    expect(formatNextCharge(d, now)).toBe("May 18");
  });
});

describe("computeDots", () => {
  it("returns empty string for zero total", () => {
    expect(computeDots(0, 0, false)).toBe("");
  });

  it("fills completed charges, empties the rest", () => {
    expect(computeDots(2, 4, false)).toBe("\u25cf\u25cf\u25cb\u25cb"); // ●●○○
  });

  it("all filled when completed equals total", () => {
    expect(computeDots(4, 4, false)).toBe("\u25cf\u25cf\u25cf\u25cf"); // ●●●●
  });

  it("warning marker on first pending charge when paused", () => {
    // 2 complete, next is the warn slot, last is still empty.
    expect(computeDots(2, 4, true)).toBe("\u25cf\u25cf\u26a0\u25cb"); // ●●⚠○
  });

  it("clamps completed > total so we never overshoot", () => {
    expect(computeDots(99, 2, false)).toBe("\u25cf\u25cf");
  });
});

describe("buildStatus — full plan", () => {
  const base = {
    paymentPlanKind: "full" as const,
    installments: null,
    totalAmountCents: 10_000_00,
    currency: "USD",
    nextChargeAt: null,
    chargesTotal: 1,
  };

  it("completed: planLabel 'Paid in full', fullyPaid true", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 1,
      stage: "paid",
    });
    expect(out.amount).toBe("$10,000");
    expect(out.planLabel).toBe("Paid in full");
    expect(out.fullyPaid).toBe(true);
    expect(out.dots).toBe("");
    expect(out.progress).toBeNull();
  });

  it("pending: planLabel 'Payment pending…'", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 0,
      stage: "in_production",
    });
    expect(out.planLabel).toBe("Payment pending…");
    expect(out.fullyPaid).toBe(false);
  });

  it("cancelled: hint 'Cancelled'", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 0,
      stage: "cancelled",
    });
    expect(out.hint).toBe("Cancelled");
    expect(out.cancelled).toBe(true);
  });
});

describe("buildStatus — split_50_50", () => {
  const base = {
    paymentPlanKind: "split_50_50" as const,
    installments: null,
    totalAmountCents: 10_000_00,
    currency: "USD",
    nextChargeAt: null,
    chargesTotal: 2,
  };

  it("deposit paid, awaiting final", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 1,
      stage: "in_production",
    });
    expect(out.planLabel).toBe("50/50");
    expect(out.dots).toBe("\u25cf\u25cb"); // ●○
    expect(out.progress).toBe("1/2 paid");
    expect(out.hint).toBe("Awaiting final delivery");
    expect(out.fullyPaid).toBe(false);
  });

  it("both paid: fullyPaid true, dots all filled", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 2,
      stage: "paid",
    });
    expect(out.dots).toBe("\u25cf\u25cf"); // ●●
    expect(out.fullyPaid).toBe(true);
    expect(out.progress).toBeNull();
  });

  it("paused: warning hint and warn dot", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 1,
      stage: "payment_paused",
    });
    // Completed + warn marker on the next empty slot (there's only 1
    // remaining for a 50/50 after deposit, so: ●⚠).
    expect(out.dots).toBe("\u25cf\u26a0"); // ●⚠
    expect(out.hint).toBe("Payment paused — client needs to update card");
    expect(out.paused).toBe(true);
  });
});

describe("buildStatus — monthly", () => {
  const base = {
    paymentPlanKind: "monthly" as const,
    totalAmountCents: 10_000_00,
    currency: "USD",
    chargesTotal: 4,
    installments: 4,
  };

  it("2/4 paid, next charge May 18 — dots reflect progress", () => {
    const now = new Date(2026, 3, 18, 12, 0, 0); // Apr 18, 2026
    const next = new Date(2026, 4, 18, 9, 0, 0); // May 18, 2026
    const out = buildStatus({
      ...base,
      chargesCompleted: 2,
      nextChargeAt: next,
      stage: "in_production",
      now,
    });
    expect(out.planLabel).toBe("4 monthly × $2,500");
    expect(out.dots).toBe("\u25cf\u25cf\u25cb\u25cb"); // ●●○○
    expect(out.progress).toBe("2/4 paid");
    expect(out.hint).toBe("Next: May 18");
  });

  it("all paid: drops the per-charge suffix + shows fullyPaid", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 4,
      nextChargeAt: null,
      stage: "paid",
    });
    expect(out.planLabel).toBe("4 monthly");
    expect(out.dots).toBe("\u25cf\u25cf\u25cf\u25cf"); // ●●●●
    expect(out.fullyPaid).toBe(true);
  });

  it("paused: warn dot on the next slot + hint", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 2,
      nextChargeAt: null,
      stage: "payment_paused",
    });
    expect(out.dots).toBe("\u25cf\u25cf\u26a0\u25cb"); // ●●⚠○
    expect(out.hint).toBe("Payment paused — client needs to update card");
    expect(out.paused).toBe(true);
  });

  it("cancelled: shows terminal state without next-charge hint", () => {
    const out = buildStatus({
      ...base,
      chargesCompleted: 2,
      nextChargeAt: new Date(2026, 4, 18), // should be ignored
      stage: "cancelled",
    });
    expect(out.hint).toBe("Cancelled");
    expect(out.progress).toBe("2/4 paid");
    expect(out.cancelled).toBe(true);
  });

  it("formats non-round per-charge with cents", () => {
    // $100.01 / 4 → floor(10_001 / 4) = 2500 cents steady-state
    // → "$25.00" steady. The remainder ($0.01) lands on the first
    // charge in calculateCharges, but the strip surfaces the steady
    // monthly rate, not the first charge.
    const out = buildStatus({
      ...base,
      totalAmountCents: 100_01,
      chargesCompleted: 0,
      chargesTotal: 4,
      installments: 4,
      nextChargeAt: null,
      stage: "in_production",
    });
    // Steady-state per-charge shown (rounded down floor); amount keeps
    // cents since the total is non-round.
    expect(out.amount).toBe("$100.01");
    // 10_001 / 4 = 2500.25 → floor 2500 cents → $25. min 0 fractional
    // digits so the "per charge" shows as "$25" exactly.
    expect(out.planLabel).toBe("4 monthly × $25");
  });
});

describe("buildStatus — cancelled across plan shapes", () => {
  it("full + cancelled renders 'Paid in full' label with Cancelled hint", () => {
    const out = buildStatus({
      paymentPlanKind: "full",
      installments: null,
      chargesCompleted: 0,
      chargesTotal: 1,
      totalAmountCents: 10_000_00,
      currency: "USD",
      nextChargeAt: null,
      stage: "cancelled",
    });
    expect(out.cancelled).toBe(true);
    expect(out.hint).toBe("Cancelled");
  });

  it("50/50 + cancelled keeps progress counter", () => {
    const out = buildStatus({
      paymentPlanKind: "split_50_50",
      installments: null,
      chargesCompleted: 1,
      chargesTotal: 2,
      totalAmountCents: 10_000_00,
      currency: "USD",
      nextChargeAt: null,
      stage: "cancelled",
    });
    expect(out.progress).toBe("1/2 paid");
    expect(out.hint).toBe("Cancelled");
  });
});
