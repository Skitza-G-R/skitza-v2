import { describe, expect, it } from "vitest";

import type { PaymentPlan } from "@skitza/db";

import {
  calendarPaymentSummary,
  mergePreservedPaymentPlans,
  normalizeProductPaymentPlans,
  selectFallbackPaymentPlan,
  selectProvisionalRequestPaymentPlan,
} from "./payment-plans";

describe("normalizeProductPaymentPlans", () => {
  it("orders standard plans deterministically and preserves milestone data", () => {
    const milestone: PaymentPlan = {
      kind: "milestones",
      milestones: [
        { label: "Booking", pct: 40 },
        { label: "Delivery", pct: 60 },
      ],
    };

    expect(
      normalizeProductPaymentPlans([
        { kind: "monthly", installments: 6 },
        milestone,
        { kind: "split_50_50" },
        { kind: "full" },
      ]),
    ).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 6 },
      milestone,
    ]);
  });

  it("merges an edited standard selection without losing or duplicating preserved milestones", () => {
    const milestone: PaymentPlan = {
      kind: "milestones",
      milestones: [{ label: "Delivery", pct: 100 }],
    };

    expect(
      mergePreservedPaymentPlans(
        [{ kind: "split_50_50" }, milestone],
        [{ kind: "full" }, milestone],
      ),
    ).toEqual([{ kind: "split_50_50" }, milestone]);
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

  it("otherwise chooses the first supported standard plan", () => {
    expect(
      selectFallbackPaymentPlan([
        { kind: "milestones", milestones: [{ label: "Delivery", pct: 100 }] },
        { kind: "monthly", installments: 3 },
        { kind: "split_50_50" },
      ]),
    ).toEqual({ kind: "monthly", installments: 3 });
  });

  it("falls back safely when no supported plan exists", () => {
    expect(
      selectFallbackPaymentPlan([
        { kind: "milestones", milestones: [{ label: "Delivery", pct: 100 }] },
      ]),
    ).toEqual({ kind: "full" });
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
  it("keeps a milestone-only request on the offered milestone choice", () => {
    expect(
      selectProvisionalRequestPaymentPlan([
        { kind: "milestones", milestones: [{ label: "Delivery", pct: 100 }] },
      ]),
    ).toEqual({ kind: "milestones" });
  });

  it("prefers a genuinely offered full plan and returns null for no offers", () => {
    expect(
      selectProvisionalRequestPaymentPlan([{ kind: "monthly", installments: 3 }, { kind: "full" }]),
    ).toEqual({ kind: "full" });
    expect(selectProvisionalRequestPaymentPlan([])).toBeNull();
  });
});
