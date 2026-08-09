import type { PaymentHistoryPurchase } from "~/components/payments/payment-history-view";
import { describe, expect, it } from "vitest";

import type {
  ClientPaymentInstallmentData,
  ClientPaymentProjectData,
  ClientPaymentPurchaseData,
  ClientPaymentsData,
} from "../client-payments-data";
import { buildClientPaymentsView } from "../client-payments-model";

const AS_OF = "2026-08-09T10:00:00.000Z";

function installment(
  id: string,
  overrides: Partial<ClientPaymentInstallmentData> = {},
): ClientPaymentInstallmentData {
  return {
    id,
    position: 1,
    label: "Payment 1",
    amountCents: 10_000,
    paidCents: 0,
    waivedCents: 0,
    remainingCents: 10_000,
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
  id: string,
  installments: readonly ClientPaymentInstallmentData[],
  overrides: Partial<ClientPaymentPurchaseData> = {},
): ClientPaymentPurchaseData {
  return {
    id,
    title: "Mix and master",
    reference: `REF-${id}`,
    currency: "USD",
    totalCents: installments.reduce((sum, row) => sum + row.amountCents, 0),
    paidCents: 0,
    dueNowCents: 0,
    totalRemainingCents: installments.reduce((sum, row) => sum + row.remainingCents, 0),
    recordStatus: "open",
    installments,
    proofs: [],
    details: {
      id,
      recordStatus: "open",
    } as PaymentHistoryPurchase,
    ...overrides,
  };
}

function project(
  id: string,
  purchases: readonly ClientPaymentPurchaseData[],
  overrides: Partial<ClientPaymentProjectData> = {},
): ClientPaymentProjectData {
  return {
    id,
    title: "Night Signals",
    lifecycleStatus: "active",
    status: { label: "Active", tone: "active" },
    purchases,
    ...overrides,
  };
}

function data(projects: readonly ClientPaymentProjectData[]): ClientPaymentsData {
  return {
    asOfIso: AS_OF,
    producerTimeZone: "Asia/Jerusalem",
    projects,
  };
}

describe("buildClientPaymentsView", () => {
  it("keeps exact per-currency totals and the locked calculation meanings", () => {
    const usd = purchase(
      "purchase-usd",
      [
        installment("proof", {
          position: 1,
          amountCents: 10_000,
          remainingCents: 10_000,
          dueAtIso: "2026-08-06T12:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
          status: "awaiting_review",
          statusPresentation: { label: "Needs review", tone: "accent" },
        }),
        installment("due", {
          position: 2,
          label: "Payment 2",
          amountCents: 25_000,
          remainingCents: 25_000,
          dueAtIso: "2026-08-08T12:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
          status: "overdue",
          statusPresentation: { label: "Overdue", tone: "danger" },
        }),
        installment("future", {
          position: 3,
          label: "Payment 3",
          amountCents: 30_000,
          remainingCents: 30_000,
          dueAtIso: "2026-08-20T12:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
        }),
        installment("milestone", {
          position: 4,
          label: "Payment 4",
          amountCents: 40_000,
          remainingCents: 40_000,
        }),
        installment("paid", {
          position: 5,
          label: "Payment 5",
          amountCents: 50_000,
          paidCents: 50_000,
          remainingCents: 0,
          dueAtIso: "2026-08-02T12:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
          status: "confirmed",
          statusPresentation: { label: "Paid", tone: "success" },
        }),
        installment("waived", {
          position: 6,
          label: "Payment 6",
          amountCents: 7_000,
          waivedCents: 7_000,
          remainingCents: 0,
          dueAtIso: "2026-08-04T12:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
          status: "waived",
          statusPresentation: { label: "Waived", tone: "neutral" },
        }),
      ],
      {
        paidCents: 50_000,
        dueNowCents: 25_000,
        totalRemainingCents: 105_000,
        proofs: [
          {
            id: "proof-exact",
            installmentId: "proof",
            amountCents: 10_000,
            currency: "USD",
            status: "pending",
            originalFileName: "transfer.pdf",
            submittedAtIso: "2026-08-08T09:00:00.000Z",
          },
        ],
      },
    );
    const eur = purchase(
      "purchase-eur",
      [
        installment("eur-future", {
          amountCents: 12_000,
          remainingCents: 12_000,
          currency: "EUR",
          dueAtIso: "2026-09-01T12:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
        }),
      ],
      {
        currency: "EUR",
        totalCents: 12_000,
        totalRemainingCents: 12_000,
      },
    );

    const view = buildClientPaymentsView(
      data([
        project("archived-project", [usd], {
          lifecycleStatus: "completed",
          status: { label: "Archived · balance remains", tone: "warning" },
        }),
        project("euro-project", [eur]),
      ]),
    );

    expect(view.currencySummaries).toEqual([
      {
        currency: "EUR",
        paidAllTimeCents: 0,
        owesNowCents: 0,
        expectedThisMonthCents: 0,
        waitingOnMilestonesCents: 0,
      },
      {
        currency: "USD",
        paidAllTimeCents: 50_000,
        owesNowCents: 25_000,
        expectedThisMonthCents: 115_000,
        waitingOnMilestonesCents: 40_000,
      },
    ]);
  });

  it("groups by project, keeps archived debt visible, and assigns one exact action per payment", () => {
    const rowPurchase = purchase(
      "purchase-actions",
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
          dueAtIso: "2026-09-20T12:00:00.000Z",
          dueTrigger: "monthly_anniversary",
          triggerLabel: "Monthly anniversary",
        }),
        installment("paid", {
          position: 4,
          label: "Payment 4",
          paidCents: 10_000,
          remainingCents: 0,
          status: "confirmed",
          statusPresentation: { label: "Paid", tone: "success" },
        }),
      ],
      {
        dueNowCents: 10_000,
        proofs: [
          {
            id: "proof-other-installment",
            installmentId: "future",
            amountCents: 10_000,
            currency: "USD",
            status: "rejected",
            originalFileName: "old.png",
            submittedAtIso: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "proof-exact-installment",
            installmentId: "proof",
            amountCents: 10_000,
            currency: "USD",
            status: "pending",
            originalFileName: "new.png",
            submittedAtIso: "2026-08-08T00:00:00.000Z",
          },
        ],
      },
    );

    const view = buildClientPaymentsView(
      data([
        project("archived-project", [rowPurchase], {
          lifecycleStatus: "completed",
          status: { label: "Archived · balance remains", tone: "warning" },
        }),
      ]),
    );

    expect(view.currentGroups).toHaveLength(1);
    expect(view.currentGroups[0]?.project.id).toBe("archived-project");
    expect(view.currentGroups[0]?.rows.map((row) => [row.installment.id, row.action])).toEqual([
      ["proof", { kind: "open_proof", proofId: "proof-exact-installment" }],
      ["due", { kind: "send_reminder" }],
      ["future", { kind: "open_proof", proofId: "proof-other-installment" }],
    ]);
    expect(view.historyGroups[0]?.rows.map((row) => [row.installment.id, row.action])).toEqual([
      ["paid", { kind: "view_record" }],
    ]);
  });

  it("distinguishes empty, up-to-date, and truly all-paid states", () => {
    const empty = buildClientPaymentsView(data([]));
    expect(empty.hasPayments).toBe(false);
    expect(empty.allPaid).toBe(false);

    const future = purchase("future", [
      installment("future", {
        dueAtIso: "2026-09-20T12:00:00.000Z",
        dueTrigger: "monthly_anniversary",
        triggerLabel: "Monthly anniversary",
      }),
    ]);
    const upToDate = buildClientPaymentsView(data([project("future-project", [future])]));
    expect(upToDate.hasPayments).toBe(true);
    expect(upToDate.noCurrentDebt).toBe(true);
    expect(upToDate.allPaid).toBe(false);

    const paid = purchase(
      "paid",
      [
        installment("paid", {
          paidCents: 10_000,
          remainingCents: 0,
          status: "confirmed",
          statusPresentation: { label: "Paid", tone: "success" },
        }),
      ],
      {
        paidCents: 10_000,
        totalRemainingCents: 0,
        recordStatus: "paid_in_full",
        details: { id: "paid", recordStatus: "paid_in_full" } as PaymentHistoryPurchase,
      },
    );
    const complete = buildClientPaymentsView(data([project("paid-project", [paid])]));
    expect(complete.allPaid).toBe(true);
    expect(complete.currentGroups).toHaveLength(0);
    expect(complete.historyGroups).toHaveLength(1);
  });
});
