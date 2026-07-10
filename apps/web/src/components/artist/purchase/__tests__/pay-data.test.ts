import { describe, expect, it } from "vitest";

import {
  amountDueNowCents,
  formatShekels,
  livePlanOptions,
  nextPlanIndex,
  paidProgress,
  paymentPlanLabel,
  planOptions,
  proofStatusCopy,
  type PlanOption,
} from "../pay-data";

// Pure money-math unit tests (no clock, no randomness) for the Pay section.
// Every schedule MUST sum to the total exactly — agorot can't go missing.

describe("planOptions", () => {
  it("'full' is one row that equals the total, due now = total", () => {
    const opts = planOptions(240000, ["full"]);
    expect(opts).toHaveLength(1);
    const full = opts[0] as PlanOption;
    expect(full.plan).toBe("full");
    expect(full.schedule).toHaveLength(1);
    expect(full.schedule[0]?.label).toBe("Today");
    expect(full.schedule[0]?.amountCents).toBe(240000);
    expect(sum(full)).toBe(240000);
    expect(full.dueNowCents).toBe(240000);
  });

  it("'split' is 50/50 two rows summing to total; due now = ceil(half) on odd cents", () => {
    const opts = planOptions(240001, ["split"]);
    expect(opts).toHaveLength(1);
    const split = opts[0] as PlanOption;
    expect(split.plan).toBe("split");
    expect(split.schedule).toHaveLength(2);
    expect(split.schedule[0]?.label).toBe("Today");
    expect(split.schedule[1]?.label).toBe("On delivery");
    // first row = ceil(total/2) = 120001, second = 120000
    expect(split.schedule[0]?.amountCents).toBe(120001);
    expect(split.schedule[1]?.amountCents).toBe(120000);
    expect(sum(split)).toBe(240001);
    expect(split.dueNowCents).toBe(120001);
  });

  it("'milestones' is three rows summing to total exactly with remainder on the first", () => {
    // 240001 / 3 = 80000.333… → remainder 1 goes to the first row
    const opts = planOptions(240001, ["milestones"]);
    const m = opts[0] as PlanOption;
    expect(m.plan).toBe("milestones");
    expect(m.schedule).toHaveLength(3);
    expect(m.schedule.map((s) => s.label)).toEqual(["Today", "Mid-project", "On delivery"]);
    expect(m.schedule[0]?.amountCents).toBe(80001);
    expect(m.schedule[1]?.amountCents).toBe(80000);
    expect(m.schedule[2]?.amountCents).toBe(80000);
    expect(sum(m)).toBe(240001);
    expect(m.dueNowCents).toBe(80001);
  });

  it("returns options in the requested order", () => {
    const opts = planOptions(240000, ["full", "split", "milestones"]);
    expect(opts.map((o) => o.plan)).toEqual(["full", "split", "milestones"]);
  });
});

describe("amountDueNowCents", () => {
  it("returns the option's dueNowCents", () => {
    const [split] = planOptions(240000, ["split"]);
    expect(amountDueNowCents(split as PlanOption)).toBe(120000);
  });
});

describe("livePlanOptions", () => {
  it("maps frozen server plans, including monthly, without changing amounts", () => {
    const options = livePlanOptions([
      {
        kind: "monthly",
        installments: 3,
        charges: [80001, 80000, 80000],
        dueNowCents: 80001,
        labels: ["Due today", "Month 2", "Month 3"],
      },
    ]);
    expect(options[0]).toMatchObject({
      id: "monthly-3",
      choice: { kind: "monthly", installments: 3 },
      title: "3 monthly payments",
      dueNowCents: 80001,
    });
    expect(options[0]?.schedule.reduce((sum, row) => sum + row.amountCents, 0)).toBe(240001);
  });

  it("uses clear labels for every server plan kind", () => {
    expect(paymentPlanLabel("full")).toBe("Pay in full");
    expect(paymentPlanLabel("split_50_50")).toBe("Split 50 / 50");
    expect(paymentPlanLabel("milestones")).toBe("Milestone payments");
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

function sum(opt: PlanOption): number {
  return opt.schedule.reduce((acc, row) => acc + row.amountCents, 0);
}
