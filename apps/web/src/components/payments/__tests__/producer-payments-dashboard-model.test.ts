import { describe, expect, it } from "vitest";

import {
  aggregateProducerPaymentArtists,
  buildProducerPaymentHistory,
  buildProducerPaymentTimeRange,
  filterProducerPaymentRecords,
  paginateProducerPaymentArtists,
  summarizeProducerPayments,
  type ProducerPaymentRecord,
} from "../producer-payments-dashboard-model";

const NOW = "2026-08-08T12:00:00.000Z";
const TIME_ZONE = "Asia/Jerusalem";

function record(
  overrides: Partial<ProducerPaymentRecord> &
    Pick<ProducerPaymentRecord, "id" | "clientContactId" | "clientName" | "currency">,
): ProducerPaymentRecord {
  return {
    producerId: "producer-1",
    projectId: `project-${overrides.id}`,
    projectTitle: `Project ${overrides.id}`,
    projectLifecycleStatus: "active",
    purchaseTitle: `Purchase ${overrides.id}`,
    purchaseReference: `SK-${overrides.id}`,
    purchaseLifecycleStatus: "active",
    totalCents: 20_000,
    paidCents: 0,
    dueNowCents: 0,
    totalRemainingCents: 20_000,
    installments: [],
    nextPayment: null,
    payments: [],
    corrections: [],
    waivers: [],
    proofs: [],
    cancellation: null,
    ...overrides,
    id: overrides.id,
    clientContactId: overrides.clientContactId,
    clientName: overrides.clientName,
    currency: overrides.currency,
  };
}

describe("producer payments dashboard calculations", () => {
  it("uses the producer timezone and keeps corrected receipts, expectations, debt, and milestones separate", () => {
    const thisMonth = buildProducerPaymentTimeRange("this_month", NOW, TIME_ZONE);
    const records: ProducerPaymentRecord[] = [
      record({
        id: "usd",
        clientContactId: "client-a",
        clientName: "Maya Vale",
        currency: "USD",
        paidCents: 12_000,
        dueNowCents: 4_000,
        totalRemainingCents: 9_000,
        payments: [
          {
            id: "payment-corrected",
            installmentId: "installment-1",
            proofId: null,
            source: "manual",
            originalAmountCents: 10_000,
            effectiveAmountCents: 8_000,
            paidAtIso: "2026-07-31T22:30:00.000Z",
            note: null,
          },
          {
            id: "payment-over",
            installmentId: "installment-2",
            proofId: null,
            source: "manual",
            originalAmountCents: 12_000,
            effectiveAmountCents: 12_000,
            paidAtIso: "2026-08-04T09:00:00.000Z",
            note: null,
          },
        ],
        installments: [
          {
            id: "installment-1",
            amountCents: 10_000,
            paidCents: 8_000,
            waivedCents: 0,
            remainingCents: 2_000,
            dueAtIso: "2026-08-02T09:00:00.000Z",
            triggeredAtIso: "2026-07-01T09:00:00.000Z",
            dueTrigger: "monthly_anniversary",
            status: "partially_paid",
          },
          {
            id: "installment-milestone",
            amountCents: 5_000,
            paidCents: 0,
            waivedCents: 0,
            remainingCents: 5_000,
            dueAtIso: null,
            triggeredAtIso: null,
            dueTrigger: "artist_approval",
            status: "not_paid",
          },
        ],
      }),
      record({
        id: "ils",
        clientContactId: "client-b",
        clientName: "Noa Reed",
        currency: "ILS",
        paidCents: 0,
        dueNowCents: 7_000,
        totalRemainingCents: 7_000,
        installments: [
          {
            id: "triggered-milestone",
            amountCents: 7_000,
            paidCents: 0,
            waivedCents: 0,
            remainingCents: 7_000,
            dueAtIso: null,
            triggeredAtIso: "2026-08-05T10:00:00.000Z",
            dueTrigger: "artist_approval",
            status: "not_paid",
          },
        ],
      }),
    ];

    expect(thisMonth.fromDateKey).toBe("2026-08-01");
    expect(thisMonth.toDateKey).toBe("2026-08-31");
    expect(summarizeProducerPayments(records, thisMonth, TIME_ZONE)).toEqual([
      {
        currency: "ILS",
        receivedCents: 0,
        expectedCents: 0,
        owedNowCents: 7_000,
        waitingOnMilestonesCents: 0,
      },
      {
        currency: "USD",
        receivedCents: 20_000,
        expectedCents: 10_000,
        owedNowCents: 4_000,
        waitingOnMilestonesCents: 5_000,
      },
    ]);
  });

  it("does not count waivers as received and applies custom ranges to real payment dates", () => {
    const custom = buildProducerPaymentTimeRange(
      "custom",
      NOW,
      TIME_ZONE,
      "2026-08-03",
      "2026-08-03",
    );
    const purchase = record({
      id: "custom",
      clientContactId: "client-a",
      clientName: "Maya Vale",
      currency: "EUR",
      payments: [
        {
          id: "payment-1",
          installmentId: "installment-1",
          proofId: null,
          source: "manual",
          originalAmountCents: 4_500,
          effectiveAmountCents: 3_200,
          paidAtIso: "2026-08-03T06:00:00.000Z",
          note: null,
        },
      ],
      waivers: [
        {
          id: "waiver-1",
          installmentId: "installment-1",
          amountCents: 2_000,
          reason: "Goodwill",
          occurredAtIso: "2026-08-03T07:00:00.000Z",
        },
      ],
    });

    expect(summarizeProducerPayments([purchase], custom, TIME_ZONE)[0]?.receivedCents).toBe(3_200);
  });
});

describe("producer payments dashboard rows", () => {
  it("keeps one Artist row, sorts overdue Artists first, and keeps currencies separate", () => {
    const rows = aggregateProducerPaymentArtists(
      [
        record({
          id: "a-usd",
          clientContactId: "client-a",
          clientName: "Maya Vale",
          currency: "USD",
          paidCents: 3_000,
          dueNowCents: 2_000,
          totalRemainingCents: 5_000,
        }),
        record({
          id: "a-eur",
          clientContactId: "client-a",
          clientName: "Maya Vale",
          currency: "EUR",
          paidCents: 4_000,
          dueNowCents: 0,
          totalRemainingCents: 1_000,
        }),
        record({
          id: "b-overdue",
          clientContactId: "client-b",
          clientName: "Noa Reed",
          currency: "USD",
          dueNowCents: 1_000,
          totalRemainingCents: 1_000,
          installments: [
            {
              id: "late",
              amountCents: 1_000,
              paidCents: 0,
              waivedCents: 0,
              remainingCents: 1_000,
              dueAtIso: "2026-08-01T09:00:00.000Z",
              triggeredAtIso: null,
              dueTrigger: "monthly_anniversary",
              status: "overdue",
            },
          ],
        }),
      ],
      buildProducerPaymentTimeRange("this_month", NOW, TIME_ZONE),
      TIME_ZONE,
      NOW,
    );

    expect(rows.map((row) => row.clientName)).toEqual(["Noa Reed", "Maya Vale"]);
    expect(rows[1]?.receivedByCurrency.map((amount) => amount.currency)).toEqual(["EUR", "USD"]);
  });

  it("searches Artist, project, purchase, and reference and paginates at ten Artists", () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      record({
        id: String(index),
        clientContactId: `client-${String(index)}`,
        clientName: `Artist ${String(index)}`,
        currency: "USD",
        projectTitle: index === 4 ? "Night Glass" : `Project ${String(index)}`,
        purchaseTitle: index === 7 ? "Album mix" : `Purchase ${String(index)}`,
        purchaseReference: index === 9 ? "REF-SPECIAL" : `REF-${String(index)}`,
      }),
    );
    const filters = {
      query: "",
      clientContactId: "all",
      currency: "all",
      projectId: "all",
      status: "all" as const,
    };

    expect(
      filterProducerPaymentRecords(records, { ...filters, query: "Night Glass" }),
    ).toHaveLength(1);
    expect(filterProducerPaymentRecords(records, { ...filters, query: "Album mix" })).toHaveLength(
      1,
    );
    expect(
      filterProducerPaymentRecords(records, { ...filters, query: "REF-SPECIAL" }),
    ).toHaveLength(1);
    expect(
      filterProducerPaymentRecords(records, { ...filters, clientContactId: "client-4" }),
    ).toEqual([records[4]]);

    const artists = aggregateProducerPaymentArtists(
      records,
      buildProducerPaymentTimeRange("all_time", NOW, TIME_ZONE),
      TIME_ZONE,
      NOW,
    );
    const page = paginateProducerPaymentArtists(artists, 2);
    expect(page.items).toHaveLength(2);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(2);
  });

  it("keeps proof, correction, waiver, and cancellation audit records in History", () => {
    const purchase = record({
      id: "audit",
      clientContactId: "client-a",
      clientName: "Maya Vale",
      currency: "USD",
      payments: [
        {
          id: "payment-1",
          installmentId: "installment-1",
          proofId: "proof-1",
          source: "proof",
          originalAmountCents: 10_000,
          effectiveAmountCents: 8_000,
          paidAtIso: "2026-08-02T09:00:00.000Z",
          note: null,
        },
      ],
      corrections: [
        {
          id: "correction-1",
          paymentId: "payment-1",
          previousAmountCents: 10_000,
          newAmountCents: 8_000,
          reason: "Returned transfer",
          occurredAtIso: "2026-08-03T09:00:00.000Z",
        },
      ],
      waivers: [
        {
          id: "waiver-1",
          installmentId: "installment-1",
          amountCents: 1_000,
          reason: "Goodwill",
          occurredAtIso: "2026-08-04T09:00:00.000Z",
        },
      ],
      proofs: [
        {
          id: "proof-1",
          installmentId: "installment-1",
          amountCents: 10_000,
          currency: "USD",
          status: "confirmed",
          submittedAtIso: "2026-08-01T09:00:00.000Z",
          reviewedAtIso: "2026-08-02T09:00:00.000Z",
        },
      ],
      cancellation: {
        id: "cancel-1",
        reason: "Project stopped",
        occurredAtIso: "2026-08-05T09:00:00.000Z",
      },
    });

    const history = buildProducerPaymentHistory(
      [purchase],
      buildProducerPaymentTimeRange("this_month", NOW, TIME_ZONE),
      TIME_ZONE,
    );
    expect(new Set(history.map((event) => event.kind))).toEqual(
      new Set(["payment", "correction", "waiver", "proof", "cancellation"]),
    );
    expect(history.find((event) => event.kind === "proof")?.proofId).toBe("proof-1");
    expect(history.find((event) => event.kind === "proof")?.occurredAtIso).toBe(
      "2026-08-02T09:00:00.000Z",
    );
  });

  it("keeps the upcoming filter mutually exclusive with actionable statuses", () => {
    const futureInstallment = {
      id: "future-installment",
      amountCents: 10_000,
      paidCents: 0,
      waivedCents: 0,
      remainingCents: 10_000,
      dueAtIso: "2026-08-20T09:00:00.000Z",
      triggeredAtIso: "2026-08-01T09:00:00.000Z",
      dueTrigger: "monthly_anniversary" as const,
      status: "not_paid" as const,
    };
    const upcoming = record({
      id: "upcoming",
      clientContactId: "client-upcoming",
      clientName: "Upcoming Artist",
      currency: "USD",
      installments: [futureInstallment],
      totalRemainingCents: 10_000,
    });
    const dueNow = record({
      id: "due-now",
      clientContactId: "client-due-now",
      clientName: "Due Artist",
      currency: "USD",
      installments: [futureInstallment],
      dueNowCents: 10_000,
      totalRemainingCents: 10_000,
    });
    const matches = filterProducerPaymentRecords([upcoming, dueNow], {
      query: "",
      clientContactId: "all",
      currency: "all",
      projectId: "all",
      status: "upcoming",
    });

    expect(matches.map((entry) => entry.id)).toEqual(["upcoming"]);
  });
});
