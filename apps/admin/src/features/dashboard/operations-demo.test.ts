import { describe, expect, it } from "vitest";

import type { DemoAnalytics, DemoPayment, DemoProblem } from "~/lib/admin-demo-view-models";
import {
  buildAnalyticsCsv,
  filterAndSortPayments,
  filterProblems,
  paginateItems,
  parsePaymentView,
  transitionProblem,
} from "./operations-demo";

const payments: readonly DemoPayment[] = [
  {
    id: "demo_live_payment_a",
    producerUserId: "demo_live_user_maya",
    producer: "Maya",
    artist: "Ari",
    project: "Zeta",
    amount: "₪2,400",
    currency: "ILS",
    state: "Proof submitted",
    retrySupported: false,
    attentionReason: "Review",
    updatedAt: "12 min ago",
    timeline: [],
  },
  {
    id: "demo_live_payment_b",
    producerUserId: "demo_live_user_noah",
    producer: "Noah",
    artist: "Jamie",
    project: "Alpha",
    amount: "$680",
    currency: "USD",
    state: "Approved",
    retrySupported: false,
    updatedAt: "Yesterday",
    timeline: [],
  },
];

const problems: readonly DemoProblem[] = [
  {
    id: "demo_live_problem_a",
    title: "Email delayed",
    detail: "Delivery threshold passed",
    provider: "Resend",
    state: "New",
    severity: "Critical",
    firstSeenAt: "18 min ago",
  },
  {
    id: "demo_live_problem_b",
    title: "Recovered",
    detail: "Back to baseline",
    provider: "Clerk",
    state: "Resolved",
    severity: "Warning",
    firstSeenAt: "Yesterday",
  },
];

describe("operations demo helpers", () => {
  it("keeps payment views on the safe needs-attention default", () => {
    expect(parsePaymentView("all")).toBe("all");
    expect(parsePaymentView("attention")).toBe("attention");
    expect(parsePaymentView("unexpected")).toBe("attention");
    expect(parsePaymentView(undefined)).toBe("attention");
  });

  it("composes payment search, filters, and sorting without combining currencies", () => {
    expect(
      filterAndSortPayments({
        payments,
        query: "maya",
        currency: "ILS",
        state: "Proof submitted",
        attentionOnly: true,
        sort: "amount-desc",
      }).map((payment) => payment.id),
    ).toEqual(["demo_live_payment_a"]);

    expect(
      filterAndSortPayments({
        payments,
        query: "",
        currency: "all",
        state: "all",
        attentionOnly: false,
        sort: "project-asc",
      }).map((payment) => payment.project),
    ).toEqual(["Alpha", "Zeta"]);
  });

  it("clamps pagination to the available result pages", () => {
    expect(paginateItems([1, 2, 3], 99, 2)).toEqual({
      items: [3],
      page: 2,
      pageCount: 2,
      total: 3,
    });
  });

  it("filters open problems and applies immutable demo transitions", () => {
    expect(
      filterProblems({
        problems,
        query: "",
        provider: "all",
        severity: "all",
        state: "open",
      }).map((problem) => problem.id),
    ).toEqual(["demo_live_problem_a"]);

    const transitioned = transitionProblem(problems, "demo_live_problem_a", "Resolved");
    expect(transitioned[0]?.state).toBe("Resolved");
    expect(problems[0]?.state).toBe("New");
  });

  it("exports analytics with currencies on separate rows", () => {
    const analytics = {
      environment: "live",
      updatedAt: "now",
      metrics: [],
      activationCohorts: [],
      weeklyActive: [],
      retention: [],
      salesByCurrency: [
        { label: "ILS", value: 48240 },
        { label: "USD", value: 8420 },
      ],
    } satisfies DemoAnalytics;

    const csv = buildAnalyticsCsv(analytics);
    expect(csv).toContain("ILS,48240");
    expect(csv).toContain("USD,8420");
    expect(csv).not.toMatch(/combined|gmv/i);
  });
});
