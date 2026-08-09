// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionListItem } from "../session-row";

vi.mock("../schedule-week-grid", () => ({
  ScheduleWeekGrid: ({
    sessions,
    onRescheduleSession,
  }: {
    sessions: readonly { id: string }[];
    onRescheduleSession?: (id: string) => void;
  }) => (
    <div>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          onDoubleClick={() => {
            onRescheduleSession?.(session.id);
          }}
        >
          Grid {session.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../schedule-week-nav", () => ({ ScheduleWeekNav: () => null }));
vi.mock("../schedule-sessions-card", () => ({ ScheduleSessionsCard: () => null }));
vi.mock("../schedule-pending-card", () => ({ SchedulePendingCard: () => null }));
vi.mock("../reschedule-session-modal", () => ({
  RescheduleSessionModal: ({ session }: { session: SessionListItem }) => (
    <div role="dialog">Reschedule {session.id}</div>
  ),
}));

import { SchedulePanel } from "../schedule-panel";

const STARTS_AT = "2026-08-13T14:00:00.000Z";

function session(
  id: string,
  status: SessionListItem["status"],
  changeRequest: SessionListItem["changeRequest"] = null,
): SessionListItem {
  return {
    id,
    artistName: "Lior Tansky",
    artistEmail: "lior@example.com",
    startsAt: STARTS_AT,
    durationMin: 60,
    packageName: "Full production",
    status,
    changeRequest,
  };
}

afterEach(cleanup);

describe("SchedulePanel grid editing", () => {
  it("opens the real reschedule flow for a confirmed session", () => {
    const confirmed = session("confirmed-session", "confirmed");
    renderPanel([confirmed]);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Grid confirmed-session" }));

    expect(screen.getByRole("dialog").textContent).toBe("Reschedule confirmed-session");
  });

  it.each([
    {
      label: "pending session",
      value: session("pending-session", "pending_approval"),
    },
    {
      label: "confirmed session with an open change request",
      value: session("change-request-session", "confirmed", {
        id: "change-1",
        kind: "reschedule",
        proposedStartsAt: "2026-08-14T14:00:00.000Z",
        requestedAt: "2026-08-09T10:00:00.000Z",
      }),
    },
  ])("does not open reschedule for a $label", ({ value }) => {
    renderPanel([value]);

    fireEvent.doubleClick(screen.getByRole("button", { name: `Grid ${value.id}` }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function renderPanel(desktopSessions: readonly SessionListItem[]) {
  render(
    <SchedulePanel
      sessions={desktopSessions
        .filter(
          (item): item is SessionListItem & { status: "pending_approval" | "confirmed" } =>
            item.status === "pending_approval" || item.status === "confirmed",
        )
        .map((item) => ({
          id: item.id,
          artistName: item.artistName,
          artistEmail: item.artistEmail,
          startsAt: item.startsAt,
          durationMin: item.durationMin,
          packageName: item.packageName,
          status: item.status,
        }))}
      desktopSessions={desktopSessions}
      availabilityBlocks={[]}
      pending={[]}
      autoConfirm={false}
      initialNow="2026-08-13T12:00:00.000Z"
      timeZone="UTC"
    />,
  );
}
