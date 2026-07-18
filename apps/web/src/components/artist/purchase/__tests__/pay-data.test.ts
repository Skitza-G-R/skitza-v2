import { describe, expect, it } from "vitest";

import {
  formatShekels,
  livePlanOptions,
  nextPlanIndex,
  paidProgress,
  parsePaymentPlanSearch,
  paymentPlanAgreementHref,
  paymentPlanLabel,
  paymentPlanSearch,
  proofStatusCopy,
} from "../pay-data";

// Pure money-math unit tests (no clock, no randomness) for the Pay section.
// Every schedule MUST sum to the total exactly — agorot can't go missing.

describe("livePlanOptions", () => {
  it("maps frozen server plans, including monthly, without changing amounts", () => {
    const options = livePlanOptions([
      {
        kind: "monthly",
        installments: 3,
        charges: [80001, 80000, 80000],
        dueNowCents: 80001,
        labels: ["stale first label", "stale second label", "stale third label"],
      },
    ]);
    expect(options[0]).toMatchObject({
      id: "monthly-3",
      choice: { kind: "monthly", installments: 3 },
      title: "3 monthly payments",
      dueNowCents: 80001,
    });
    expect(options[0]?.schedule.map((row) => row.label)).toEqual([
      "First payment due at acceptance",
      "Monthly payment 2",
      "Monthly payment 3",
    ]);
    expect(options[0]?.schedule.reduce((sum, row) => sum + row.amountCents, 0)).toBe(240001);
  });

  it("uses clear labels for every server plan kind", () => {
    expect(paymentPlanLabel("full")).toBe("Pay in full");
    expect(paymentPlanLabel("split_50_50")).toBe("Split 50 / 50");
    expect(paymentPlanLabel("monthly", 4)).toBe("4 monthly payments");
  });
});

describe("nextPlanIndex", () => {
  it("wraps arrow navigation and supports Home and End", () => {
    expect(nextPlanIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextPlanIndex(0, 3, "ArrowDown")).toBe(1);
    expect(nextPlanIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextPlanIndex(2, 3, "ArrowUp")).toBe(1);
    expect(nextPlanIndex(2, 3, "Home")).toBe(0);
    expect(nextPlanIndex(0, 3, "End")).toBe(2);
    expect(nextPlanIndex(1, 3, "Enter")).toBeNull();
  });
});

describe("payment plan agreement route", () => {
  it("round-trips every enabled paid plan without persisting a choice", () => {
    expect(paymentPlanSearch({ kind: "full" })).toBe("plan=full");
    expect(paymentPlanSearch({ kind: "split_50_50" })).toBe("plan=split_50_50");
    expect(paymentPlanSearch({ kind: "monthly", installments: 4 })).toBe(
      "plan=monthly&installments=4",
    );
    expect(parsePaymentPlanSearch({ plan: "monthly", installments: "4" })).toEqual({
      kind: "monthly",
      installments: 4,
    });
    expect(
      paymentPlanAgreementHref({
        productId: "product-1",
        purchaseRequestId: "request-1",
        choice: { kind: "split_50_50" },
      }),
    ).toBe("/artist/purchase/product-1/agree?req=request-1&plan=split_50_50");
  });

  it("rejects disabled or malformed query choices", () => {
    expect(parsePaymentPlanSearch({ plan: "milestones" })).toBeNull();
    expect(parsePaymentPlanSearch({ plan: "monthly", installments: "1" })).toBeNull();
    expect(parsePaymentPlanSearch({ plan: "monthly", installments: "13" })).toBeNull();
    expect(parsePaymentPlanSearch({ plan: "monthly", installments: "3.5" })).toBeNull();
  });
});

describe("paidProgress", () => {
  it("nothing paid → 0%, not paid in full, remaining = total", () => {
    const p = paidProgress(0, 240000);
    expect(p.pct).toBe(0);
    expect(p.isPaidInFull).toBe(false);
    expect(p.remainingCents).toBe(240000);
    expect(p.paidLabel).toBe("₪0");
    expect(p.totalLabel).toBe("₪2,400");
  });

  it("half paid → ~50%, remaining = half", () => {
    const p = paidProgress(120000, 240000);
    expect(p.pct).toBe(50);
    expect(p.isPaidInFull).toBe(false);
    expect(p.remainingCents).toBe(120000);
  });

  it("fully paid → 100%, paid in full, remaining 0", () => {
    const p = paidProgress(240000, 240000);
    expect(p.pct).toBe(100);
    expect(p.isPaidInFull).toBe(true);
    expect(p.remainingCents).toBe(0);
  });

  it("over-paid → clamps pct to 100 and remaining to 0", () => {
    const p = paidProgress(300000, 240000);
    expect(p.pct).toBe(100);
    expect(p.isPaidInFull).toBe(true);
    expect(p.remainingCents).toBe(0);
  });
});

describe("proofStatusCopy", () => {
  it("maps each status to its tone", () => {
    expect(proofStatusCopy("empty").tone).toBe("neutral");
    expect(proofStatusCopy("attached").tone).toBe("neutral");
    expect(proofStatusCopy("uploading").tone).toBe("pending");
    expect(proofStatusCopy("awaiting").tone).toBe("pending");
    expect(proofStatusCopy("rejected").tone).toBe("danger");
    expect(proofStatusCopy("paid").tone).toBe("success");
  });

  it("weaves the producer name into the awaiting headline", () => {
    expect(proofStatusCopy("awaiting", "Gili Studio").headline).toContain("Gili Studio");
  });

  it("paid headline confirms sessions unlocked", () => {
    expect(proofStatusCopy("paid").headline.toLowerCase()).toContain("unlocked");
  });
});

describe("formatShekels re-export", () => {
  it("is the same whole-shekel formatter", () => {
    expect(formatShekels(240000)).toBe("₪2,400");
  });
});
