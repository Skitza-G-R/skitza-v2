import { describe, expect, it } from "vitest";

import {
  decideFinalPaymentRequest,
  type FinalPaymentInstallmentInput,
  type FinalPaymentPurchaseInput,
} from "../final-payment";

const ACTIVE: FinalPaymentPurchaseInput = { lifecycleStatus: "active" };

function halves(
  final: Partial<FinalPaymentInstallmentInput> = {},
): readonly FinalPaymentInstallmentInput[] {
  return [
    {
      id: "installment-1",
      dueTrigger: "producer_import",
      dueAt: new Date("2026-05-01T00:00:00.000Z"),
      triggeredAt: new Date("2026-05-01T00:00:00.000Z"),
      status: "confirmed",
    },
    {
      id: "installment-2",
      dueTrigger: "artist_approval",
      dueAt: null,
      triggeredAt: null,
      status: "not_paid",
      ...final,
    },
  ];
}

describe("decideFinalPaymentRequest", () => {
  it("lets the producer ask for a final half that is still waiting", () => {
    expect(decideFinalPaymentRequest({ purchase: ACTIVE, installments: halves() })).toEqual({
      status: "ready",
      installmentId: "installment-2",
    });
  });

  // SK-293 — a client who bought through Skitza and then went quiet strands the
  // final half exactly as an imported client does. The old rule answered
  // "not_imported_work" here, which left a paid producer unable to record the
  // money and unable to waive it.
  it("no longer refuses a purchase just because it was sold through Skitza", () => {
    for (const purchase of [ACTIVE, { lifecycleStatus: "waiting_for_payment" } as const]) {
      expect(
        decideFinalPaymentRequest({
          purchase,
          installments: halves(),
          installmentId: "installment-2",
        }),
      ).toEqual({ status: "ready", installmentId: "installment-2" });
    }
  });

  it("treats a second press as already done rather than an error", () => {
    const triggeredAt = new Date("2026-08-29T09:00:00.000Z");
    expect(
      decideFinalPaymentRequest({
        purchase: ACTIVE,
        installments: halves({ dueAt: triggeredAt, triggeredAt }),
        installmentId: "installment-2",
      }),
    ).toEqual({ status: "already_requested", installmentId: "installment-2" });
  });

  it("has nothing to ask for on a plan with no finished-work milestone", () => {
    expect(
      decideFinalPaymentRequest({
        purchase: ACTIVE,
        installments: [
          {
            id: "installment-1",
            dueTrigger: "producer_import",
            dueAt: new Date("2026-05-01T00:00:00.000Z"),
            triggeredAt: new Date("2026-05-01T00:00:00.000Z"),
            status: "not_paid",
          },
          {
            id: "installment-2",
            dueTrigger: "monthly_anniversary",
            dueAt: null,
            triggeredAt: null,
            status: "not_paid",
          },
        ],
      }),
    ).toEqual({ status: "unavailable", reason: "no_final_payment" });
  });

  it("only answers about the installment it was asked about", () => {
    expect(
      decideFinalPaymentRequest({
        purchase: ACTIVE,
        installments: halves(),
        installmentId: "installment-1",
      }),
    ).toEqual({ status: "unavailable", reason: "no_final_payment" });
  });

  it("refuses a canceled purchase and an already-settled half", () => {
    expect(
      decideFinalPaymentRequest({
        purchase: { lifecycleStatus: "canceled" },
        installments: halves(),
        installmentId: "installment-2",
      }),
    ).toEqual({ status: "unavailable", reason: "purchase_canceled" });

    for (const status of ["awaiting_review", "waived", "canceled", "partially_paid"] as const) {
      expect(
        decideFinalPaymentRequest({
          purchase: ACTIVE,
          installments: halves({ status }),
          installmentId: "installment-2",
        }),
      ).toEqual({ status: "unavailable", reason: "final_payment_closed" });
    }
  });
});
