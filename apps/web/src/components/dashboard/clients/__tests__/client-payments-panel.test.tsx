// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PaymentHistoryPurchase } from "~/components/payments/payment-history-view";

import type {
  ClientPaymentInstallmentData,
  ClientPaymentPurchaseData,
  ClientPaymentsData,
} from "../client-payments-data";
import { ClientPaymentsPanel } from "../client-payments-panel";

vi.mock("~/components/payments/payment-history", () => ({
  PaymentHistoryPurchaseDetails: ({ purchase }: { purchase: PaymentHistoryPurchase }) => (
    <div data-testid={`purchase-details-${purchase.id}`}>Exact purchase record</div>
  ),
}));

vi.mock("~/components/payments/payment-reminder-button", () => ({
  PaymentReminderButton: ({ installmentId }: { installmentId: string }) => (
    <button type="button">Send reminder {installmentId}</button>
  ),
}));

afterEach(cleanup);

function installment(
  id: string,
  overrides: Partial<ClientPaymentInstallmentData> = {},
): ClientPaymentInstallmentData {
  return {
    id,
    position: 1,
    label: "Payment 1",
    amountCents: 20_000,
    paidCents: 0,
    waivedCents: 0,
    remainingCents: 20_000,
    currency: "USD",
    dueAtIso: null,
    triggeredAtIso: null,
    dueTrigger: "artist_approval",
    triggerLabel: "When the artist approves the final version",
    status: "not_paid",
    statusPresentation: { label: "Not paid", tone: "warning" },
    ...overrides,
  };
}

function purchase(
  installments: readonly ClientPaymentInstallmentData[],
  overrides: Partial<ClientPaymentPurchaseData> = {},
): ClientPaymentPurchaseData {
  return {
    id: "purchase-1",
    title: "Vocal production",
    reference: "SK-1042",
    currency: "USD",
    totalCents: 80_000,
    paidCents: 20_000,
    dueNowCents: 20_000,
    totalRemainingCents: 60_000,
    recordStatus: "open",
    installments,
    proofs: [],
    details: { id: "purchase-1", recordStatus: "open" } as PaymentHistoryPurchase,
    ...overrides,
  };
}

function paymentsData(purchases: readonly ClientPaymentPurchaseData[]): ClientPaymentsData {
  return {
    asOfIso: "2026-08-09T10:00:00.000Z",
    producerTimeZone: "Asia/Jerusalem",
    projects: [
      {
        id: "project-1",
        title: "Silver Lining EP",
        lifecycleStatus: "completed",
        status: { label: "Archived · balance remains", tone: "warning" },
        purchases,
      },
    ],
  };
}

function readyData(): ClientPaymentsData {
  return paymentsData([
    purchase(
      [
        installment("proof", {
          status: "awaiting_review",
          statusPresentation: { label: "Needs review", tone: "accent" },
        }),
        installment("due", {
          position: 2,
          label: "Payment 2",
          dueTrigger: "acceptance",
          triggerLabel: "At acceptance",
        }),
        installment("future", {
          position: 3,
          label: "Payment 3",
          dueAtIso: "2026-09-10T00:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
        }),
        installment("paid", {
          position: 4,
          label: "Payment 4",
          paidCents: 20_000,
          remainingCents: 0,
          status: "confirmed",
          statusPresentation: { label: "Paid", tone: "success" },
        }),
      ],
      {
        proofs: [
          {
            id: "proof-new",
            installmentId: "proof",
            amountCents: 20_000,
            currency: "USD",
            status: "pending",
            originalFileName: "latest.pdf",
            submittedAtIso: "2026-08-08T00:00:00.000Z",
          },
          {
            id: "proof-old",
            installmentId: "proof",
            amountCents: 20_000,
            currency: "USD",
            status: "rejected",
            originalFileName: "earlier.png",
            submittedAtIso: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    ),
  ]);
}

describe("ClientPaymentsPanel", () => {
  it("renders the four locked per-currency totals and compact project grouping", () => {
    render(
      <ClientPaymentsPanel state={{ status: "ready", data: readyData() }} clientName="Rina Vale" />,
    );

    for (const label of [
      "Paid all time",
      "Owes now",
      "Expected this month",
      "Waiting on milestones",
    ]) {
      expect(screen.getByText(label)).not.toBeNull();
    }
    expect(
      screen
        .getAllByRole("link", { name: "Silver Lining EP" })
        .every((link) => link.getAttribute("href") === "/dashboard/clients-projects/project-1"),
    ).toBe(true);
    expect(screen.getAllByText("Archived · balance remains")).toHaveLength(2);
  });

  it("gives each payment one primary action and keeps every proof on its exact row", () => {
    render(
      <ClientPaymentsPanel state={{ status: "ready", data: readyData() }} clientName="Rina Vale" />,
    );

    for (const installmentId of ["proof", "due", "future"]) {
      const row = screen.getByTestId(`client-payment-row-${installmentId}`);
      expect(row.querySelectorAll("[data-client-payment-primary-action]")).toHaveLength(1);
      expect(row.className).toContain("min-w-0");
    }

    const proofRow = screen.getByTestId("client-payment-row-proof");
    expect(
      within(proofRow)
        .getByRole("link", { name: /Open proof/ })
        .getAttribute("href"),
    ).toBe("/dashboard/payments/proof-new");
    expect(
      within(proofRow)
        .getByRole("link", { name: /Earlier proof/ })
        .getAttribute("href"),
    ).toBe("/dashboard/payments/proof-old");
    expect(
      within(screen.getByTestId("client-payment-row-due")).getByText(/Send reminder/),
    ).not.toBeNull();
    expect(
      within(screen.getByTestId("client-payment-row-future")).getByRole("button", {
        name: "View details",
      }),
    ).not.toBeNull();
  });

  it("keeps History closed and opens the shared exact record only on request", () => {
    render(
      <ClientPaymentsPanel state={{ status: "ready", data: readyData() }} clientName="Rina Vale" />,
    );

    const history = screen.getByTestId("client-payment-history");
    expect(history.hasAttribute("open")).toBe(false);

    fireEvent.click(within(history).getByText("History"));
    expect(history.hasAttribute("open")).toBe(true);
    const paidRow = screen.getByTestId("client-payment-row-paid");
    expect(paidRow.querySelectorAll("[data-client-payment-primary-action]")).toHaveLength(1);
    fireEvent.click(within(paidRow).getByRole("button", { name: "View record" }));
    expect(screen.getByTestId("purchase-details-purchase-1")).not.toBeNull();
  });

  it("uses truthful loading, failure, empty, up-to-date, and all-paid states", () => {
    const view = render(
      <ClientPaymentsPanel state={{ status: "loading" }} clientName="Rina Vale" />,
    );
    expect(screen.getByRole("status", { name: "Loading payments" })).not.toBeNull();
    expect(document.body.textContent).not.toContain("0.00");

    view.rerender(
      <ClientPaymentsPanel
        state={{ status: "error", message: "Refresh this page to try again." }}
        clientName="Rina Vale"
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t load payments.");
    expect(document.body.textContent).not.toContain("0.00");

    view.rerender(
      <ClientPaymentsPanel
        state={{
          status: "ready",
          data: { asOfIso: "2026-08-09T00:00:00.000Z", producerTimeZone: "UTC", projects: [] },
        }}
        clientName="Rina Vale"
      />,
    );
    expect(screen.getByText("No payments yet for this Artist.")).not.toBeNull();

    const future = purchase(
      [
        installment("future-only", {
          dueAtIso: "2026-09-10T00:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
        }),
      ],
      { paidCents: 0, dueNowCents: 0, totalRemainingCents: 20_000 },
    );
    view.rerender(
      <ClientPaymentsPanel
        state={{ status: "ready", data: paymentsData([future]) }}
        clientName="Rina Vale"
      />,
    );
    expect(screen.getByText("All payments are up to date.")).not.toBeNull();

    const paid = purchase(
      [
        installment("paid-only", {
          paidCents: 20_000,
          remainingCents: 0,
          status: "confirmed",
          statusPresentation: { label: "Paid", tone: "success" },
        }),
      ],
      {
        paidCents: 20_000,
        dueNowCents: 0,
        totalRemainingCents: 0,
        recordStatus: "paid_in_full",
        details: { id: "purchase-1", recordStatus: "paid_in_full" } as PaymentHistoryPurchase,
      },
    );
    view.rerender(
      <ClientPaymentsPanel
        state={{ status: "ready", data: paymentsData([paid]) }}
        clientName="Rina Vale"
      />,
    );
    expect(screen.getByText("All paid")).not.toBeNull();
    expect(screen.getByText(/USD received/)).not.toBeNull();
    expect(screen.getByTestId("client-payment-history").hasAttribute("open")).toBe(false);
  });
});
