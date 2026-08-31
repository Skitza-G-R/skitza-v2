import { describe, expect, it } from "vitest";

import type {
  ProjectPurchaseInstallment,
  ProjectPurchaseSummary,
} from "~/components/dashboard/projects/project-purchases-panel";

import {
  amountHint,
  composePaymentNote,
  defaultPaymentSelection,
  listRecordablePayments,
  paidAtIsoFromDate,
  parseAmountToCents,
  receiptContentType,
  selectablePayments,
  successMessage,
  summarizeRecordable,
  validateAmount,
  validateReceiptFile,
} from "../record-payment-model";

function installment(
  overrides: Partial<ProjectPurchaseInstallment> & { id: string },
): ProjectPurchaseInstallment {
  return {
    position: 1,
    amountCents: 50_000,
    currency: "ILS",
    dueAtIso: "2026-08-01T09:00:00.000Z",
    status: "not_paid",
    remainingCents: 50_000,
    hasPendingProof: false,
    payableNow: true,
    ...overrides,
  };
}

function purchase(
  overrides: Partial<ProjectPurchaseSummary> & { id: string },
): ProjectPurchaseSummary {
  return {
    sourceKind: "store_product",
    sourceLabel: "Full production",
    lifecycleStatus: "active",
    totalCents: 100_000,
    currency: "ILS",
    installments: [],
    ...overrides,
  };
}

describe("listRecordablePayments", () => {
  it("drops settled installments and flags blocked ones with a reason", () => {
    const list = listRecordablePayments([
      purchase({
        id: "p1",
        installments: [
          installment({ id: "i1", status: "confirmed", remainingCents: 0 }),
          installment({ id: "i2", position: 2, status: "partially_paid", remainingCents: 20_000 }),
          installment({ id: "i3", position: 3, dueAtIso: null, payableNow: false }),
          installment({ id: "i4", position: 4, hasPendingProof: true, status: "awaiting_review" }),
          installment({ id: "i5", position: 5, status: "waived", remainingCents: 0 }),
        ],
      }),
      purchase({
        id: "p2",
        lifecycleStatus: "canceled",
        installments: [installment({ id: "c1" })],
      }),
    ]);

    expect(list.map((payment) => [payment.id, payment.state])).toEqual([
      ["i2", "open"],
      ["i3", "not_due"],
      ["i4", "proof_pending"],
      ["c1", "purchase_canceled"],
    ]);
    expect(list[0]?.remainingCents).toBe(20_000);
    expect(list[0]?.installmentCount).toBe(5);
  });

  it("auto-selects only when exactly one installment is open", () => {
    const one = listRecordablePayments([
      purchase({ id: "p1", installments: [installment({ id: "i1" })] }),
    ]);
    expect(defaultPaymentSelection(one)).toBe("i1");

    const two = listRecordablePayments([
      purchase({
        id: "p1",
        installments: [installment({ id: "i1" }), installment({ id: "i2", position: 2 })],
      }),
    ]);
    expect(defaultPaymentSelection(two)).toBeNull();

    const blockedOnly = listRecordablePayments([
      purchase({ id: "p1", installments: [installment({ id: "i1", payableNow: false })] }),
    ]);
    expect(defaultPaymentSelection(blockedOnly)).toBeNull();
  });

  it("sums what is left per currency across open installments only", () => {
    const summary = summarizeRecordable(
      listRecordablePayments([
        purchase({
          id: "p1",
          installments: [
            installment({ id: "i1", remainingCents: 30_000 }),
            installment({ id: "i2", position: 2, remainingCents: 20_000, payableNow: false }),
          ],
        }),
        purchase({
          id: "p2",
          installments: [installment({ id: "u1", currency: "USD", remainingCents: 9_900 })],
        }),
      ]),
    );
    expect(summary).toEqual({
      openCount: 2,
      milestoneCount: 0,
      remainingByCurrency: [
        { currency: "ILS", cents: 30_000 },
        { currency: "USD", cents: 9_900 },
      ],
      milestoneByCurrency: [],
    });
  });
});

// SK-293 — a 50/50 final half whose artist approval never happened in Skitza.
// It is not due, but the producer may still record money that already arrived.
describe("the final half waiting on an approval that never came", () => {
  const stuck = () =>
    listRecordablePayments([
      purchase({
        id: "p1",
        installments: [
          installment({ id: "i1", status: "confirmed", remainingCents: 0 }),
          installment({
            id: "i2",
            position: 2,
            dueAtIso: null,
            payableNow: false,
            finalMilestonePending: true,
            remainingCents: 50_000,
          }),
        ],
      }),
    ]);

  it("reads as its own state rather than a flat refusal", () => {
    expect(stuck().map((payment) => [payment.id, payment.state])).toEqual([
      ["i2", "needs_milestone"],
    ]);
    // Without the flag it is the dead end the producer hit.
    const plain = listRecordablePayments([
      purchase({
        id: "p1",
        installments: [installment({ id: "i2", position: 2, dueAtIso: null, payableNow: false })],
      }),
    ]);
    expect(plain[0]?.state).toBe("not_due");
  });

  it("is selectable and auto-selected when it is the only thing left", () => {
    expect(selectablePayments(stuck()).map((payment) => payment.id)).toEqual(["i2"]);
    expect(defaultPaymentSelection(stuck())).toBe("i2");
  });

  it("is counted apart from money that is genuinely due", () => {
    // A healthy in-flight project must not read as owed money it is not owed,
    // but the tab still has to offer the button.
    expect(summarizeRecordable(stuck())).toEqual({
      openCount: 0,
      milestoneCount: 1,
      remainingByCurrency: [],
      milestoneByCurrency: [{ currency: "ILS", cents: 50_000 }],
    });
  });
});

describe("amount handling", () => {
  it("parses human-typed amounts into cents", () => {
    expect(parseAmountToCents("1,250")).toBe(125_000);
    expect(parseAmountToCents("1250.50")).toBe(125_050);
    expect(parseAmountToCents("₪ 300")).toBe(30_000);
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("12.345")).toBeNull();
  });

  it("rejects empty, zero, and over-the-balance amounts", () => {
    expect(validateAmount(null, 50_000, "ILS")).toMatch(/enter the amount/i);
    expect(validateAmount(0, 50_000, "ILS")).toMatch(/above zero/i);
    expect(validateAmount(50_001, 50_000, "ILS")).toMatch(/more than what is left/i);
    expect(validateAmount(50_000, 50_000, "ILS")).toBeNull();
    expect(validateAmount(1, 50_000, "ILS")).toBeNull();
  });

  // SK-296 — the producer types a number; the line under the field answers
  // "what is left?" instead of repeating the balance they started from.
  it("subtracts the typed amount and says what is left after it", () => {
    expect(amountHint(47_200, 472_000, "ILS")).toEqual({
      tone: "remainder",
      text: "₪4,248 left after this.",
    });
    expect(amountHint(472_000, 472_000, "ILS")).toEqual({
      tone: "settled",
      text: "Nothing left after this.",
    });
  });

  it("keeps the orienting balance while there is no usable amount to subtract", () => {
    const prompt = { tone: "prompt", text: "₪4,720 left. Partial amounts are fine." };
    // Untouched field, empty field, or something that is not an amount yet.
    expect(amountHint(null, 472_000, "ILS")).toEqual(prompt);
    expect(amountHint(0, 472_000, "ILS")).toEqual(prompt);
    // validateAmount owns the over-payment message, so the hint stays quiet.
    expect(amountHint(472_001, 472_000, "ILS")).toEqual(prompt);
  });
});

describe("note and date", () => {
  it("folds the method and free text into one ledger note", () => {
    expect(composePaymentNote("bank_transfer", " ref 8841 ")).toBe("Bank transfer — ref 8841");
    expect(composePaymentNote("cash", "")).toBe("Cash");
    expect(composePaymentNote(null, "paid at the studio")).toBe("paid at the studio");
    expect(composePaymentNote(null, "  ")).toBeUndefined();
  });

  it("never produces a payment date in the future", () => {
    const now = new Date(2026, 7, 23, 9, 30);
    expect(paidAtIsoFromDate("2026-08-20", now)).toBe(
      new Date(2026, 7, 20, 12, 0, 0, 0).toISOString(),
    );
    expect(paidAtIsoFromDate("2026-08-23", now)).toBe(now.toISOString());
    expect(paidAtIsoFromDate("2026-08-24", now)).toBeNull();
    expect(paidAtIsoFromDate("nope", now)).toBeNull();
  });
});

describe("receipt files", () => {
  it("accepts photos and PDFs, falling back to the extension for HEIC", () => {
    expect(receiptContentType({ name: "IMG_1.HEIC", type: "" })).toBe("image/heic");
    expect(receiptContentType({ name: "receipt.pdf", type: "application/pdf" })).toBe(
      "application/pdf",
    );
    expect(receiptContentType({ name: "notes.txt", type: "text/plain" })).toBeNull();
  });

  it("rejects unsupported or oversized files with a plain message", () => {
    expect(validateReceiptFile({ name: "song.wav", type: "audio/wav", size: 10 })).toEqual({
      ok: false,
      error: expect.stringMatching(/photo .* or a PDF/i) as string,
    });
    expect(
      validateReceiptFile({ name: "big.png", type: "image/png", size: 16 * 1024 * 1024 }),
    ).toEqual({ ok: false, error: expect.stringMatching(/15 MB/) as string });
    expect(validateReceiptFile({ name: "ok.png", type: "image/png", size: 1_000 })).toEqual({
      ok: true,
      contentType: "image/png",
    });
  });
});

describe("successMessage", () => {
  it("tells the producer what changed", () => {
    expect(
      successMessage({ installmentPosition: 1, installmentStatus: "confirmed", paidInFull: true }),
    ).toMatch(/paid in full/);
    expect(
      successMessage({ installmentPosition: 2, installmentStatus: "confirmed", paidInFull: false }),
    ).toBe("Payment recorded — payment 2 is paid.");
    expect(
      successMessage({
        installmentPosition: 2,
        installmentStatus: "partially_paid",
        paidInFull: false,
      }),
    ).toMatch(/partially paid/);
  });
});
