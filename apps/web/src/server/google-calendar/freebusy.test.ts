import { describe, expect, it } from "vitest";

import { normalizeGoogleCalendarBusyIntervals } from "./freebusy";

describe("Google Calendar busy interval normalization", () => {
  it("normalizes RFC3339 offsets to UTC, clips the query window, and merges overlaps", () => {
    const intervals = normalizeGoogleCalendarBusyIntervals({
      timeMin: new Date("2026-10-25T00:00:00.000Z"),
      timeMax: new Date("2026-10-25T04:00:00.000Z"),
      intervals: [
        {
          start: "2026-10-25T03:30:00+03:00",
          end: "2026-10-25T03:30:00+02:00",
        },
        { start: "2026-10-25T01:15:00Z", end: "2026-10-25T02:00:00Z" },
        { start: "2026-10-25T03:30:00Z", end: "2026-10-25T05:00:00Z" },
      ],
    });

    expect(
      intervals.map((interval) => ({
        startsAt: interval.startsAt.toISOString(),
        endsAt: interval.endsAt.toISOString(),
      })),
    ).toEqual([
      {
        startsAt: "2026-10-25T00:30:00.000Z",
        endsAt: "2026-10-25T02:00:00.000Z",
      },
      {
        startsAt: "2026-10-25T03:30:00.000Z",
        endsAt: "2026-10-25T04:00:00.000Z",
      },
    ]);
  });

  it("keeps the window half-open and rejects malformed provider intervals", () => {
    const window = {
      timeMin: new Date("2026-08-09T10:00:00.000Z"),
      timeMax: new Date("2026-08-09T11:00:00.000Z"),
    };
    expect(
      normalizeGoogleCalendarBusyIntervals({
        ...window,
        intervals: [
          { start: "2026-08-09T09:00:00Z", end: "2026-08-09T10:00:00Z" },
          { start: "2026-08-09T11:00:00Z", end: "2026-08-09T12:00:00Z" },
        ],
      }),
    ).toEqual([]);
    expect(() =>
      normalizeGoogleCalendarBusyIntervals({
        ...window,
        intervals: [{ start: "2026-02-30T10:00:00Z", end: "2026-08-09T10:30:00Z" }],
      }),
    ).toThrow();
    expect(() =>
      normalizeGoogleCalendarBusyIntervals({
        ...window,
        intervals: [{ start: "2026-08-09T10:30:00Z", end: "2026-08-09T10:15:00Z" }],
      }),
    ).toThrow();
  });
});
