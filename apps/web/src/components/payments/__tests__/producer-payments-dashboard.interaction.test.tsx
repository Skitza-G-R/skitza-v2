// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProducerPaymentsDashboard } from "../producer-payments-dashboard";
import type {
  ProducerPaymentRecord,
  ProducerPaymentsData,
} from "../producer-payments-dashboard-model";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

function paymentRecord(index: number): ProducerPaymentRecord {
  const pending = index === 0;
  const overdue = index === 1;
  return {
    id: `purchase-${String(index)}`,
    producerId: "producer-1",
    clientContactId: `client-${String(index)}`,
    clientName: `Artist ${String(index).padStart(2, "0")}`,
    projectId: `project-${String(index)}`,
    projectTitle: `Project ${String(index)}`,
    projectLifecycleStatus: index === 2 ? "completed" : "active",
    purchaseTitle: `Purchase ${String(index)}`,
    purchaseReference: `REF-${String(index)}`,
    purchaseLifecycleStatus: "active",
    currency: index === 3 ? "ILS" : "USD",
    totalCents: 20_000,
    paidCents: 10_000,
    dueNowCents: overdue ? 10_000 : 0,
    totalRemainingCents: 10_000,
    installments: [
      {
        id: `installment-${String(index)}`,
        amountCents: 10_000,
        paidCents: 0,
        waivedCents: 0,
        remainingCents: 10_000,
        dueAtIso: "2026-08-12T09:00:00.000Z",
        triggeredAtIso: "2026-07-01T09:00:00.000Z",
        dueTrigger: "monthly_anniversary",
        status: overdue ? "overdue" : pending ? "awaiting_review" : "not_paid",
      },
    ],
    nextPayment: {
      installmentId: `installment-${String(index)}`,
      amountCents: 10_000,
      dueAtIso: "2026-08-12T09:00:00.000Z",
      triggeredAtIso: "2026-07-01T09:00:00.000Z",
      dueTrigger: "monthly_anniversary",
      status: overdue ? "overdue" : pending ? "awaiting_review" : "not_paid",
    },
    payments: [
      {
        id: `payment-${String(index)}`,
        installmentId: `installment-${String(index)}`,
        proofId: pending ? "proof-pending" : null,
        source: pending ? "proof" : "manual",
        originalAmountCents: 10_000,
        effectiveAmountCents: 10_000,
        paidAtIso: "2026-08-03T09:00:00.000Z",
        note: null,
      },
    ],
    corrections: [],
    waivers: [],
    proofs: pending
      ? [
          {
            id: "proof-pending",
            installmentId: `installment-${String(index)}`,
            amountCents: 10_000,
            currency: "USD",
            status: "pending",
            submittedAtIso: "2026-08-03T08:00:00.000Z",
            reviewedAtIso: null,
          },
        ]
      : [],
    cancellation: null,
  };
}

function renderDashboard(data: ProducerPaymentsData) {
  return render(
    <ProducerPaymentsDashboard
      data={data}
      producerTimeZone="Asia/Jerusalem"
      initialNowIso="2026-08-08T12:00:00.000Z"
    />,
  );
}

describe("ProducerPaymentsDashboard", () => {
  it("starts on This month → Overview with only the two locked top-level views", () => {
    renderDashboard({ records: [paymentRecord(0), paymentRecord(1)] });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["overview", "history"]);
    expect(screen.getByRole("tab", { name: "overview" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Time range" }).value).toBe(
      "this_month",
    );
    expect(screen.getAllByText("Received").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Owed now").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting on milestones").length).toBeGreaterThan(0);
  });

  it("keeps currency, project, and payment status inside one Filters control", async () => {
    const user = userEvent.setup();
    renderDashboard({ records: [paymentRecord(0)] });

    expect(screen.queryByLabelText("Currency")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByLabelText("Currency")).not.toBeNull();
    expect(screen.getByLabelText("Project")).not.toBeNull();
    expect(screen.getByLabelText("Payment status")).not.toBeNull();
    expect(screen.queryByLabelText("Artist")).toBeNull();
    expect(screen.queryByLabelText("Accepted from")).toBeNull();
  });

  it("links each Artist to Client Payments and each pending proof to its exact review", () => {
    renderDashboard({ records: [paymentRecord(0)] });

    const artistLinks = screen.getAllByRole("link", { name: "Artist 00" });
    expect(artistLinks[0]?.getAttribute("href")).toBe(
      "/dashboard/clients-projects/clients/client-0?tab=payments",
    );
    const proofLinks = screen.getAllByRole("link", { name: "Review Purchase 0 proof" });
    expect(proofLinks[0]?.getAttribute("href")).toBe("/dashboard/payments/proof-pending");
    expect(screen.queryByRole("button", { name: /details/i })).toBeNull();
  });

  it("shows at most ten Artists per page with accessible Previous and Next controls", async () => {
    const user = userEvent.setup();
    renderDashboard({ records: Array.from({ length: 12 }, (_, index) => paymentRecord(index)) });

    expect(screen.getByText("Page 1 of 2 · 12 Artists")).not.toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Previous" }).disabled).toBe(
      true,
    );
    expect(screen.queryByText("Artist 11")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 2 · 12 Artists")).not.toBeNull();
    expect(screen.queryByText("Artist 00")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(true);
  });

  it("keeps History separate and shows exact proof and payment records without expansion", async () => {
    const user = userEvent.setup();
    renderDashboard({ records: [paymentRecord(0)] });

    await user.click(screen.getByRole("tab", { name: "history" }));
    expect(screen.getByRole("heading", { name: "Payment history" })).not.toBeNull();
    expect(screen.getAllByText("Proof").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payment").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Open proof" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /details/i })).toBeNull();
  });

  it("uses the locked truthful empty state", () => {
    renderDashboard({ records: [] });
    expect(screen.getByText("No payments yet.")).not.toBeNull();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });
});
