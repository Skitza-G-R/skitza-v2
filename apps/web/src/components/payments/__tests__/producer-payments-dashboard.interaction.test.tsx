// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
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
    isImportedExistingWork: false,
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


/** Re-dates a fixture's single installment so timing phrases can be asserted. */
function withNextDue(
  record: ProducerPaymentRecord,
  dueAtIso: string | null,
  status: ProducerPaymentRecord["installments"][number]["status"],
): ProducerPaymentRecord {
  return {
    ...record,
    installments: record.installments.map((installment) => ({
      ...installment,
      dueAtIso,
      status,
    })),
    nextPayment: record.nextPayment
      ? { ...record.nextPayment, dueAtIso, status }
      : null,
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
  it("starts on This month → Overview and dates the money band it summarises", () => {
    const view = renderDashboard({ records: [paymentRecord(0), paymentRecord(1)] });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["overview", "history"]);
    expect(screen.getByRole("tab", { name: "overview" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Time range" }).value).toBe(
      "this_month",
    );

    // SK-275: the band names the days it covers, and keeps the two range-scoped
    // figures apart from the two that are always all-time. The old single
    // "This month" heading sat over both and was wrong about half of them.
    const summary = view.container.querySelector<HTMLElement>(
      "[data-producer-payments-summary]",
    );
    if (!summary) throw new Error("Expected the money band");
    expect(within(summary).getByText("Aug 1 – Aug 31")).not.toBeNull();
    expect(within(summary).getAllByText("This month").length).toBeGreaterThan(0);
    expect(within(summary).getAllByText("Right now").length).toBeGreaterThan(0);
    for (const word of ["received", "expected", "owed", "waiting"]) {
      expect(within(summary).getAllByText(word).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("heading", { name: "This month" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "By currency" })).toBeNull();

    // It still reads before the Artist list it describes.
    const table = screen.getAllByRole("table")[0];
    if (!table) throw new Error("Expected an Artist table");
    expect(summary.compareDocumentPosition(table)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps Artist, currency, project, and payment status inside one Filters control", async () => {
    const user = userEvent.setup();
    renderDashboard({ records: [paymentRecord(0), paymentRecord(1)] });

    expect(screen.queryByLabelText("Currency")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByLabelText("Artist")).not.toBeNull();
    expect(screen.getByLabelText("Currency")).not.toBeNull();
    expect(screen.getByLabelText("Project")).not.toBeNull();
    expect(screen.getByLabelText("Payment status")).not.toBeNull();
    expect(screen.queryByLabelText("Accepted from")).toBeNull();

    await user.selectOptions(screen.getByLabelText("Artist"), "client-1");
    expect(screen.queryByRole("link", { name: "Artist 00" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Artist 01" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Filters (1)" })).not.toBeNull();
  });

  it("leads with the Artist and collapses that Artist's projects onto one line", () => {
    const firstProject = paymentRecord(0);
    const secondProject = {
      ...paymentRecord(1),
      clientContactId: firstProject.clientContactId,
      clientName: firstProject.clientName,
      projectId: "project-second",
      projectTitle: "Second project",
    };
    const repeatedProject = {
      ...paymentRecord(2),
      clientContactId: firstProject.clientContactId,
      clientName: firstProject.clientName,
      projectId: firstProject.projectId,
      projectTitle: firstProject.projectTitle,
    };
    renderDashboard({ records: [firstProject, secondProject, repeatedProject] });

    const table = screen.getAllByRole("table")[0];
    if (!table) throw new Error("Expected an Artist table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Artist", "Payment", "Paid", "Action"]);

    const artistRow = within(table).getAllByRole("row")[1];
    if (!artistRow) throw new Error("Expected one Artist payment row");
    // Two distinct projects, the third record repeats one of them.
    expect(within(artistRow).getByRole("rowheader").textContent).toBe(
      "Artist 00· Project 0 +1 more",
    );
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
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Previous" }).disabled).toBe(true);
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

  it("shows imported manual money as confirmed by the producer in History", async () => {
    const user = userEvent.setup();
    const imported = {
      ...paymentRecord(2),
      isImportedExistingWork: true,
      payments: [
        {
          id: "imported-manual-payment",
          installmentId: "installment-2",
          proofId: null,
          source: "manual" as const,
          originalAmountCents: 10_000,
          effectiveAmountCents: 10_000,
          paidAtIso: "2026-08-03T09:00:00.000Z",
          note: "Bank transfer received",
        },
      ],
    };
    renderDashboard({ records: [imported] });

    await user.click(screen.getByRole("tab", { name: "history" }));

    expect(
      screen.getAllByText("Confirmed by producer · Bank transfer received").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Recorded manually · Bank transfer received")).toBeNull();
  });

  // SK-275 — the Overview row speaks in dates and offers the next move.

  it("dates every payment and says how far away it is", () => {
    const overdue = withNextDue(paymentRecord(1), "2026-08-01T09:00:00.000Z", "overdue");
    const upcoming = withNextDue(paymentRecord(2), "2026-09-10T09:00:00.000Z", "not_paid");
    const monthly = withNextDue(paymentRecord(3), null, "not_paid");
    const awaitingApproval = {
      ...withNextDue(paymentRecord(4), null, "not_paid"),
      nextPayment: {
        installmentId: "installment-4",
        amountCents: 10_000,
        dueAtIso: null,
        triggeredAtIso: null,
        dueTrigger: "artist_approval" as const,
        status: "not_paid" as const,
      },
    };
    renderDashboard({
      records: [paymentRecord(0), overdue, upcoming, monthly, awaitingApproval],
    });

    // A waiting proof outranks the next payment — reviewing it is the next move,
    // and its amount is withheld because it is not the next payment's amount.
    expect(screen.getAllByText("Proof to check — sent Aug 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("was due Aug 1, 7 days ago").length).toBeGreaterThan(0);
    expect(screen.getAllByText("due Sep 10, in 33 days").length).toBeGreaterThan(0);
    // No date yet: say what the payment waits on instead of inventing one.
    expect(screen.getAllByText("monthly payment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("after final approval").length).toBeGreaterThan(0);
  });

  it("never promises a future date for money the ledger already calls overdue", () => {
    // The fixture's due date is four days out while the status says overdue.
    renderDashboard({ records: [paymentRecord(1)] });

    expect(screen.getAllByText("was due Aug 12").length).toBeGreaterThan(0);
    expect(screen.queryByText(/in 4 days/)).toBeNull();
  });

  it("shows money paid against the whole agreed amount", () => {
    renderDashboard({ records: [paymentRecord(2)] });

    const bars = screen.getAllByRole("progressbar", { name: "USD paid so far" });
    expect(bars[0]?.getAttribute("aria-valuenow")).toBe("50");
    const table = screen.getAllByRole("table")[0];
    if (!table) throw new Error("Expected an Artist table");
    expect(table.textContent).toContain("$100 of $200");
  });

  it("offers Review on a waiting proof and a reminder on an overdue Artist", () => {
    const overdue = withNextDue(paymentRecord(1), "2026-08-01T09:00:00.000Z", "overdue");
    renderDashboard({ records: [paymentRecord(0), overdue] });

    const review = screen.getAllByRole("link", { name: "Review Purchase 0 proof" });
    expect(review[0]?.getAttribute("href")).toBe("/dashboard/payments/proof-pending");
    expect(review[0]?.textContent).toBe("Review");
    expect(
      screen.getAllByRole("button", { name: /^Send payment reminder for Purchase 1/ }).length,
    ).toBeGreaterThan(0);
    // An Artist with nothing to do says so quietly instead of shouting a pill.
    expect(screen.queryByRole("button", { name: /reminder for Purchase 0/ })).toBeNull();
  });

  it("keeps both needs-you chips offered while one of them filters the list", async () => {
    const user = userEvent.setup();
    const overdue = withNextDue(paymentRecord(1), "2026-08-01T09:00:00.000Z", "overdue");
    renderDashboard({ records: [paymentRecord(0), overdue] });

    expect(screen.getByRole("button", { name: "1 overdue" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    await user.click(screen.getByRole("button", { name: "1 overdue" }));

    expect(screen.getByRole("button", { name: "1 overdue" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    // Counted before the status filter, so the other queue stays reachable.
    expect(screen.getByRole("button", { name: "1 proof" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Artist 00" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "1 overdue" }));
    expect(screen.getAllByRole("link", { name: "Artist 00" }).length).toBeGreaterThan(0);
  });

  it("drops the needs-you strip when nothing needs the producer", () => {
    renderDashboard({ records: [withNextDue(paymentRecord(2), "2026-09-10T09:00:00.000Z", "not_paid")] });

    expect(screen.queryByText("Needs you")).toBeNull();
    expect(screen.queryByRole("button", { name: /overdue$/ })).toBeNull();
    expect(screen.getByText("All payments are up to date.")).not.toBeNull();
  });

  it("says when money last actually arrived, all-time", () => {
    // The fixture's only payment landed Aug 3; the range is August.
    renderDashboard({ records: [paymentRecord(2)] });
    expect(screen.getAllByText("· last paid Aug 3").length).toBeGreaterThan(0);

    cleanup();
    // An Artist who has never paid says so rather than showing a blank.
    renderDashboard({ records: [{ ...paymentRecord(2), payments: [], paidCents: 0 }] });
    expect(screen.getAllByText("· no payments yet").length).toBeGreaterThan(0);
  });

  it("sorts rows under plain headings instead of colour-coding them", () => {
    const overdue = withNextDue(paymentRecord(1), "2026-08-01T09:00:00.000Z", "overdue");
    const upcoming = withNextDue(paymentRecord(2), "2026-09-10T09:00:00.000Z", "not_paid");
    renderDashboard({ records: [paymentRecord(0), overdue, upcoming] });

    expect(screen.getByRole("heading", { name: "Needs you" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Coming up" })).not.toBeNull();

    // Actions live only under "Needs you"; "Coming up" says nothing at all.
    const comingUp = screen.getByRole("table", { name: /money still to come/i });
    expect(within(comingUp).queryByRole("link", { name: /Review/ })).toBeNull();
    expect(within(comingUp).queryByRole("button", { name: /reminder/i })).toBeNull();
    const needsYou = screen.getByRole("table", { name: /waiting on you/i });
    expect(within(needsYou).getAllByRole("link", { name: /Review/ }).length).toBeGreaterThan(0);
  });

  it("uses the locked truthful empty state", () => {
    renderDashboard({ records: [] });
    expect(screen.getByText("No payments yet.")).not.toBeNull();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });
});
