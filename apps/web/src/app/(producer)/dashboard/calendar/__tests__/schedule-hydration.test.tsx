import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { buildWeek } from "../calendar-week";
import { ScheduleWeekGrid } from "../schedule-week-grid";

const ORIGINAL_TZ = process.env.TZ;
const NOW_ISO = "2026-07-15T10:00:00.000Z";
const PRODUCER_TIME_ZONE = "Asia/Jerusalem";

function renderSchedule(processTimeZone: string): string {
  process.env.TZ = processTimeZone;
  const reference = new Date(NOW_ISO);
  const week = buildWeek(reference, 0, PRODUCER_TIME_ZONE);

  return renderToStaticMarkup(
    <ScheduleWeekGrid
      week={week}
      sessions={[
        {
          id: "session-1",
          startsAt: "2026-07-16T15:00:00.000Z",
          durationMin: 120,
          artistName: "Lior Tansky",
          artistEmail: "lior@example.com",
          packageName: "Full production",
          status: "confirmed",
        },
      ]}
      availabilityBlocks={[{ startMin: 10 * 60, endMin: 20 * 60 }]}
      todayIdx={3}
      showNowLine
      initialNow={NOW_ISO}
      timeZone={PRODUCER_TIME_ZONE}
    />,
  );
}

function renderCompactPendingSession(): string {
  const reference = new Date(NOW_ISO);
  const week = buildWeek(reference, 0, PRODUCER_TIME_ZONE);

  return renderToStaticMarkup(
    <ScheduleWeekGrid
      week={week}
      sessions={[
        {
          id: "session-compact",
          startsAt: "2026-07-16T15:00:00.000Z",
          durationMin: 60,
          artistName: "Lior Tansky",
          artistEmail: "lior@example.com",
          packageName: "Vocal recording",
          status: "pending_approval",
        },
      ]}
      availabilityBlocks={[{ startMin: 10 * 60, endMin: 20 * 60 }]}
      todayIdx={3}
      showNowLine={false}
      initialNow={NOW_ISO}
      timeZone={PRODUCER_TIME_ZONE}
    />,
  );
}

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("Schedule hydration", () => {
  it("renders identical HTML in server and browser machine timezones", () => {
    expect(renderSchedule("UTC")).toBe(renderSchedule("Asia/Jerusalem"));
  });

  it("gives compact week blocks their full hidden context", () => {
    const html = renderCompactPendingSession();

    expect(html).toContain('role="group"');
    expect(html).toContain(
      'aria-label="Vocal recording with Lior Tansky, 18:00–19:00, pending"',
    );
  });
});
