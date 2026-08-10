import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SessionRow, type SessionListItem } from "../session-row";

const baseSession: SessionListItem = {
  id: "session-1",
  artistName: "Lior Tansky",
  artistEmail: "lior@example.com",
  startsAt: "2026-07-24T09:00:00.000Z",
  durationMin: 60,
  packageName: "Vocal recording",
  status: "confirmed",
};

function renderRow(session: SessionListItem): string {
  return renderToStaticMarkup(
    <SessionRow
      session={session}
      now={new Date("2026-07-22T09:00:00.000Z")}
      timeZone="Asia/Jerusalem"
      onManage={vi.fn()}
    />,
  );
}

describe("SessionRow actions", () => {
  it("uses one Manage action instead of separate cancel and reschedule controls", () => {
    const active = renderRow(baseSession);
    expect(active).toContain('aria-label="Manage session"');
    expect(active).not.toContain('aria-label="Cancel session"');
    expect(active).not.toContain('aria-label="Reschedule session"');

    const canceled = renderRow({ ...baseSession, status: "cancelled" });
    expect(canceled).toContain('aria-label="Manage session"');
    expect(canceled).not.toContain('aria-label="Cancel session"');
    expect(canceled).not.toContain('aria-label="Reschedule session"');
  });
});
