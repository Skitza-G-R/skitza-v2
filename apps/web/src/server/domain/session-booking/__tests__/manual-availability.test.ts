import { describe, expect, it } from "vitest";

import {
  generateProducerManualSessionAvailability,
  type ProducerManualSessionAvailabilitySnapshot,
} from "../manual";

describe("producer manual exact availability", () => {
  it("uses the selected project duration and keeps a Google-full day in the read model", () => {
    const snapshot: ProducerManualSessionAvailabilitySnapshot = {
      now: new Date("2026-07-19T00:00:00.000Z"),
      studioTimeZone: "UTC",
      durationMin: 60,
      bufferMinutes: 15,
      minLeadHours: 0,
      maxSessionsPerDay: null,
      availabilityBlocks: [{ weekday: 1, startMin: 9 * 60, endMin: 12 * 60 }],
      blackouts: [],
      existingBookings: [
        {
          id: "existing-session",
          startsAt: new Date("2026-07-20T10:30:00.000Z"),
          durationMin: 30,
          bufferMinutes: 15,
        },
      ],
    };

    const skitzaOnly = generateProducerManualSessionAvailability(snapshot);
    expect(skitzaOnly.durationMin).toBe(60);
    expect(
      skitzaOnly.days
        .find((day) => day.date === "2026-07-20")
        ?.slots.map((slot) => slot.startsAt.toISOString()),
    ).toEqual(["2026-07-20T09:00:00.000Z", "2026-07-20T09:15:00.000Z"]);

    const googleFull = generateProducerManualSessionAvailability(snapshot, [
      {
        startsAt: new Date("2026-07-20T09:00:00.000Z"),
        endsAt: new Date("2026-07-20T10:30:00.000Z"),
      },
    ]);
    expect(googleFull.days.find((day) => day.date === "2026-07-20")).toEqual({
      date: "2026-07-20",
      slots: [],
    });
  });
});
