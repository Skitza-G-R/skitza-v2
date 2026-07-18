import { describe, expect, it } from "vitest";

import {
  EXTERNAL_PAYMENT_BOUNDARY,
  hasPaymentInstructions,
  isInstallmentPayableForInstructions,
  normalizePaymentInstructions,
} from "../policy";

describe("external payment boundary", () => {
  it("keeps Skitza outside the movement of money", () => {
    expect(EXTERNAL_PAYMENT_BOUNDARY).toEqual({
      mode: "external_record_only",
      processorConnectionRequired: false,
      cardCheckoutAvailable: false,
      holdsFunds: false,
      routesFunds: false,
      splitsFunds: false,
      issuesRefundsOrCredits: false,
    });
  });
});

describe("payment instruction normalization", () => {
  it("trims saved values, removes blank fields, and keeps note-only instructions visible", () => {
    const instructions = normalizePaymentInstructions({
      bankTransfer: "   ",
      bitPhone: " 050-123-4567 ",
      note: "  Include the purchase reference.  ",
    });

    expect(instructions).toEqual({
      bitPhone: "050-123-4567",
      note: "Include the purchase reference.",
    });
    expect(hasPaymentInstructions(instructions)).toBe(true);
    expect(hasPaymentInstructions({ note: "Cash is also accepted." })).toBe(true);
    expect(hasPaymentInstructions({})).toBe(false);
  });

  it("rejects values beyond the persisted field limits", () => {
    expect(() => normalizePaymentInstructions({ bankTransfer: "x".repeat(501) })).toThrow(
      /bank transfer/i,
    );
    expect(() => normalizePaymentInstructions({ bitPhone: "1".repeat(33) })).toThrow(/Bit/i);
    expect(() => normalizePaymentInstructions({ note: "x".repeat(501) })).toThrow(/note/i);
  });
});

describe("installment instruction eligibility", () => {
  const now = new Date("2035-01-15T12:00:00.000Z");

  it.each(["confirmed", "waived", "canceled", "awaiting_review"] as const)(
    "hides %s installments",
    (status) => {
      expect(
        isInstallmentPayableForInstructions(
          {
            status,
            dueTrigger: "acceptance",
            dueAt: now,
            triggeredAt: now,
          },
          now,
        ),
      ).toBe(false);
    },
  );

  it("keeps acceptance, partial, due, and overdue installments payable", () => {
    expect(
      isInstallmentPayableForInstructions(
        {
          status: "not_paid",
          dueTrigger: "acceptance",
          dueAt: null,
          triggeredAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isInstallmentPayableForInstructions(
        {
          status: "partially_paid",
          dueTrigger: "monthly_anniversary",
          dueAt: null,
          triggeredAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isInstallmentPayableForInstructions(
        {
          status: "not_paid",
          dueTrigger: "monthly_anniversary",
          dueAt: new Date("2035-01-15T00:00:00.000Z"),
          triggeredAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isInstallmentPayableForInstructions(
        {
          status: "overdue",
          dueTrigger: "artist_approval",
          dueAt: null,
          triggeredAt: null,
        },
        now,
      ),
    ).toBe(true);
  });

  it("hides a future installment until its trigger or due date arrives", () => {
    expect(
      isInstallmentPayableForInstructions(
        {
          status: "not_paid",
          dueTrigger: "artist_approval",
          dueAt: null,
          triggeredAt: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isInstallmentPayableForInstructions(
        {
          status: "not_paid",
          dueTrigger: "artist_approval",
          dueAt: null,
          triggeredAt: now,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isInstallmentPayableForInstructions(
        {
          status: "not_paid",
          dueTrigger: "monthly_anniversary",
          dueAt: new Date("2035-02-15T00:00:00.000Z"),
          triggeredAt: null,
        },
        now,
      ),
    ).toBe(false);
  });
});
