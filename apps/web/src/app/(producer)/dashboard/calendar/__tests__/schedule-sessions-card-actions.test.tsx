import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScheduleSessionsCard } from "../schedule-sessions-card";
import type { SessionListItem } from "../session-row";

const session: SessionListItem = {
  id: "session-1",
  artistName: "Lior Tansky",
  artistEmail: "lior@example.com",
  startsAt: "2026-07-24T09:00:00.000Z",
  durationMin: 60,
  packageName: "Vocal recording",
  status: "confirmed",
};

function renderCard(item: SessionListItem): string {
  return renderToStaticMarkup(
    <ScheduleSessionsCard
      sessions={[item]}
      initialNow="2026-07-22T09:00:00.000Z"
      timeZone="Asia/Jerusalem"
    />,
  );
}

describe("ScheduleSessionsCard actions", () => {
  it("offers the real reschedule and cancellation actions for an active desktop session", () => {
    const html = renderCard(session);

    expect(html).toContain('aria-label="Cancel session with Lior Tansky"');
    expect(html).toContain('aria-label="Reschedule session with Lior Tansky"');
    expect(html).not.toMatch(/Send reminder/);
  });

  it("does not offer cancellation after a session is closed", () => {
    expect(renderCard({ ...session, status: "cancelled" })).not.toContain(
      'aria-label="Cancel session with Lior Tansky"',
    );
    expect(renderCard({ ...session, status: "cancelled" })).not.toContain(
      'aria-label="Reschedule session with Lior Tansky"',
    );
  });
});
