import { describe, expect, it } from "vitest";

import { calendarSlotFromPointer, studioDateKey } from "../calendar-slot";

describe("calendar slot selection", () => {
  it("keeps the UTC calendar marker as the producer studio date", () => {
    expect(studioDateKey(new Date("2026-08-13T00:00:00.000Z"))).toBe("2026-08-13");
  });

  it.each([
    { clientY: 90, expected: 14 * 60 },
    { clientY: 114.99, expected: 14 * 60 },
    { clientY: 115, expected: 14 * 60 + 15 },
    { clientY: 139.99, expected: 14 * 60 + 15 },
    { clientY: 140, expected: 14 * 60 + 30 },
    { clientY: 165, expected: 14 * 60 + 45 },
    { clientY: 300, expected: 14 * 60 + 45 },
  ])("snaps pointer $clientY down to a 15-minute studio slot", ({ clientY, expected }) => {
    expect(
      calendarSlotFromPointer({
        dayMarker: new Date("2026-08-13T00:00:00.000Z"),
        hour: 14,
        clientY,
        cellTop: 90,
        cellHeight: 100,
      }),
    ).toEqual({ studioDate: "2026-08-13", studioStartMin: expected });
  });

  it("falls back to the start of the hour before layout has a measurable height", () => {
    expect(
      calendarSlotFromPointer({
        dayMarker: new Date("2026-08-13T00:00:00.000Z"),
        hour: 14,
        clientY: 120,
        cellTop: 90,
        cellHeight: 0,
      }),
    ).toEqual({ studioDate: "2026-08-13", studioStartMin: 14 * 60 });
  });
});
