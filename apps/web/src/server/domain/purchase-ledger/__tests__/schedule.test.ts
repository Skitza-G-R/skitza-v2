import { describe, expect, it } from "vitest";

import {
  isOverdueOnLocalDate,
  monthlyInstallmentDates,
  paymentReminderOccurrences,
} from "../schedule";

describe("purchase-ledger calendar schedules", () => {
  it.each([
    {
      firstConfirmedAt: "2026-01-31T10:00:00.000Z",
      expected: ["2026-02-28T10:00:00.000Z", "2026-03-31T10:00:00.000Z"],
    },
    {
      firstConfirmedAt: "2024-01-31T10:00:00.000Z",
      expected: ["2024-02-29T10:00:00.000Z", "2024-03-31T10:00:00.000Z"],
    },
    {
      firstConfirmedAt: "2026-08-31T10:00:00.000Z",
      expected: ["2026-09-30T10:00:00.000Z", "2026-10-31T10:00:00.000Z"],
    },
  ])("clamps month-end without drifting the original day", ({ firstConfirmedAt, expected }) => {
    expect(
      monthlyInstallmentDates({
        firstConfirmedAt: new Date(firstConfirmedAt),
        installmentCount: 3,
        timeZone: "UTC",
      }).map((row) => row.dueAt.toISOString()),
    ).toEqual(expected);
  });

  it("keeps the producer's local time across daylight-saving changes", () => {
    expect(
      monthlyInstallmentDates({
        firstConfirmedAt: new Date("2026-01-31T15:00:00.000Z"),
        installmentCount: 4,
        timeZone: "America/New_York",
      }).map((row) => row.dueAt.toISOString()),
    ).toEqual(["2026-02-28T15:00:00.000Z", "2026-03-31T14:00:00.000Z", "2026-04-30T14:00:00.000Z"]);
  });

  it("marks an installment overdue only after its producer-local due date", () => {
    const dueAt = new Date("2026-07-20T20:00:00.000Z"); // 23:00 in Jerusalem

    expect(
      isOverdueOnLocalDate(dueAt, new Date("2026-07-20T20:30:00.000Z"), "Asia/Jerusalem"),
    ).toBe(false);
    expect(
      isOverdueOnLocalDate(dueAt, new Date("2026-07-20T22:30:00.000Z"), "Asia/Jerusalem"),
    ).toBe(true);
  });
});

describe("purchase reminder cadence", () => {
  it("uses three days before, due date, three days late, then weekly", () => {
    const dueAt = new Date("2026-07-20T10:00:00.000Z");

    expect(
      paymentReminderOccurrences(dueAt, new Date("2026-08-06T10:00:00.000Z"), "UTC").map(
        ({ kind, scheduledFor }) => [kind, scheduledFor.toISOString()],
      ),
    ).toEqual([
      ["automatic_3_days_before", "2026-07-17T10:00:00.000Z"],
      ["automatic_due", "2026-07-20T10:00:00.000Z"],
      ["automatic_3_days_late", "2026-07-23T10:00:00.000Z"],
      ["automatic_weekly_late", "2026-07-30T10:00:00.000Z"],
      ["automatic_weekly_late", "2026-08-06T10:00:00.000Z"],
    ]);
  });

  it("does not return future reminder occurrences", () => {
    expect(
      paymentReminderOccurrences(
        new Date("2026-07-20T10:00:00.000Z"),
        new Date("2026-07-18T10:00:00.000Z"),
        "UTC",
      ).map((occurrence) => occurrence.kind),
    ).toEqual(["automatic_3_days_before"]);
  });

  it("keeps reminder dates on the producer's local calendar across DST", () => {
    expect(
      paymentReminderOccurrences(
        new Date("2026-11-01T04:30:00.000Z"),
        new Date("2026-11-11T06:00:00.000Z"),
        "America/New_York",
      ).map(({ kind, scheduledFor }) => [kind, scheduledFor.toISOString()]),
    ).toEqual([
      ["automatic_3_days_before", "2026-10-29T04:30:00.000Z"],
      ["automatic_due", "2026-11-01T04:30:00.000Z"],
      ["automatic_3_days_late", "2026-11-04T05:30:00.000Z"],
      ["automatic_weekly_late", "2026-11-11T05:30:00.000Z"],
    ]);
  });
});
