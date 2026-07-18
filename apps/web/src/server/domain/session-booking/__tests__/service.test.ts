import { describe, expect, it } from "vitest";

import { assertSessionBookingAllowed, sessionUseConsumesAllowance } from "../service";

const now = new Date("2026-07-17T09:00:00.000Z");

function allowed(overrides: Record<string, unknown> = {}) {
  return {
    purchaseLifecycleStatus: "active" as const,
    projectLifecycleStatus: "active" as const,
    allowance: {
      kind: "fixed" as const,
      sessionLimit: 2,
      durationMin: 120,
      minLeadHours: 12,
      closedAt: null,
    },
    existingOutcomes: ["completed"] as const,
    requestedDurationMin: 120,
    startsAt: new Date("2026-07-18T09:00:00.000Z"),
    now,
    ...overrides,
  };
}

describe("session allowance booking policy", () => {
  it("counts reserved, completed, late-cancelled and no-show uses only", () => {
    expect(
      [
        "reserved",
        "completed",
        "cancelled_on_time",
        "cancelled_by_producer",
        "cancelled_late",
        "no_show",
      ].map((outcome) => sessionUseConsumesAllowance(outcome as never)),
    ).toEqual([true, true, false, false, true, true]);
  });

  it("allows an exact active fixed allowance with capacity", () => {
    expect(() => {
      assertSessionBookingAllowed(allowed());
    }).not.toThrow();
  });

  it.each([
    ["waiting purchase", { purchaseLifecycleStatus: "waiting_for_payment" }, "PURCHASE_INACTIVE"],
    ["paused project", { projectLifecycleStatus: "paused" }, "PROJECT_INACTIVE"],
    [
      "closed allowance",
      { allowance: { ...allowed().allowance, closedAt: now } },
      "ALLOWANCE_CLOSED",
    ],
    ["wrong duration", { requestedDurationMin: 60 }, "DURATION_MISMATCH"],
    [
      "too little lead time",
      { startsAt: new Date("2026-07-17T12:00:00.000Z") },
      "LEAD_TIME_VIOLATION",
    ],
    [
      "exhausted fixed limit",
      { existingOutcomes: ["reserved", "completed"] },
      "ALLOWANCE_EXHAUSTED",
    ],
  ])("fails closed for %s", (_label, overrides, code) => {
    expect(() => {
      assertSessionBookingAllowed(allowed(overrides));
    }).toThrow(expect.objectContaining({ code }));
  });

  it("allows unlimited capacity only when its limit is null", () => {
    expect(() => {
      assertSessionBookingAllowed(
        allowed({
          allowance: { ...allowed().allowance, kind: "unlimited", sessionLimit: null },
          existingOutcomes: Array.from({ length: 50 }, () => "completed" as const),
        }),
      );
    }).not.toThrow();

    expect(() => {
      assertSessionBookingAllowed(
        allowed({ allowance: { ...allowed().allowance, kind: "unlimited" } }),
      );
    }).toThrow(expect.objectContaining({ code: "INVALID_ALLOWANCE" }));
  });
});
