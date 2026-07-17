import { describe, expect, it } from "vitest";

import {
  calendarPaymentSummary,
  mergePreservedPaymentPlans,
  normalizeProductPaymentPlans,
  selectFallbackPaymentPlan,
  selectProvisionalRequestPaymentPlan,
} from "./payment-plans";

describe("normalizeProductPaymentPlans", () => {
  it("orders plans deterministically", () => {
    expect(
      normalizeProductPaymentPlans([
        { kind: "monthly", installments: 6 },
        { kind: "split_50_50" },
        { kind: "full" },
      ]),
    ).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 6 },
    ]);
  });

  it("applies an edited selection without retaining removed existing plans", () => {
    expect(
      mergePreservedPaymentPlans(
        [{ kind: "monthly", installments: 4 }, { kind: "split_50_50" }],
        [{ kind: "full" }],
      ),
    ).toEqual([{ kind: "split_50_50" }, { kind: "monthly", installments: 4 }]);
  });
});

describe("selectFallbackPaymentPlan", () => {
  it("prefers pay in full even when it is not first", () => {
    expect(
      selectFallbackPaymentPlan([
        { kind: "monthly", installments: 4 },
        { kind: "full" },
        { kind: "split_50_50" },
      ]),
    ).toEqual({ kind: "full" });
  });

  it("otherwise chooses the first offered plan", () => {
    expect(
      selectFallbackPaymentPlan([
        { kind: "monthly", installments: 3 },
        { kind: "split_50_50" },
      ]),
    ).toEqual({ kind: "monthly", installments: 3 });
  });

  it("falls back safely when no plan exists", () => {
    expect(selectFallbackPaymentPlan([])).toEqual({ kind: "full" });
    expect(selectFallbackPaymentPlan(null)).toEqual({ kind: "full" });
  });
});

describe("calendarPaymentSummary", () => {
  it("uses cent-accurate first-charge math and clear copy", () => {
    expect(calendarPaymentSummary(10_003, [{ kind: "monthly", installments: 3 }])).toEqual({
      selectedPlan: { kind: "monthly", installments: 3 },
      planKind: "monthly",
      amountCents: 3_335,
      plan: "monthly",
      planLabel: "3 monthly payments",
    });
  });

  it("uses full-payment priority for calendar flows", () => {
    expect(
      calendarPaymentSummary(10_003, [{ kind: "split_50_50" }, { kind: "full" }]),
    ).toMatchObject({
      planKind: "full",
      amountCents: 10_003,
      plan: "upfront",
      planLabel: "Pay in full",
    });
  });
});

describe("selectProvisionalRequestPaymentPlan", () => {
  it("prefers a genuinely offered full plan and returns null for no offers", () => {
    expect(
      selectProvisionalRequestPaymentPlan([{ kind: "monthly", installments: 3 }, { kind: "full" }]),
    ).toEqual({ kind: "full" });
    expect(
      selectProvisionalRequestPaymentPlan([{ kind: "monthly", installments: 3 }]),
    ).toEqual({ kind: "monthly", installments: 3 });
    expect(selectProvisionalRequestPaymentPlan([])).toBeNull();
  });
});
