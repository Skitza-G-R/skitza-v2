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
      onCancel={vi.fn()}
      onReschedule={vi.fn()}
    />,
  );
}

describe("SessionRow actions", () => {
  it("renders the action row only while a real action exists", () => {
    expect(renderRow(baseSession)).toContain('aria-label="Cancel session"');
    expect(renderRow(baseSession)).toContain('aria-label="Reschedule session"');

    const canceled = renderRow({ ...baseSession, status: "cancelled" });
    expect(canceled).not.toContain('aria-label="Cancel session"');
    expect(canceled).not.toContain('aria-label="Reschedule session"');
    expect(canceled).not.toContain("col-span-2 flex items-center justify-end");
  });
});
