import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(new URL("../google-calendar.ts", import.meta.url), "utf8");
const busyStart = routerSource.indexOf("  busyWeek: producerProcedure");
const busyEnd = routerSource.indexOf("\n\n  calendars:", busyStart);
const busyBlock = routerSource.slice(busyStart, busyEnd);

const actionSource = readFileSync(
  new URL(
    "../../../../app/(producer)/dashboard/calendar/google-calendar-actions.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("producer Google Calendar busy-week boundary", () => {
  it("keeps exact-week reads producer scoped and resolves studio timezone on the server", () => {
    expect(busyStart).toBeGreaterThan(-1);
    expect(busyBlock).toContain("busyWeek: producerProcedure.input(busyWeekInput).query");
    expect(busyBlock).toContain("eq(producers.id, ctx.producerId)");
    expect(busyBlock).toContain("producerId: ctx.producerId");
    expect(busyBlock).toContain("googleCalendarBusyWeekWindow({");
    expect(busyBlock).toContain("timeZone: producer.timeZone");
    expect(routerSource).toContain("weekStart: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/u)");
  });

  it("returns only the privacy-safe presenter and keeps action failures fail-open", () => {
    expect(busyBlock).toContain("readGoogleCalendarBusyIntervals({");
    expect(busyBlock).toContain("return presentGoogleCalendarBusyWeek(result)");
    expect(busyBlock).not.toMatch(/calendarId|eventId|summary|description|attendee|location/iu);
    expect(actionSource).toContain("caller.googleCalendar.busyWeek(input)");
    expect(actionSource).toContain('protection: "skitza_only"');
    expect(actionSource).toContain('health: "unavailable"');
  });
});
