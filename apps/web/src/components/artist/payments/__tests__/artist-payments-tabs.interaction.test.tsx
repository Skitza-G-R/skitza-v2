// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
  PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

import { ArtistPaymentsOverview } from "../artist-payments-overview";

function purchase(id: string, title: string): PaymentHistoryPurchase {
  return {
    id,
    studioId: "00000000-0000-4000-8000-000000000201",
    title,
    counterpartyLabel: "North Room",
    currency: "ILS",
    status: { label: "Due now", tone: "warning" },
    recordStatus: "open",
    paidCents: 0,
    dueNowCents: 5_000,
    totalRemainingCents: 5_000,
    showPayNextPayment: true,
    proofs: [],
  } as unknown as PaymentHistoryPurchase;
}

function section(
  id: string,
  title: string,
  purchases: readonly PaymentHistoryPurchase[],
): PaymentHistoryViewData {
  return {
    section: {
      id,
      eyebrow: title,
      title,
      description: "",
      emptyTitle: `No ${title.toLowerCase()}`,
      emptyDescription: "Nothing is here yet.",
    },
    currencyTotals: [],
    projects:
      purchases.length === 0
        ? []
        : [
            {
              id: `${id}-project`,
              title: `${title} project`,
              purchases,
            } as unknown as PaymentHistoryProject,
          ],
  };
}

const waitingPurchase = purchase("00000000-0000-4000-8000-000000000101", "Waiting purchase");
const waitingForReviewPurchase = {
  ...purchase("00000000-0000-4000-8000-000000000104", "Proof under review"),
  status: { label: "Needs review", tone: "accent" },
  dueNowCents: 0,
  showPayNextPayment: false,
} as unknown as PaymentHistoryPurchase;
const activePurchase = purchase("00000000-0000-4000-8000-000000000102", "Active purchase");
const historyPurchase = {
  ...purchase("00000000-0000-4000-8000-000000000103", "History purchase"),
  recordStatus: "paid_in_full",
  status: { label: "Paid", tone: "success" },
  dueNowCents: 0,
  totalRemainingCents: 0,
  showPayNextPayment: false,
} as unknown as PaymentHistoryPurchase;

afterEach(cleanup);

describe("ArtistPaymentsOverview tabs", () => {
  it("defaults to Waiting when a purchase needs its first payment", () => {
    render(
      <ArtistPaymentsOverview
        sections={[
          section("waiting", "Waiting for payment", [waitingPurchase]),
          section("active", "Balances and actions", [activePurchase]),
          section("history", "History", [historyPurchase]),
        ]}
      />,
    );

    expect(
      screen.getByRole("tab", { name: "Waiting, 1 purchase" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("Waiting purchase")).toBeTruthy();
    expect(screen.queryByText("Active purchase")).toBeNull();
    expect(screen.queryByText("History purchase")).toBeNull();
  });

  it("defaults to Balance & actions when Waiting is empty", () => {
    render(
      <ArtistPaymentsOverview
        sections={[
          section("waiting", "Waiting for payment", []),
          section("active", "Balances and actions", [activePurchase]),
          section("history", "History", [historyPurchase]),
        ]}
      />,
    );

    expect(
      screen
        .getByRole("tab", { name: "Balance & actions, 1 purchase" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("Active purchase")).toBeTruthy();
    expect(screen.queryByText("History purchase")).toBeNull();
  });

  it("defaults to Balance & actions when Waiting has no purchase requiring payment", () => {
    render(
      <ArtistPaymentsOverview
        sections={[
          section("waiting", "Waiting for payment", [waitingForReviewPurchase]),
          section("active", "Balances and actions", []),
          section("history", "History", [historyPurchase]),
        ]}
      />,
    );

    expect(
      screen
        .getByRole("tab", { name: "Balance & actions, 0 purchases" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("No balances and actions")).toBeTruthy();
    expect(screen.queryByText("Proof under review")).toBeNull();
    expect(screen.queryByText("History purchase")).toBeNull();
  });

  it("switches one visible group at a time and supports arrow keys", () => {
    render(
      <ArtistPaymentsOverview
        sections={[
          section("waiting", "Waiting for payment", [waitingPurchase]),
          section("active", "Balances and actions", [activePurchase]),
          section("history", "History", [historyPurchase]),
        ]}
      />,
    );

    const waiting = screen.getByRole("tab", { name: "Waiting, 1 purchase" });
    fireEvent.keyDown(waiting, { key: "ArrowRight" });

    const active = screen.getByRole("tab", { name: "Balance & actions, 1 purchase" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(active);
    expect(screen.getByText("Active purchase")).toBeTruthy();
    expect(screen.queryByText("Waiting purchase")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "History, 1 purchase" }));
    expect(screen.getByText("History purchase")).toBeTruthy();
    expect(screen.queryByText("Active purchase")).toBeNull();
  });

  it("defaults to Balance & actions when every group is empty", () => {
    render(
      <ArtistPaymentsOverview
        sections={[
          section("waiting", "Waiting for payment", []),
          section("active", "Balances and actions", []),
          section("history", "History", []),
        ]}
      />,
    );

    expect(
      screen
        .getByRole("tab", { name: "Balance & actions, 0 purchases" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("No balances and actions")).toBeTruthy();
  });
});
