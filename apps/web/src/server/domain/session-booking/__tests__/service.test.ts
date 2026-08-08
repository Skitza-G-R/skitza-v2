import { describe, expect, it } from "vitest";

import {
  artistCancellationOutcome,
  assertSessionBookingAllowed,
  assertSessionSlotAvailable,
  classifySessionSlot,
  initialSessionBookingStatus,
  producerLocalDateKey,
  producerLocalDateRange,
  sessionAllowanceCanBook,
  sessionAvailabilityHorizonDays,
  sessionBillingOptions,
  sessionBookingCapabilities,
  sessionStartFromLocalSlot,
  sessionUseConsumesAllowance,
  studioLocalDateTimeUtcCandidates,
} from "../service";

const now = new Date("2026-07-17T09:00:00.000Z");

function allowed(overrides: Record<string, unknown> = {}) {
  return {
    purchaseLifecycleStatus: "active" as const,
    projectLifecycleStatus: "active" as const,
    allowance: {
      bookingEnabledSnapshot: true,
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
    expect(sessionUseConsumesAllowance("reserved", "complimentary")).toBe(false);
    expect(sessionUseConsumesAllowance("completed", "billable_extra")).toBe(false);
  });

  it("offers included by default until fixed credit is exhausted", () => {
    expect(
      sessionBillingOptions({
        allowanceKind: "fixed",
        sessionLimit: 2,
        existingUses: [
          { allowanceUseId: "one", outcome: "completed", billingTreatment: "included" },
          { allowanceUseId: "gift", outcome: "completed", billingTreatment: "complimentary" },
        ],
      }),
    ).toEqual({
      remainingIncluded: 1,
      defaultTreatment: "included",
      allowedTreatments: ["included", "complimentary"],
    });

    expect(
      sessionBillingOptions({
        allowanceKind: "fixed",
        sessionLimit: 1,
        existingUses: [
          { allowanceUseId: "one", outcome: "completed", billingTreatment: "included" },
        ],
      }),
    ).toEqual({
      remainingIncluded: 0,
      defaultTreatment: null,
      allowedTreatments: ["complimentary", "billable_extra"],
    });
  });

  it("never offers billable extra while unlimited included credit remains", () => {
    expect(
      sessionBillingOptions({
        allowanceKind: "unlimited",
        sessionLimit: null,
        existingUses: Array.from({ length: 10 }, (_, index) => ({
          allowanceUseId: String(index),
          outcome: "completed" as const,
          billingTreatment: "included" as const,
        })),
      }),
    ).toEqual({
      remainingIncluded: null,
      defaultTreatment: "included",
      allowedTreatments: ["included", "complimentary"],
    });
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
      "booking disabled",
      { allowance: { ...allowed().allowance, bookingEnabledSnapshot: false } },
      "BOOKING_DISABLED",
    ],
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

  it.each([
    ["reserved", true],
    ["completed", true],
    ["cancelled_late", true],
    ["no_show", true],
    ["cancelled_on_time", false],
    ["cancelled_by_producer", false],
  ] as const)("applies fixed capacity after a %s outcome", (outcome, consumed) => {
    const operation = () => {
      assertSessionBookingAllowed(
        allowed({
          allowance: { ...allowed().allowance, sessionLimit: 1 },
          existingOutcomes: [outcome],
        }),
      );
    };

    if (consumed) {
      expect(operation).toThrow(expect.objectContaining({ code: "ALLOWANCE_EXHAUSTED" }));
    } else {
      expect(operation).not.toThrow();
    }
  });

  it("does not restore a completed purchase allowance when its project is reopened", () => {
    expect(() => {
      assertSessionBookingAllowed(
        allowed({
          projectLifecycleStatus: "active",
          allowance: {
            ...allowed().allowance,
            closedAt: new Date("2026-07-19T10:00:00.000Z"),
          },
        }),
      );
    }).toThrow(expect.objectContaining({ code: "ALLOWANCE_CLOSED" }));
  });
});

describe("session booking transition policy", () => {
  it("uses automatic confirmation only when the producer enabled it", () => {
    expect(initialSessionBookingStatus(true)).toBe("confirmed");
    expect(initialSessionBookingStatus(false)).toBe("pending_approval");
  });

  it("blocks self-service at the exact cancellation-policy boundary", () => {
    const startsAt = new Date("2026-07-21T12:00:00.000Z");

    expect(
      artistCancellationOutcome({
        startsAt,
        now: new Date("2026-07-20T11:59:59.999Z"),
        cancellationPolicyHours: 24,
      }),
    ).toBe("cancelled_on_time");
    expect(
      artistCancellationOutcome({
        startsAt,
        now: new Date("2026-07-20T12:00:00.000Z"),
        cancellationPolicyHours: 24,
      }),
    ).toBe("cancelled_late");
  });

  it("lets an artist withdraw Held before the start but never reschedule it", () => {
    const capabilities = sessionBookingCapabilities({
      booking: {
        status: "pending_approval",
        startsAt: new Date("2026-07-21T12:00:00.000Z"),
        cancellationPolicyHoursSnapshot: 24,
        heldExpiresAt: new Date("2026-07-21T12:00:00.000Z"),
      },
      purchaseLifecycleStatus: "active",
      projectLifecycleStatus: "active",
      allowanceClosedAt: null,
      now: new Date("2026-07-21T11:00:00.000Z"),
    });

    expect(capabilities).toMatchObject({
      canCancel: true,
      canReschedule: false,
      isOnTime: false,
    });
  });

  it.each([
    ["paused project", "active", "paused", null, false],
    ["closed allowance", "active", "active", now, false],
    ["waiting purchase", "waiting_for_payment", "active", null, false],
    ["active fixed capacity", "active", "active", null, true],
  ] as const)(
    "derives canBook=false for %s",
    (_label, purchaseLifecycleStatus, projectLifecycleStatus, allowanceClosedAt, expected) => {
      expect(
        sessionAllowanceCanBook({
          purchaseLifecycleStatus,
          projectLifecycleStatus,
          allowanceClosedAt,
          allowanceKind: "fixed",
          sessionLimit: 2,
          existingOutcomes: ["completed"],
        }),
      ).toBe(expected);
    },
  );

  it("allows cancellation but not reschedule when the project pauses or allowance closes", () => {
    const booking = {
      status: "confirmed" as const,
      startsAt: new Date("2026-07-21T12:00:00.000Z"),
      cancellationPolicyHoursSnapshot: 24,
      heldExpiresAt: null,
    };

    for (const lifecycle of [
      { projectLifecycleStatus: "paused" as const, allowanceClosedAt: null },
      { projectLifecycleStatus: "active" as const, allowanceClosedAt: now },
    ]) {
      expect(
        sessionBookingCapabilities({
          booking,
          purchaseLifecycleStatus: "active",
          now: new Date("2026-07-20T10:00:00.000Z"),
          ...lifecycle,
        }),
      ).toMatchObject({ canCancel: true, canReschedule: false, isOnTime: true });
    }
  });
});

type SlotPolicyInput = Parameters<typeof assertSessionSlotAvailable>[0];

function availableSlot(overrides: Partial<SlotPolicyInput> = {}): SlotPolicyInput {
  return {
    // Monday 00:30 in Tokyo, while the UTC calendar day is still Sunday.
    startsAt: new Date("2026-07-19T15:30:00.000Z"),
    durationMin: 60,
    bufferMinutes: 15,
    producerTimeZone: "Asia/Tokyo",
    availabilityBlocks: [{ weekday: 1, startMin: 0, endMin: 120 }],
    blackouts: [],
    existingBookings: [],
    ...overrides,
  };
}

describe("authoritative producer availability", () => {
  it("stores Producer-local summer and winter wall clocks as exact UTC instants", () => {
    expect(
      sessionStartFromLocalSlot({
        date: "2026-08-10",
        startMin: 9 * 60,
        producerTimeZone: "Asia/Jerusalem",
      }).toISOString(),
    ).toBe("2026-08-10T06:00:00.000Z");
    expect(
      sessionStartFromLocalSlot({
        date: "2026-12-10",
        startMin: 9 * 60,
        producerTimeZone: "Asia/Jerusalem",
      }).toISOString(),
    ).toBe("2026-12-10T07:00:00.000Z");
  });

  it("derives availability date keys from the producer timezone", () => {
    const instant = new Date("2026-07-19T21:30:00.000Z");

    expect(producerLocalDateKey(instant, "Asia/Jerusalem")).toBe("2026-07-20");
    expect(producerLocalDateKey(instant, "UTC")).toBe("2026-07-19");
  });

  it("returns 14 distinct consecutive producer-local dates across a DST change", () => {
    const dates = producerLocalDateRange(
      new Date("2026-11-01T03:30:00.000Z"),
      "America/New_York",
      14,
    );

    expect(dates).toHaveLength(14);
    expect(new Set(dates)).toHaveLength(14);
    expect(dates[0]).toBe("2026-10-31");
    expect(dates[1]).toBe("2026-11-01");
    expect(dates[13]).toBe("2026-11-13");
  });

  it("keeps a full 14-day choice window beyond the purchased minimum lead time", () => {
    expect(sessionAvailabilityHorizonDays(0)).toBe(14);
    expect(sessionAvailabilityHorizonDays(12)).toBe(15);
    expect(sessionAvailabilityHorizonDays(30 * 24)).toBe(44);
  });

  it("converts a producer-local date and minute into one authoritative instant", () => {
    expect(
      sessionStartFromLocalSlot({
        date: "2026-07-20",
        startMin: 30,
        producerTimeZone: "Asia/Tokyo",
      }).toISOString(),
    ).toBe("2026-07-19T15:30:00.000Z");

    // New York is UTC-5 in January and UTC-4 in July. Both inputs mean
    // exactly 09:30 on the producer's wall clock.
    expect(
      sessionStartFromLocalSlot({
        date: "2026-01-20",
        startMin: 9 * 60 + 30,
        producerTimeZone: "America/New_York",
      }).toISOString(),
    ).toBe("2026-01-20T14:30:00.000Z");
    expect(
      sessionStartFromLocalSlot({
        date: "2026-07-20",
        startMin: 9 * 60 + 30,
        producerTimeZone: "America/New_York",
      }).toISOString(),
    ).toBe("2026-07-20T13:30:00.000Z");
  });

  it("rejects invalid wall-clock input instead of normalizing it", () => {
    for (const input of [
      { date: "2026-02-31", startMin: 60, producerTimeZone: "UTC" },
      { date: "2026-07-20", startMin: -1, producerTimeZone: "UTC" },
      { date: "2026-07-20", startMin: 1440, producerTimeZone: "UTC" },
      { date: "2026-07-20", startMin: 60, producerTimeZone: "Mars/Olympus_Mons" },
    ]) {
      expect(() => sessionStartFromLocalSlot(input), JSON.stringify(input)).toThrow(
        expect.objectContaining({ code: "INVALID_SLOT" }),
      );
    }
  });

  it("rejects a DST gap and resolves a repeated wall clock to the earlier instant", () => {
    expect(() =>
      sessionStartFromLocalSlot({
        date: "2026-03-08",
        startMin: 2 * 60 + 30,
        producerTimeZone: "America/New_York",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_SLOT" }));

    expect(
      sessionStartFromLocalSlot({
        date: "2026-11-01",
        startMin: 1 * 60 + 30,
        producerTimeZone: "America/New_York",
      }).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("exposes every real instant for a repeated studio wall clock", () => {
    expect(
      studioLocalDateTimeUtcCandidates({
        date: "2026-03-08",
        startMin: 2 * 60 + 30,
        timeZone: "America/New_York",
      }),
    ).toEqual([]);

    expect(
      studioLocalDateTimeUtcCandidates({
        date: "2026-11-01",
        startMin: 1 * 60 + 30,
        timeZone: "America/New_York",
      }).map((candidate) => candidate.toISOString()),
    ).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
  });

  it("fails closed for invalid duration, buffer, or availability timezone", () => {
    for (const overrides of [
      { durationMin: 0 },
      { bufferMinutes: -1 },
      { producerTimeZone: "not/a-zone" },
    ]) {
      expect(() => {
        assertSessionSlotAvailable(availableSlot(overrides));
      }).toThrow(expect.objectContaining({ code: "INVALID_SLOT" }));
    }
  });

  it("accepts only a session fully contained in a producer-local weekly block", () => {
    expect(() => {
      assertSessionSlotAvailable(availableSlot());
    }).not.toThrow();

    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({
          // Monday 01:30–02:30 local extends past the 02:00 block end.
          startsAt: new Date("2026-07-19T16:30:00.000Z"),
        }),
      );
    }).toThrow(expect.objectContaining({ code: "OUTSIDE_AVAILABILITY" }));
  });

  it("accepts an exact midnight block boundary but rejects a true cross-day session", () => {
    const lateBlock = availableSlot({
      startsAt: new Date("2026-07-20T23:00:00.000Z"),
      durationMin: 60,
      bufferMinutes: 0,
      producerTimeZone: "UTC",
      availabilityBlocks: [{ weekday: 1, startMin: 23 * 60, endMin: 24 * 60 }],
    });

    expect(() => {
      assertSessionSlotAvailable(lateBlock);
    }).not.toThrow();
    expect(() => {
      assertSessionSlotAvailable({
        ...lateBlock,
        startsAt: new Date("2026-07-20T23:30:00.000Z"),
      });
    }).toThrow(expect.objectContaining({ code: "OUTSIDE_AVAILABILITY" }));
  });

  it("uses the producer timezone rather than the UTC weekday", () => {
    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({ availabilityBlocks: [{ weekday: 0, startMin: 0, endMin: 120 }] }),
      );
    }).toThrow(expect.objectContaining({ code: "OUTSIDE_AVAILABILITY" }));
  });

  it("rejects every instant on an inclusive producer-local blackout date", () => {
    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({ blackouts: [{ startDate: "2026-07-20", endDate: "2026-07-20" }] }),
      );
    }).toThrow(expect.objectContaining({ code: "BLACKOUT" }));
  });

  it("enforces both the existing session buffer and the requested session buffer", () => {
    const block = [{ weekday: 1, startMin: 0, endMin: 360 }];
    const existingBefore = {
      id: "before",
      startsAt: new Date("2026-07-19T15:00:00.000Z"),
      durationMin: 60,
      bufferMinutes: 30,
    };

    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({
          availabilityBlocks: block,
          startsAt: new Date("2026-07-19T16:15:00.000Z"),
          existingBookings: [existingBefore],
        }),
      );
    }).toThrow(expect.objectContaining({ code: "BUFFER_CONFLICT" }));
    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({
          availabilityBlocks: block,
          startsAt: new Date("2026-07-19T16:30:00.000Z"),
          existingBookings: [existingBefore],
        }),
      );
    }).not.toThrow();

    const existingAfter = {
      id: "after",
      startsAt: new Date("2026-07-19T18:00:00.000Z"),
      durationMin: 60,
      bufferMinutes: 0,
    };
    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({
          availabilityBlocks: block,
          startsAt: new Date("2026-07-19T16:45:00.000Z"),
          durationMin: 60,
          bufferMinutes: 30,
          existingBookings: [existingAfter],
        }),
      );
    }).toThrow(expect.objectContaining({ code: "BUFFER_CONFLICT" }));
    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({
          availabilityBlocks: block,
          startsAt: new Date("2026-07-19T16:30:00.000Z"),
          durationMin: 60,
          bufferMinutes: 30,
          existingBookings: [existingAfter],
        }),
      );
    }).not.toThrow();
  });

  it("keeps Skitza overlap hard but makes producer availability, buffer, and cap issues warnings", () => {
    const core = {
      id: "core",
      startsAt: new Date("2026-07-19T15:45:00.000Z"),
      durationMin: 30,
      bufferMinutes: 0,
    };
    const issues = classifySessionSlot({
      ...availableSlot({
        availabilityBlocks: [],
        blackouts: [{ startDate: "2026-07-20", endDate: "2026-07-20" }],
        existingBookings: [core],
        maxSessionsPerDay: 1,
      }),
      actor: "producer",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OUTSIDE_AVAILABILITY", severity: "warning" }),
        expect.objectContaining({ code: "BLACKOUT", severity: "warning" }),
        expect.objectContaining({ code: "BOOKING_CONFLICT", severity: "hard_conflict" }),
        expect.objectContaining({ code: "DAILY_LIMIT", severity: "warning" }),
      ]),
    );
  });

  it("lets a reschedule ignore only the booking it is replacing", () => {
    const replaced = {
      id: "replaced",
      startsAt: new Date("2026-07-19T15:30:00.000Z"),
      durationMin: 60,
      bufferMinutes: 15,
    };
    const other = { ...replaced, id: "other" };

    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({ existingBookings: [replaced], ignoreBookingId: replaced.id }),
      );
    }).not.toThrow();
    expect(() => {
      assertSessionSlotAvailable(
        availableSlot({ existingBookings: [replaced, other], ignoreBookingId: replaced.id }),
      );
    }).toThrow(expect.objectContaining({ code: "BOOKING_CONFLICT" }));
  });
});
