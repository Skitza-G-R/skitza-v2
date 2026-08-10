import { describe, expect, it } from "vitest";

import {
  buildScheduleGoogleBusyModel,
  isScheduleGoogleBusyStart,
  scheduleGoogleBusyDay,
  type BuildScheduleGoogleBusyModelInput,
} from "../schedule-google-busy";

function build(
  overrides: Partial<BuildScheduleGoogleBusyModelInput> = {},
): ReturnType<typeof buildScheduleGoogleBusyModel> {
  return buildScheduleGoogleBusyModel({
    weekStart: "2026-08-09",
    studioTimeZone: "UTC",
    workingBlocks: [{ weekday: 1, startMin: 9 * 60, endMin: 11 * 60 }],
    protection: "google_aware",
    health: "healthy",
    intervals: [],
    visibleStartMin: 9 * 60,
    visibleEndMin: 19 * 60,
    ...overrides,
  });
}

function day(model: ReturnType<typeof buildScheduleGoogleBusyModel>, studioDate: string) {
  const value = scheduleGoogleBusyDay(model, studioDate);
  if (!value) throw new Error(`Missing ${studioDate}`);
  return value;
}

describe("schedule Google busy model", () => {
  it("clips overlapping UTC intervals into merged quarter-hour bands with a center", () => {
    const model = build({
      intervals: [
        {
          startsAt: "2026-08-10T09:07:00.000Z",
          endsAt: "2026-08-10T09:45:00.000Z",
        },
        {
          startsAt: "2026-08-10T09:30:00.000Z",
          endsAt: "2026-08-10T10:08:00.000Z",
        },
      ],
    });
    const monday = day(model, "2026-08-10");

    expect(monday.bands).toEqual([
      {
        key: "2026-08-10:540-615",
        studioDate: "2026-08-10",
        startMin: 540,
        endMin: 615,
        durationMin: 75,
        centerMin: 577.5,
        coverage: "blocked",
      },
    ]);
    expect(isScheduleGoogleBusyStart(model, "2026-08-10", 9 * 60)).toBe(true);
    expect(isScheduleGoogleBusyStart(model, "2026-08-10", 10 * 60 + 15)).toBe(false);
  });

  it("splits a cross-midnight interval by studio day and clips to visible hours", () => {
    const model = build({
      workingBlocks: [
        { weekday: 1, startMin: 9 * 60, endMin: 19 * 60 },
        { weekday: 2, startMin: 9 * 60, endMin: 19 * 60 },
      ],
      intervals: [
        {
          startsAt: "2026-08-10T18:50:00.000Z",
          endsAt: "2026-08-11T09:10:00.000Z",
        },
      ],
    });

    expect(day(model, "2026-08-10").bands).toMatchObject([
      { startMin: 18 * 60 + 45, endMin: 19 * 60, centerMin: 18 * 60 + 52.5 },
    ]);
    expect(day(model, "2026-08-11").bands).toMatchObject([
      { startMin: 9 * 60, endMin: 9 * 60 + 15, centerMin: 9 * 60 + 7.5 },
    ]);
  });

  it("distinguishes closed, partially available, and Google-full days", () => {
    const full = build({
      intervals: [
        {
          startsAt: "2026-08-10T09:00:00.000Z",
          endsAt: "2026-08-10T11:00:00.000Z",
        },
      ],
    });
    const partial = build({
      intervals: [
        {
          startsAt: "2026-08-10T09:00:00.000Z",
          endsAt: "2026-08-10T10:00:00.000Z",
        },
      ],
    });

    expect(day(full, "2026-08-10").state).toBe("google_full");
    expect(day(full, "2026-08-11").state).toBe("closed");
    expect(day(partial, "2026-08-10").state).toBe("available");
  });

  it("discards stale intervals whenever Google protection is reduced", () => {
    const model = build({
      protection: "skitza_only",
      health: "reconnect_required",
      intervals: [
        {
          startsAt: "2026-08-10T09:00:00.000Z",
          endsAt: "2026-08-10T11:00:00.000Z",
        },
      ],
    });
    const monday = day(model, "2026-08-10");

    expect(model.googleBusyCurrent).toBe(false);
    expect(monday.state).toBe("unknown");
    expect(monday.bands).toEqual([]);
    expect(monday.busyStartMinutes).toEqual([]);
  });

  it("treats an all-day interval as full across a 23-hour DST day", () => {
    const model = build({
      weekStart: "2026-03-08",
      studioTimeZone: "America/New_York",
      workingBlocks: [{ weekday: 0, startMin: 9 * 60, endMin: 17 * 60 }],
      visibleStartMin: 9 * 60,
      visibleEndMin: 17 * 60,
      intervals: [
        {
          startsAt: "2026-03-08T05:00:00.000Z",
          endsAt: "2026-03-09T04:00:00.000Z",
        },
      ],
    });
    const sunday = day(model, "2026-03-08");

    expect(sunday.state).toBe("google_full");
    expect(sunday.bands).toMatchObject([
      {
        startMin: 9 * 60,
        endMin: 17 * 60,
        durationMin: 8 * 60,
        centerMin: 13 * 60,
      },
    ]);
  });

  it("keeps a repeated DST wall time available when one real occurrence is free", () => {
    const oneOccurrence = build({
      weekStart: "2026-11-01",
      studioTimeZone: "America/New_York",
      workingBlocks: [{ weekday: 0, startMin: 60, endMin: 120 }],
      visibleStartMin: 60,
      visibleEndMin: 180,
      intervals: [
        {
          startsAt: "2026-11-01T05:00:00.000Z",
          endsAt: "2026-11-01T06:00:00.000Z",
        },
      ],
    });
    const bothOccurrences = build({
      weekStart: "2026-11-01",
      studioTimeZone: "America/New_York",
      workingBlocks: [{ weekday: 0, startMin: 60, endMin: 120 }],
      visibleStartMin: 60,
      visibleEndMin: 180,
      intervals: [
        {
          startsAt: "2026-11-01T05:00:00.000Z",
          endsAt: "2026-11-01T07:00:00.000Z",
        },
      ],
    });

    const partialSunday = day(oneOccurrence, "2026-11-01");
    expect(partialSunday.state).toBe("available");
    expect(partialSunday.blockedStartMinutes).toEqual([]);
    expect(partialSunday.partialBusyStartMinutes).toEqual([60, 75, 90, 105]);
    expect(partialSunday.bands).toMatchObject([{ startMin: 60, endMin: 120, coverage: "partial" }]);
    expect(day(bothOccurrences, "2026-11-01").state).toBe("google_full");
  });

  it("does not pull a repeated wall time back inside an earlier working block", () => {
    const model = build({
      weekStart: "2026-11-01",
      studioTimeZone: "America/New_York",
      workingBlocks: [{ weekday: 0, startMin: 0, endMin: 90 }],
      visibleStartMin: 0,
      visibleEndMin: 180,
    });

    expect(day(model, "2026-11-01").workingStartMinutes).not.toContain(105);
  });

  it("marks a working block that exists only in a DST gap as closed", () => {
    const model = build({
      weekStart: "2026-03-08",
      studioTimeZone: "America/New_York",
      workingBlocks: [{ weekday: 0, startMin: 2 * 60, endMin: 3 * 60 }],
      visibleStartMin: 60,
      visibleEndMin: 4 * 60,
    });

    expect(day(model, "2026-03-08").state).toBe("closed");
    expect(day(model, "2026-03-08").workingStartMinutes).toEqual([]);
  });

  it("fails open to unknown when a supposedly healthy payload is malformed", () => {
    const model = build({
      intervals: [{ startsAt: "not-a-date", endsAt: "also-not-a-date" }],
    });

    expect(model.googleBusyCurrent).toBe(false);
    expect(day(model, "2026-08-10").state).toBe("unknown");
    expect(day(model, "2026-08-10").bands).toEqual([]);
  });
});
