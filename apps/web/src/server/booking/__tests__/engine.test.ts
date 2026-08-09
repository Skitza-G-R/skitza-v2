import { describe, expect, it } from "vitest";

import {
  assertSessionBookingAllowed,
  classifySessionSlot,
  generateArtistExactSessionSlots,
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
    expect(
      classifySessionSlot({
        ...base,
        startsAt: new Date("2026-07-20T09:00:00.000Z"),
        actor: "artist",
      }).some((issue) => issue.code === "GOOGLE_BUSY"),
    ).toBe(false);
  });
});

describe("artist exact-slot generation", () => {
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
