// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PaymentHistoryViewData } from "~/components/payments/payment-history-view";

import { PaymentsTab, type ProjectPaymentsTabData } from "../project-payments-tab";

vi.mock("~/components/payments/payment-history-view", () => ({
  PaymentHistoryView: ({ data }: { data: PaymentHistoryViewData }) => (
    <div data-testid={`payment-section-${data.section.id}`}>{data.section.title}</div>
  ),
}));

vi.mock("~/components/dashboard/projects/project-purchases-panel", () => ({
  ProjectPurchasesPanel: () => <div data-testid="purchases-panel">Purchases &amp; add-ons</div>,
}));

function paymentView(id: string, title: string, hasPurchases: boolean): PaymentHistoryViewData {
  return {
    section: {
      id,
      eyebrow: "Payments",
      title,
      description: title,
      emptyTitle: "Empty",
      emptyDescription: "Empty",
    },
    currencyTotals: [],
    projects: hasPurchases
      ? ([
          {
            id: `${id}-project`,
            title: "Project",
            purchases: [{ id: `${id}-purchase` }],
          },
        ] as unknown as PaymentHistoryViewData["projects"])
      : [],
  };
}

function paymentData(
  states: Partial<Record<keyof ProjectPaymentsTabData, boolean>> = {},
): ProjectPaymentsTabData {
  return {
    needsReview: paymentView("needs-review", "Pending proofs", states.needsReview ?? false),
    dueOrOverdue: paymentView("due", "Outstanding payments", states.dueOrOverdue ?? false),
    history: paymentView("history", "Payment history", states.history ?? false),
  };
}

afterEach(() => {
  cleanup();
});

describe("PaymentsTab", () => {
  it("renders action buckets first, purchases next, and completed history last", () => {
    const { container } = render(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData({
          needsReview: true,
          dueOrOverdue: true,
          history: true,
        })}
        purchases={[]}
      />,
    );

    const text = container.textContent;
    expect(text.indexOf("Pending proofs")).toBeLessThan(text.indexOf("Outstanding payments"));
    expect(text.indexOf("Outstanding payments")).toBeLessThan(text.indexOf("Purchases & add-ons"));
    expect(text.indexOf("Purchases & add-ons")).toBeLessThan(
      text.indexOf("Completed payment history"),
    );

    const history = screen.getByText("Completed payment history").closest("details");
    expect(history?.hasAttribute("open")).toBe(false);
  });

  it("shows a calm action state while preserving purchases when nothing is due", () => {
    render(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData({ history: true })}
        purchases={[]}
      />,
    );

    expect(screen.getByText("No payments need attention.")).not.toBeNull();
    expect(screen.getByTestId("purchases-panel")).not.toBeNull();
    expect(screen.queryByTestId("payment-section-needs-review")).toBeNull();
    expect(screen.queryByTestId("payment-section-due")).toBeNull();
  });
});
