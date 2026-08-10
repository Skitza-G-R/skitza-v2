// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionListItem } from "../session-row";
import { ManualSessionLauncherProvider } from "../manual-session-launcher-context";

const { loadGoogleCalendarBusyWeek } = vi.hoisted(() => ({
  loadGoogleCalendarBusyWeek: vi.fn().mockResolvedValue({
    protection: "google_aware",
    health: "healthy",
    intervals: [
      {
        startsAt: "2026-08-13T14:00:00.000Z",
        endsAt: "2026-08-13T15:00:00.000Z",
      },
    ],
  }),
}));

vi.mock("../google-calendar-actions", () => ({
  loadGoogleCalendarBusyWeek,
}));

vi.mock("../schedule-week-grid", () => ({
  ScheduleWeekGrid: ({
    sessions,
    googleBusyWeek,
    onManageSession,
  }: {
    sessions: readonly { id: string }[];
    googleBusyWeek?: { protection: string } | null;
    onManageSession?: (id: string) => void;
  }) => (
    <div>
      <output data-testid="google-busy-protection">
        {googleBusyWeek?.protection ?? "loading"}
      </output>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          onDoubleClick={() => {
            onManageSession?.(session.id);
          }}
        >
          Grid {session.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../schedule-week-nav", () => ({
  ScheduleWeekNav: ({ onToday, onNext }: { onToday: () => void; onNext: () => void }) => (
    <nav>
      <button type="button" onClick={onToday}>
        Today
      </button>
      <button type="button" onClick={onNext}>
        Next week
      </button>
    </nav>
  ),
}));
vi.mock("../schedule-sessions-card", () => ({ ScheduleSessionsCard: () => null }));
vi.mock("../schedule-pending-card", () => ({ SchedulePendingCard: () => null }));

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

beforeEach(() => {
  loadGoogleCalendarBusyWeek.mockClear();
  loadGoogleCalendarBusyWeek.mockResolvedValue({
    protection: "google_aware",
    health: "healthy",
    intervals: [
      {
        startsAt: "2026-08-13T14:00:00.000Z",
        endsAt: "2026-08-13T15:00:00.000Z",
      },
    ],
  });
});

afterEach(cleanup);

describe("SchedulePanel grid editing", () => {
  it.each([
    {
      label: "confirmed session",
      value: session("confirmed-session", "confirmed"),
    },
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
  ])("opens the unified Manage sheet for a $label", ({ value }) => {
    const openSessionManagement = vi.fn();
    renderPanel([value], openSessionManagement);

    fireEvent.doubleClick(screen.getByRole("button", { name: `Grid ${value.id}` }));

    expect(openSessionManagement).toHaveBeenCalledWith(value);
  });

  it("loads the privacy-safe Google busy view for the visible week", async () => {
    const confirmed = session("confirmed-session", "confirmed");
    renderPanel([confirmed]);

    await waitFor(() => {
      expect(screen.getByTestId("google-busy-protection").textContent).toBe("google_aware");
    });
    expect(loadGoogleCalendarBusyWeek).toHaveBeenCalledWith({ weekStart: "2026-08-09" });
  });

  it("reports reduced live protection to the shared calendar surface", async () => {
    loadGoogleCalendarBusyWeek.mockResolvedValueOnce({
      protection: "skitza_only",
      health: "unavailable",
      intervals: [],
    });
    const reportGoogleBusyProtection = vi.fn();

    renderPanel([], vi.fn(), reportGoogleBusyProtection);

    await waitFor(() => {
      expect(reportGoogleBusyProtection).toHaveBeenCalledWith(true);
    });
  });

  it("does not let a stale week response overwrite a cached current week", async () => {
    renderPanel([]);
    await waitFor(() => {
      expect(screen.getByTestId("google-busy-protection").textContent).toBe("google_aware");
    });

    let resolveNextWeek:
      | ((value: {
          protection: "skitza_only";
          health: "unavailable";
          intervals: readonly [];
        }) => void)
      | undefined;
    loadGoogleCalendarBusyWeek.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNextWeek = resolve;
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByTestId("google-busy-protection").textContent).toBe("loading");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByTestId("google-busy-protection").textContent).toBe("google_aware");

    await act(async () => {
      resolveNextWeek?.({
        protection: "skitza_only",
        health: "unavailable",
        intervals: [],
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("google-busy-protection").textContent).toBe("google_aware");
  });
});

function renderPanel(
  desktopSessions: readonly SessionListItem[],
  openSessionManagement = vi.fn(),
  reportGoogleBusyProtection = vi.fn(),
) {
  render(
    <ManualSessionLauncherProvider
      openSessionManagement={openSessionManagement}
      reportGoogleBusyProtection={reportGoogleBusyProtection}
    >
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
      />
    </ManualSessionLauncherProvider>,
  );
}
