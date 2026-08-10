import { describe, expect, it } from "vitest";

import { googleCalendarBusyWeekWindow, presentGoogleCalendarBusyWeek } from "./busy-week";
import type { GoogleCalendarBusyResult } from "./service";

describe("Google Calendar exact busy week", () => {
  it("uses an exact half-open seven-day UTC window", () => {
    const window = googleCalendarBusyWeekWindow({
      weekStart: "2026-08-09",
      timeZone: "UTC",
    });

    expect(window).toEqual({
      timeMin: new Date("2026-08-09T00:00:00.000Z"),
      timeMax: new Date("2026-08-16T00:00:00.000Z"),
    });
  });

  it("uses civil week boundaries instead of adding 168 hours across DST", () => {
    const spring = googleCalendarBusyWeekWindow({
      weekStart: "2026-03-08",
      timeZone: "America/New_York",
    });
    const fall = googleCalendarBusyWeekWindow({
      weekStart: "2026-11-01",
      timeZone: "America/New_York",
    });

    expect(spring).toEqual({
      timeMin: new Date("2026-03-08T05:00:00.000Z"),
      timeMax: new Date("2026-03-15T04:00:00.000Z"),
    });
    expect(fall).toEqual({
      timeMin: new Date("2026-11-01T04:00:00.000Z"),
      timeMax: new Date("2026-11-08T05:00:00.000Z"),
    });
  });

  it("rejects malformed civil dates", () => {
    expect(() =>
      googleCalendarBusyWeekWindow({
        weekStart: "2026-02-30",
        timeZone: "UTC",
      }),
    ).toThrow("studio calendar");
  });

  it("presents only ISO busy instants and coarse health", () => {
    const result = {
      protection: "google_aware",
      health: "healthy",
      intervals: [
        {
          startsAt: new Date("2026-08-10T10:00:00.000Z"),
          endsAt: new Date("2026-08-10T11:00:00.000Z"),
        },
      ],
    } satisfies GoogleCalendarBusyResult;

    const presented = presentGoogleCalendarBusyWeek(result);

    expect(presented).toEqual({
      protection: "google_aware",
      health: "healthy",
      intervals: [
        {
          startsAt: "2026-08-10T10:00:00.000Z",
          endsAt: "2026-08-10T11:00:00.000Z",
        },
      ],
    });
    expect(Object.keys(presented).sort()).toEqual(["health", "intervals", "protection"]);
    expect(JSON.stringify(presented)).not.toMatch(
      /calendarId|eventId|summary|description|attendee|location|account|token/iu,
    );
  });
});
