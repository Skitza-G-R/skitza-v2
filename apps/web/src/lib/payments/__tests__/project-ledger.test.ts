import { describe, expect, it } from "vitest";

import { summarizeProjectMoney } from "../project-ledger";

const now = new Date("2026-07-14T08:00:00.000Z");

describe("summarizeProjectMoney", () => {
  it("counts a confirmed proof invoice in lifetime and this-month earnings", () => {
    expect(
      summarizeProjectMoney({
        currency: "ILS",
        expectedTotalCents: 300_000,
        finalPaid: false,
        isArchived: false,
        legacyPaidAt: null,
        now,
        invoices: [
          {
            amountCents: 150_000,
            currency: "ILS",
            status: "paid",
            paidAt: new Date("2026-07-13T12:00:00.000Z"),
            createdAt: new Date("2026-07-13T12:00:00.000Z"),
          },
        ],
      }),
    ).toEqual({
      lifetimeCents: 150_000,
      outstandingCents: 150_000,
      paidThisMonthCents: 150_000,
    });
  });

  it("does not count non-paid or different-currency ledger rows as earnings", () => {
    expect(
      summarizeProjectMoney({
        currency: "ILS",
        expectedTotalCents: 0,
        finalPaid: false,
        isArchived: false,
        legacyPaidAt: null,
        now,
        invoices: [
          {
            amountCents: 10_000,
            currency: "ILS",
            status: "draft",
            paidAt: null,
            createdAt: now,
          },
          {
            amountCents: 50_000,
            currency: "USD",
            status: "paid",
            paidAt: now,
            createdAt: now,
          },
        ],
      }),
    ).toEqual({
      lifetimeCents: 0,
      outstandingCents: 10_000,
      paidThisMonthCents: 0,
    });
  });

  it("keeps the legacy finalPaid fallback only when no invoice ledger exists", () => {
    expect(
      summarizeProjectMoney({
        currency: "USD",
        expectedTotalCents: 80_000,
        finalPaid: true,
        isArchived: false,
        legacyPaidAt: new Date("2026-07-02T10:00:00.000Z"),
        now,
        invoices: [],
      }),
    ).toEqual({
      lifetimeCents: 80_000,
      outstandingCents: 0,
      paidThisMonthCents: 80_000,
    });
  });
});
