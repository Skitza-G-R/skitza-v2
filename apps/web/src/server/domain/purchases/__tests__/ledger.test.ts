import { describe, expect, it } from "vitest";

import {
  createDebtWaiver,
  createInstallmentSchedule,
  createPaymentCorrection,
  purchaseInstallmentDueLabel,
  purchaseInstallmentTriggerLabel,
  summarizePurchaseLedger,
  type ConfirmedPayment,
} from "../ledger";

const confirmedAt = new Date("2026-07-01T10:00:00Z");

function payment(id: string, installmentSequence: number, amountCents: number): ConfirmedPayment {
  return { id, installmentSequence, amountCents, confirmedAt };
}

describe("purchase installment schedules", () => {
  it("supports no-plan zero deals plus only Full, 50/50, and Monthly with deterministic cents", () => {
    expect(createInstallmentSchedule(null, 0)).toEqual([]);
    expect(createInstallmentSchedule({ kind: "full" }, 10_001)).toEqual([
      { sequence: 1, amountCents: 10_001, trigger: "acceptance", status: "not_paid" },
    ]);
    expect(createInstallmentSchedule({ kind: "split_50_50" }, 10_001)).toEqual([
      { sequence: 1, amountCents: 5_001, trigger: "acceptance", status: "not_paid" },
      { sequence: 2, amountCents: 5_000, trigger: "artist_approval", status: "not_paid" },
    ]);
    expect(createInstallmentSchedule({ kind: "monthly", installments: 3 }, 10_003)).toEqual([
      {
        sequence: 1,
        amountCents: 3_335,
        trigger: "acceptance",
        status: "not_paid",
      },
      {
        sequence: 2,
        amountCents: 3_334,
        trigger: "monthly_anniversary",
        status: "not_paid",
      },
      {
        sequence: 3,
        amountCents: 3_334,
        trigger: "monthly_anniversary",
        status: "not_paid",
      },
    ]);
  });

  it("requires a null plan for zero and rejects unsupported legacy plans at runtime", () => {
    expect(() => createInstallmentSchedule({ kind: "full" }, 0)).toThrow(/zero-total/);
    expect(() => createInstallmentSchedule(null, 1)).toThrow(/positive-total/);
    expect(() => createInstallmentSchedule({ kind: "milestones" } as never, 10_000)).toThrow(
      /Unsupported payment plan/,
    );
    expect(() =>
      // @ts-expect-error Zero-total purchases use null, never a pseudo-plan.
      createInstallmentSchedule({ kind: "none" }, 0),
    ).toThrow(/Unsupported payment plan/);
  });

  it("describes the same due triggers that are materialized in the schedule", () => {
    expect(purchaseInstallmentDueLabel({ kind: "full" }, 1)).toBe("Due at acceptance");
    expect(purchaseInstallmentDueLabel({ kind: "split_50_50" }, 2)).toBe(
      "50% due when the artist approves the final version",
    );
    expect(purchaseInstallmentDueLabel({ kind: "monthly", installments: 3 }, 2)).toBe(
      "Monthly payment 2",
    );
    expect(purchaseInstallmentTriggerLabel("acceptance")).toBe("Triggered by offer acceptance");
    expect(purchaseInstallmentTriggerLabel("monthly_anniversary")).toBe(
      "Triggered on a monthly anniversary after acceptance",
    );
  });
});

describe("purchase ledger", () => {
  const schedule = createInstallmentSchedule({ kind: "split_50_50" }, 10_000);

  it("records a partial first installment without activating or losing the balance", () => {
    const summary = summarizePurchaseLedger({
      totalCents: 10_000,
      schedule,
      payments: [payment("payment-1", 1, 4_000)],
      corrections: [],
      waivers: [],
    });

    expect(summary).toMatchObject({
      paidCents: 4_000,
      remainingBalanceCents: 6_000,
      firstInstallmentPaid: false,
      fullyPaid: false,
      overpaidCents: 0,
    });
  });

  it("allows overpayment but never moves the excess outside the purchase", () => {
    const summary = summarizePurchaseLedger({
      totalCents: 10_000,
      schedule,
      payments: [payment("payment-1", 1, 5_000), payment("payment-2", 2, 6_500)],
      corrections: [],
      waivers: [],
    });

    expect(summary).toMatchObject({
      paidCents: 11_500,
      remainingBalanceCents: 0,
      overpaidCents: 1_500,
      firstInstallmentPaid: true,
      fullyPaid: true,
    });
  });

  it("does not move one installment's excess to another installment or unlock downloads", () => {
    const summary = summarizePurchaseLedger({
      totalCents: 10_000,
      schedule,
      payments: [payment("payment-1", 1, 10_000)],
      corrections: [],
      waivers: [],
    });

    expect(summary).toMatchObject({
      paidCents: 10_000,
      remainingBalanceCents: 5_000,
      overpaidCents: 5_000,
      firstInstallmentPaid: true,
      fullyPaid: false,
      settled: false,
    });
  });

  it("applies immutable correction history and can relock full-payment access", () => {
    const correction = createPaymentCorrection({
      id: "correction-1",
      paymentId: "payment-1",
      sequence: 1,
      oldAmountCents: 10_000,
      newAmountCents: 4_000,
      reason: "Bank return",
      actorId: "producer-1",
      correctedAt: new Date("2026-07-02T10:00:00Z"),
    });
    const summary = summarizePurchaseLedger({
      totalCents: 10_000,
      schedule: createInstallmentSchedule({ kind: "full" }, 10_000),
      payments: [payment("payment-1", 1, 10_000)],
      corrections: [correction],
      waivers: [],
    });

    expect(correction).toMatchObject({
      oldAmountCents: 10_000,
      newAmountCents: 4_000,
      reason: "Bank return",
      actorId: "producer-1",
    });
    expect(summary).toMatchObject({
      originalConfirmedCents: 10_000,
      paidCents: 4_000,
      remainingBalanceCents: 6_000,
      firstInstallmentPaid: false,
      fullyPaid: false,
    });
  });

  it("rejects a correction that does not continue the exact old/new chain", () => {
    expect(() =>
      summarizePurchaseLedger({
        totalCents: 10_000,
        schedule: createInstallmentSchedule({ kind: "full" }, 10_000),
        payments: [payment("payment-1", 1, 10_000)],
        corrections: [
          createPaymentCorrection({
            id: "correction-1",
            paymentId: "payment-1",
            sequence: 1,
            oldAmountCents: 9_000,
            newAmountCents: 4_000,
            reason: "Incorrect bank amount",
            actorId: "producer-1",
            correctedAt: new Date("2026-07-02T10:00:00Z"),
          }),
        ],
        waivers: [],
      }),
    ).toThrow(/old amount/);
  });

  it("settles waived debt without counting it as payment or download unlock", () => {
    const waiver = createDebtWaiver({
      id: "waiver-1",
      installmentSequence: 2,
      amountCents: 5_000,
      reason: "Producer waived final installment",
      actorId: "producer-1",
      waivedAt: new Date("2026-07-03T10:00:00Z"),
    });
    const summary = summarizePurchaseLedger({
      totalCents: 10_000,
      schedule,
      payments: [payment("payment-1", 1, 5_000)],
      corrections: [],
      waivers: [waiver],
    });

    expect(summary).toMatchObject({
      paidCents: 5_000,
      waivedCents: 5_000,
      remainingBalanceCents: 0,
      settled: true,
      fullyPaid: false,
    });
  });

  it("removes canceled future installments from collectible debt without treating them as paid", () => {
    const canceledSchedule = schedule.map((installment) => ({
      ...installment,
      status: installment.sequence === 2 ? ("canceled" as const) : ("confirmed" as const),
    }));
    const summary = summarizePurchaseLedger({
      totalCents: 10_000,
      schedule: canceledSchedule,
      payments: [payment("payment-1", 1, 5_000)],
      corrections: [],
      waivers: [],
    });

    expect(summary).toMatchObject({
      paidCents: 5_000,
      remainingBalanceCents: 0,
      settled: true,
      fullyPaid: false,
      overpaidCents: 0,
    });
  });

  it("rejects a waiver that exceeds debt on its exact installment", () => {
    const waiver = createDebtWaiver({
      id: "waiver-wrong-installment-balance",
      installmentSequence: 2,
      amountCents: 5_000,
      reason: "Cannot waive debt that was already paid",
      actorId: "producer-1",
      waivedAt: new Date("2026-07-03T10:00:00Z"),
    });

    expect(() =>
      summarizePurchaseLedger({
        totalCents: 10_000,
        schedule,
        payments: [payment("payment-2", 2, 5_000)],
        corrections: [],
        waivers: [waiver],
      }),
    ).toThrow(/remaining debt on its exact installment/);
  });

  it("rejects a waiver without an exact installment sequence", () => {
    const waiver = {
      id: "waiver-without-installment",
      installmentSequence: null,
      amountCents: 5_000,
      reason: "Invalid purchase-wide waiver",
      actorId: "producer-1",
      waivedAt: new Date("2026-07-03T10:00:00Z"),
    } as unknown as Parameters<typeof createDebtWaiver>[0];

    expect(() => createDebtWaiver(waiver)).toThrow(/installment sequence/);
  });
});
