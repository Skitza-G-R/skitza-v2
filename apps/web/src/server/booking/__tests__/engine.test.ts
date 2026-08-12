import { describe, expect, it } from "vitest";

import {
  assertSessionBookingAllowed,
  classifySessionSlot,
  generateArtistExactSessionSlots,
  generateProducerExactSessionSlots,
  sessionAllowanceCanBook,
} from "../index";

const activeAllowance = {
  purchaseLifecycleStatus: "active" as const,
  projectLifecycleStatus: "active" as const,
  allowance: {
    bookingEnabledSnapshot: true,
    kind: "fixed" as const,
    sessionLimit: 1,
    durationMin: 60,
    minLeadHours: 0,
    closedAt: null,
  },
  existingOutcomes: ["completed"] as const,
  existingUses: [
    {
      allowanceUseId: "included-credit",
      outcome: "completed" as const,
      billingTreatment: "included" as const,
    },
  ],
  requestedDurationMin: 60,
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  now: new Date("2026-07-19T06:00:00.000Z"),
};

describe("shared booking entitlement policy", () => {
  it("preserves a rescheduled booking's billing treatment without reopening credit choice", () => {
    expect(() => {
      assertSessionBookingAllowed({
        ...activeAllowance,
        billingTreatment: "billable_extra",
        billingTreatmentMode: "preserve",
      });
    }).not.toThrow();
    expect(() => {
      assertSessionBookingAllowed({
        ...activeAllowance,
        existingOutcomes: [],
        existingUses: [],
        billingTreatment: "billable_extra",
      });
    }).toThrow(expect.objectContaining({ code: "BILLING_TREATMENT_INVALID" }));
  });

  it("keeps reschedule availability open when the original billing treatment transfers", () => {
    const exhausted = {
      purchaseLifecycleStatus: "active" as const,
      projectLifecycleStatus: "active" as const,
      allowanceClosedAt: null,
      bookingEnabledSnapshot: true,
      allowanceKind: "fixed" as const,
      sessionLimit: 1,
      existingOutcomes: ["completed"] as const,
    };

    expect(sessionAllowanceCanBook(exhausted)).toBe(false);
    expect(sessionAllowanceCanBook({ ...exhausted, billingTreatmentMode: "preserve" })).toBe(true);
  });
});

describe("shared slot classification", () => {
  it("keeps core overlap and lead time hard while producer policy overrides remain warnings", () => {
    const issues = classifySessionSlot({
      startsAt: new Date("2026-07-20T10:00:00.000Z"),
      durationMin: 60,
      bufferMinutes: 15,
      producerTimeZone: "UTC",
      availabilityBlocks: [],
      blackouts: [{ startDate: "2026-07-20", endDate: "2026-07-20" }],
      existingBookings: [
        {
          id: "existing",
          startsAt: new Date("2026-07-20T10:30:00.000Z"),
          durationMin: 60,
          bufferMinutes: 15,
        },
      ],
      maxSessionsPerDay: 1,
      now: new Date("2026-07-20T09:30:00.000Z"),
      minLeadHours: 1,
      actor: "producer",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OUTSIDE_AVAILABILITY", severity: "warning" }),
        expect.objectContaining({ code: "BLACKOUT", severity: "warning" }),
        expect.objectContaining({ code: "BOOKING_CONFLICT", severity: "hard_conflict" }),
        expect.objectContaining({ code: "DAILY_LIMIT", severity: "warning" }),
        expect.objectContaining({ code: "LEAD_TIME_VIOLATION", severity: "hard_conflict" }),
      ]),
    );
  });

  it("treats only overlapping Google instants as busy and keeps producer override explicit", () => {
    const base = {
      startsAt: new Date("2026-07-20T10:00:00.000Z"),
      durationMin: 60,
      bufferMinutes: 0,
      producerTimeZone: "UTC",
      availabilityBlocks: [{ weekday: 1, startMin: 9 * 60, endMin: 12 * 60 }],
      blackouts: [],
      existingBookings: [],
      googleBusyIntervals: [
        {
          startsAt: new Date("2026-07-20T10:30:00.000Z"),
          endsAt: new Date("2026-07-20T10:45:00.000Z"),
        },
        {
          startsAt: new Date("2026-07-20T11:00:00.000Z"),
          endsAt: new Date("2026-07-20T12:00:00.000Z"),
        },
      ],
    } as const;

    expect(classifySessionSlot({ ...base, actor: "artist" })).toContainEqual({
      code: "GOOGLE_BUSY",
      severity: "hard_conflict",
      message: "This time overlaps a busy time in Google Calendar",
    });
    expect(classifySessionSlot({ ...base, actor: "producer" })).toContainEqual({
      code: "GOOGLE_BUSY",
      severity: "warning",
      message: "This time overlaps a busy time in Google Calendar",
    });
    expect(classifySessionSlot({ ...base, actor: "producer_google_hard" })).toContainEqual({
      code: "GOOGLE_BUSY",
      severity: "hard_conflict",
      message: "This time overlaps a busy time in Google Calendar",
    });
    expect(
      classifySessionSlot({
        ...base,
        startsAt: new Date("2026-07-20T09:00:00.000Z"),
        actor: "artist",
      }).some((issue) => issue.code === "GOOGLE_BUSY"),
    ).toBe(false);
  });

  it("hardens only Google for strict producer commands and remains fail-open without busy data", () => {
    const issues = classifySessionSlot({
      startsAt: new Date("2026-07-20T20:00:00.000Z"),
      durationMin: 60,
      bufferMinutes: 0,
      producerTimeZone: "UTC",
      availabilityBlocks: [{ weekday: 1, startMin: 9 * 60, endMin: 17 * 60 }],
      blackouts: [{ startDate: "2026-07-20", endDate: "2026-07-20" }],
      existingBookings: [],
      actor: "producer_google_hard",
    });

    expect(issues).toEqual([
      expect.objectContaining({ code: "OUTSIDE_AVAILABILITY", severity: "warning" }),
      expect.objectContaining({ code: "BLACKOUT", severity: "warning" }),
    ]);
    expect(issues.some((issue) => issue.code === "GOOGLE_BUSY")).toBe(false);
  });
});

describe("producer exact-slot generation", () => {
  it("returns every studio day and filters each 15-minute start across the full duration", () => {
    const generated = generateProducerExactSessionSlots({
      now: new Date("2026-07-19T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityBlocks: [{ weekday: 1, startMin: 10 * 60, endMin: 11 * 60 }],
      blackouts: [],
      existingBookings: [],
      googleBusyIntervals: [
        {
          startsAt: new Date("2026-07-20T10:15:00.000Z"),
          endsAt: new Date("2026-07-20T10:30:00.000Z"),
        },
      ],
    });

    expect(generated.days).toHaveLength(14);
    expect(generated.days[0]).toEqual({ date: "2026-07-19", slots: [] });
    expect(
      generated.days
        .find((day) => day.date === "2026-07-20")
        ?.slots.map((slot) => slot.startsAt.toISOString()),
    ).toEqual(["2026-07-20T10:30:00.000Z"]);
  });

  it("keeps exact UTC identity for both repeated producer-local DST starts", () => {
    const generated = generateProducerExactSessionSlots({
      now: new Date("2026-10-31T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityBlocks: [{ weekday: 0, startMin: 90, endMin: 120 }],
      blackouts: [],
      existingBookings: [],
    });

    expect(
      generated.days
        .find((day) => day.date === "2026-11-01")
        ?.slots.map((slot) => slot.startsAt.toISOString()),
    ).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
  });
});

describe("artist exact-slot generation", () => {
  const dailyAvailability = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    startMin: 10 * 60,
    endMin: 11 * 60,
  }));

  it("includes exactly today through day 30 and excludes day 31", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityWindowDays: 30,
      availabilityBlocks: dailyAvailability,
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-07-19");
    expect(studioDates[29]).toBe("2026-08-17");
    expect(studioDates).not.toContain("2026-08-18");
  });

  it("preserves a full 30-day choice window after the minimum lead time", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 48,
      availabilityWindowDays: 30,
      availabilityBlocks: dailyAvailability,
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-07-21");
    expect(studioDates[29]).toBe("2026-08-19");
    expect(studioDates).not.toContain("2026-07-20");
  });

  it("preserves 30 bookable dates when the lead boundary falls after the daily slot", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T12:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 48,
      availabilityWindowDays: 30,
      availabilityBlocks: dailyAvailability,
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-07-22");
    expect(studioDates[29]).toBe("2026-08-20");
    expect(studioDates).not.toContain("2026-07-21");
  });

  it("does not add a carry date when the lead-boundary day still has a bookable slot", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T12:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 48,
      availabilityWindowDays: 30,
      availabilityBlocks: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        startMin: 13 * 60,
        endMin: 14 * 60,
      })),
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-07-21");
    expect(studioDates[29]).toBe("2026-08-19");
    expect(studioDates).not.toContain("2026-08-20");
  });

  it("preserves 30 producer-local dates across the spring DST lead boundary", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-03-08T04:30:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      artistTimeZone: "America/New_York",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 24,
      availabilityWindowDays: 30,
      availabilityBlocks: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        startMin: 60,
        endMin: 90,
      })),
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-03-09");
    expect(studioDates[29]).toBe("2026-04-07");
    expect(studioDates).not.toContain("2026-04-08");
  });

  it("shifts the spring DST window when every boundary candidate is before the cutoff", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-03-08T04:30:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      artistTimeZone: "America/New_York",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 24,
      availabilityWindowDays: 30,
      availabilityBlocks: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        startMin: 0,
        endMin: 30,
      })),
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-03-10");
    expect(studioDates[29]).toBe("2026-04-08");
    expect(studioDates).not.toContain("2026-03-09");
  });

  it("keeps exactly 30 dates when the fall DST lead boundary slot is eligible", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-11-01T04:30:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      artistTimeZone: "America/New_York",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 24,
      availabilityWindowDays: 30,
      availabilityBlocks: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        startMin: 23 * 60 + 30,
        endMin: 24 * 60,
      })),
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-11-01");
    expect(studioDates[29]).toBe("2026-11-30");
    expect(studioDates).not.toContain("2026-12-01");
  });

  it("shifts but does not lengthen the 30-date window at the fall DST lead boundary", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-11-01T04:30:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      artistTimeZone: "America/New_York",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 24,
      availabilityWindowDays: 30,
      availabilityBlocks: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        startMin: 10 * 60,
        endMin: 10 * 60 + 30,
      })),
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2026-11-02");
    expect(studioDates[29]).toBe("2026-12-01");
    expect(studioDates).not.toContain("2026-12-02");
  });

  it("keeps the fall boundary when it has both rejected and eligible candidates", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-11-01T04:30:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      artistTimeZone: "America/New_York",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 24,
      availabilityWindowDays: 30,
      availabilityBlocks: Array.from({ length: 7 }, (_, weekday) => [
        { weekday, startMin: 10 * 60, endMin: 10 * 60 + 30 },
        { weekday, startMin: 23 * 60 + 30, endMin: 24 * 60 },
      ]).flat(),
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );
    const boundaryStarts = generated.days
      .find((day) => day.date === "2026-11-01")
      ?.slots.map((slot) => slot.startsAt.toISOString());

    expect(studioDates).toHaveLength(59);
    expect(boundaryStarts).toEqual(["2026-11-02T04:30:00.000Z"]);
    expect(studioDates).toContain("2026-11-30");
    expect(studioDates).not.toContain("2026-12-01");
  });

  it("does not shift when the lead-boundary weekday has no recurring candidates", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T12:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 48,
      availabilityWindowDays: 30,
      availabilityBlocks: [{ weekday: 4, startMin: 10 * 60, endMin: 11 * 60 }],
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toEqual([
      "2026-07-23",
      "2026-07-30",
      "2026-08-06",
      "2026-08-13",
    ]);
    expect(studioDates).not.toContain("2026-08-20");
  });

  it("preserves the 30-day window at the maximum supported minimum lead time", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 365 * 24,
      availabilityWindowDays: 30,
      availabilityBlocks: dailyAvailability,
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2027-07-19");
    expect(studioDates[29]).toBe("2027-08-17");
  });

  it("preserves 30 bookable dates at the intraday maximum lead boundary", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T12:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 365 * 24,
      availabilityWindowDays: 30,
      availabilityBlocks: dailyAvailability,
      blackouts: [],
      existingBookings: [],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(30);
    expect(studioDates[0]).toBe("2027-07-20");
    expect(studioDates[29]).toBe("2027-08-18");
    expect(studioDates).not.toContain("2027-07-19");
  });

  it("keeps the producer and Artist local-date boundaries across the 30-day window", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T15:30:00.000Z"),
      canBook: true,
      producerTimeZone: "Asia/Tokyo",
      artistTimeZone: "America/Los_Angeles",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityWindowDays: 30,
      availabilityBlocks: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        startMin: 30,
        endMin: 90,
      })),
      blackouts: [],
      existingBookings: [],
    });
    const slots = generated.days.flatMap((day) =>
      day.slots.map((slot) => ({ artistDate: day.date, studioDate: slot.studioDate })),
    );

    expect(slots).toHaveLength(30);
    expect(slots[0]).toEqual({ artistDate: "2026-07-19", studioDate: "2026-07-20" });
    expect(slots[29]).toEqual({ artistDate: "2026-08-17", studioDate: "2026-08-18" });
    expect(slots.some((slot) => slot.studioDate === "2026-08-19")).toBe(false);
  });

  it("removes Google-busy time in days 15–30 without shortening the window", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityWindowDays: 30,
      availabilityBlocks: dailyAvailability,
      blackouts: [],
      existingBookings: [],
      googleBusyIntervals: [
        {
          startsAt: new Date("2026-08-07T10:00:00.000Z"),
          endsAt: new Date("2026-08-07T11:00:00.000Z"),
        },
      ],
    });
    const studioDates = generated.days.flatMap((day) =>
      day.slots.map((slot) => slot.studioDate),
    );

    expect(studioDates).toHaveLength(29);
    expect(studioDates).toContain("2026-08-06");
    expect(studioDates).not.toContain("2026-08-07");
    expect(studioDates).toContain("2026-08-08");
    expect(studioDates[28]).toBe("2026-08-17");
  });

  it("keeps both real instants during a repeated DST wall clock", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-10-31T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      artistTimeZone: "UTC",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityBlocks: [{ weekday: 0, startMin: 90, endMin: 120 }],
      blackouts: [],
      existingBookings: [],
    });
    const repeatedSlots = generated.days
      .flatMap((day) => day.slots)
      .filter((slot) => slot.studioDate === "2026-11-01");

    expect(repeatedSlots.map((slot) => slot.startsAt.toISOString())).toEqual([
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]);
    expect(repeatedSlots.map((slot) => slot.studioStartMin)).toEqual([90, 90]);
  });

  it("removes only the repeated DST instant that Google marks busy", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-10-31T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "America/New_York",
      artistTimeZone: "UTC",
      durationMin: 30,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityBlocks: [{ weekday: 0, startMin: 90, endMin: 120 }],
      blackouts: [],
      existingBookings: [],
      googleBusyIntervals: [
        {
          startsAt: new Date("2026-11-01T05:30:00.000Z"),
          endsAt: new Date("2026-11-01T06:00:00.000Z"),
        },
      ],
    });

    expect(
      generated.days
        .flatMap((day) => day.slots)
        .filter((slot) => slot.studioDate === "2026-11-01")
        .map((slot) => slot.startsAt.toISOString()),
    ).toEqual(["2026-11-01T06:30:00.000Z"]);
  });

  it("authors studio blocks but groups results by artist-local date", () => {
    const generated = generateArtistExactSessionSlots({
      now: new Date("2026-07-19T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "Asia/Tokyo",
      artistTimeZone: "America/Los_Angeles",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityBlocks: [{ weekday: 1, startMin: 30, endMin: 90 }],
      blackouts: [],
      existingBookings: [],
    });
    const tokyoMonday = generated.days
      .flatMap((day) => day.slots.map((slot) => ({ day: day.date, slot })))
      .find(({ slot }) => slot.studioDate === "2026-07-20");

    expect(tokyoMonday).toMatchObject({
      day: "2026-07-19",
      slot: { studioDate: "2026-07-20", studioStartMin: 30 },
    });
  });

  it("filters lead-time and producer-local daily-cap violations", () => {
    const base = {
      now: new Date("2026-07-20T09:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 2,
      availabilityBlocks: [{ weekday: 1, startMin: 9 * 60, endMin: 13 * 60 }],
      blackouts: [],
      existingBookings: [],
    } as const;
    const leadFiltered = generateArtistExactSessionSlots(base)
      .days.flatMap((day) => day.slots)
      .filter((slot) => slot.studioDate === "2026-07-20");
    const capped = generateArtistExactSessionSlots({
      ...base,
      maxSessionsPerDay: 1,
      existingBookings: [
        {
          id: "daily-cap",
          startsAt: new Date("2026-07-20T15:00:00.000Z"),
          durationMin: 60,
          bufferMinutes: 0,
        },
      ],
    })
      .days.flatMap((day) => day.slots)
      .filter((slot) => slot.studioDate === "2026-07-20");

    expect(leadFiltered[0]?.startsAt.toISOString()).toBe("2026-07-20T11:00:00.000Z");
    expect(capped).toEqual([]);
  });

  it("ignores only the booking being rescheduled and closes all slots when booking is disabled", () => {
    const startsAt = new Date("2026-07-20T10:00:00.000Z");
    const base = {
      now: new Date("2026-07-19T00:00:00.000Z"),
      canBook: true,
      producerTimeZone: "UTC",
      artistTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 0,
      minLeadHours: 0,
      availabilityBlocks: [{ weekday: 1, startMin: 10 * 60, endMin: 11 * 60 }],
      blackouts: [],
      existingBookings: [{ id: "source", startsAt, durationMin: 60, bufferMinutes: 0 }],
    } as const;

    expect(
      generateArtistExactSessionSlots(base)
        .days.flatMap((day) => day.slots)
        .some((slot) => slot.startsAt.getTime() === startsAt.getTime()),
    ).toBe(false);
    expect(
      generateArtistExactSessionSlots({ ...base, ignoreBookingId: "source" })
        .days.flatMap((day) => day.slots)
        .some((slot) => slot.startsAt.getTime() === startsAt.getTime()),
    ).toBe(true);
    expect(generateArtistExactSessionSlots({ ...base, canBook: false }).days).toEqual([]);
  });
});
