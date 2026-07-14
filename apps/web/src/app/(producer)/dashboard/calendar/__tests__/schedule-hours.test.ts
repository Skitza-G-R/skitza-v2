import { describe, expect, it } from "vitest";

import { deriveScheduleHourRange } from "../schedule-hours";

describe("deriveScheduleHourRange", () => {
  it("uses the existing 09:00–19:00 range when no working hours are configured", () => {
    expect(deriveScheduleHourRange([], [])).toEqual({
      startHour: 9,
      endHour: 19,
    });
  });

  it("rounds producer working hours outward to complete grid rows", () => {
    expect(
      deriveScheduleHourRange(
        [
          { startMin: 570, endMin: 750 },
          { startMin: 840, endMin: 1230 },
        ],
        [],
      ),
    ).toEqual({ startHour: 9, endHour: 21 });
  });

  it("extends through the full end time of a visible session", () => {
    const startsAt = new Date(2026, 6, 15, 18, 0).toISOString();

    expect(
      deriveScheduleHourRange(
        [{ startMin: 540, endMin: 1140 }],
        [{ startsAt, durationMin: 120 }],
      ),
    ).toEqual({ startHour: 9, endHour: 20 });
  });

  it("expands before working hours for an earlier visible session", () => {
    const startsAt = new Date(2026, 6, 15, 8, 30).toISOString();

    expect(
      deriveScheduleHourRange(
        [{ startMin: 600, endMin: 1080 }],
        [{ startsAt, durationMin: 60 }],
      ),
    ).toEqual({ startHour: 8, endHour: 18 });
  });
});
