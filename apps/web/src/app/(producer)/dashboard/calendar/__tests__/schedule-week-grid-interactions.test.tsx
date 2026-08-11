// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import type { ManualSessionSlot } from "../calendar-slot";
import { buildWeek } from "../calendar-week";
import { ManualSessionLauncherProvider } from "../manual-session-launcher-context";
import { ScheduleWeekGrid, type ScheduleSession } from "../schedule-week-grid";

const REFERENCE = new Date("2026-08-13T12:00:00.000Z");
const WEEK = buildWeek(REFERENCE, 0, "UTC");
const AVAILABILITY = [{ startMin: 14 * 60, endMin: 17 * 60 }] as const;

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: TestResizeObserver,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderGrid({
  sessions = [],
  openManualSession = vi.fn<(slot: ManualSessionSlot | null) => void>(),
  onManageSession = vi.fn<(sessionId: string) => void>(),
  provisionalSlot = null,
  googleBusyWeek = null,
}: {
  sessions?: readonly ScheduleSession[];
  openManualSession?: Mock<(slot: ManualSessionSlot | null) => void>;
  onManageSession?: Mock<(sessionId: string) => void>;
  provisionalSlot?: {
    studioDate: string;
    studioStartMin: number;
    durationMin: number | null;
  } | null;
  googleBusyWeek?: {
    protection: "google_aware" | "skitza_only";
    health: "healthy" | "not_connected" | "reconnect_required" | "unavailable";
    intervals: readonly { startsAt: string; endsAt: string }[];
  } | null;
} = {}) {
  const rendered = render(
    <ManualSessionLauncherProvider
      openManualSession={openManualSession}
      provisionalSlot={provisionalSlot}
    >
      <ScheduleWeekGrid
        week={WEEK}
        sessions={sessions}
        availabilityBlocks={AVAILABILITY}
        todayIdx={4}
        showNowLine={false}
        initialNow={REFERENCE.toISOString()}
        timeZone="UTC"
        googleBusyWeek={googleBusyWeek}
        onManageSession={onManageSession}
      />
    </ManualSessionLauncherProvider>,
  );

  return { ...rendered, openManualSession, onManageSession };
}

describe("ScheduleWeekGrid calendar interactions", () => {
  it("opens manual booking at the double-clicked 15-minute slot and ignores single clicks", () => {
    const { container, openManualSession } = renderGrid();
    const cell = container.querySelector<HTMLElement>(
      '[data-calendar-date="2026-08-13"][data-calendar-hour="14"]',
    );
    expect(cell).not.toBeNull();
    if (!cell) return;

    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 80,
      bottom: 180,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.click(cell, { clientY: 140 });
    expect(openManualSession).not.toHaveBeenCalled();

    fireEvent.doubleClick(cell, { clientY: 140 });
    expect(openManualSession).toHaveBeenCalledWith({
      studioDate: "2026-08-13",
      studioStartMin: 14 * 60 + 30,
    });
  });

  it("keeps empty desktop cells visually unchanged on hover", () => {
    const { container } = renderGrid();
    const cell = container.querySelector<HTMLElement>(
      '[data-calendar-date="2026-08-13"][data-calendar-hour="14"]',
    );
    expect(cell).not.toBeNull();
    if (!cell) return;

    fireEvent.mouseMove(cell, { clientY: 140 });
    expect(cell.className).not.toContain("cursor-pointer");
    expect(container.querySelector("[data-calendar-hover-slot]")).toBeNull();
    expect(container.querySelector("[data-calendar-hover-hint]")).toBeNull();
  });

  it("routes confirmed session double-clicks to Manage without opening the empty slot", () => {
    const { openManualSession, onManageSession } = renderGrid({
      sessions: [
        {
          id: "confirmed-session",
          startsAt: "2026-08-13T14:00:00.000Z",
          durationMin: 120,
          artistName: "Lior Tansky",
          artistEmail: "lior@example.com",
          packageName: "Full production",
          status: "confirmed",
        },
      ],
    });

    const sessionBlock = screen.getByRole("group", {
      name: "Full production with Lior Tansky, 14:00–16:00, confirmed",
    });
    expect(sessionBlock.className).toContain("z-[2]");
    expect(sessionBlock.className).not.toContain("cursor-pointer");
    expect(sessionBlock.className).not.toContain("hover:-translate-y-0.5");
    expect(sessionBlock.title).toContain("Double-click to manage");
    fireEvent.doubleClick(sessionBlock);

    expect(onManageSession).toHaveBeenCalledWith("confirmed-session");
    expect(openManualSession).not.toHaveBeenCalled();
  });

  it("opens Manage for a pending session when the panel marks it manageable", () => {
    const { openManualSession, onManageSession } = renderGrid({
      sessions: [
        {
          id: "pending-session",
          startsAt: "2026-08-13T14:00:00.000Z",
          durationMin: 60,
          artistName: "Lior Tansky",
          artistEmail: "lior@example.com",
          packageName: "Vocal recording",
          status: "pending_approval",
          canManage: true,
        },
      ],
    });

    const pendingBlock = screen.getByRole("group", {
      name: "Vocal recording with Lior Tansky, 14:00–15:00, pending",
    });
    expect(pendingBlock.className).not.toContain("cursor-pointer");
    fireEvent.doubleClick(pendingBlock);

    expect(onManageSession).toHaveBeenCalledWith("pending-session");
    expect(openManualSession).not.toHaveBeenCalled();
  });

  it("does not advertise or open Manage when the caller marks a session non-manageable", () => {
    const { onManageSession } = renderGrid({
      sessions: [
        {
          id: "change-request-session",
          startsAt: "2026-08-13T14:00:00.000Z",
          durationMin: 60,
          artistName: "Lior Tansky",
          artistEmail: "lior@example.com",
          packageName: "Vocal recording",
          status: "confirmed",
          canManage: false,
        },
      ],
    });

    const sessionBlock = screen.getByRole("group", {
      name: "Vocal recording with Lior Tansky, 14:00–15:00, confirmed",
    });
    expect(sessionBlock.title).not.toContain("Double-click");

    fireEvent.doubleClick(sessionBlock);
    expect(onManageSession).not.toHaveBeenCalled();
  });

  it("renders Google busy time as a privacy-safe blocked band and prevents booking it", () => {
    const { container, openManualSession } = renderGrid({
      googleBusyWeek: {
        protection: "google_aware",
        health: "healthy",
        intervals: [
          {
            startsAt: "2026-08-13T14:15:00.000Z",
            endsAt: "2026-08-13T15:00:00.000Z",
          },
        ],
      },
    });
    const cell = container.querySelector<HTMLElement>(
      '[data-calendar-date="2026-08-13"][data-calendar-hour="14"]',
    );
    expect(cell).not.toBeNull();
    if (!cell) return;

    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 80,
      bottom: 180,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    const band = screen.getByRole("img", {
      name: "Google Calendar busy, 14:15 to 15:00",
    });
    expect(band.textContent).toContain("Blocked");
    expect(band.className).toContain("text-center");

    fireEvent.doubleClick(cell, { clientY: 130 });
    expect(openManualSession).not.toHaveBeenCalled();

    fireEvent.doubleClick(cell, { clientY: 110 });
    expect(openManualSession).toHaveBeenCalledWith({
      studioDate: "2026-08-13",
      studioStartMin: 14 * 60,
    });
  });

  it("renders the live provisional session as a non-interactive dashed block", () => {
    const { container } = renderGrid({
      provisionalSlot: {
        studioDate: "2026-08-13",
        studioStartMin: 14 * 60 + 30,
        durationMin: 240,
      },
    });

    const preview = container.querySelector<HTMLElement>("[data-provisional-session]");
    expect(preview).not.toBeNull();
    expect(preview?.className).toContain("pointer-events-none");
    expect(preview?.className).toContain("border-dashed");
    expect(preview?.style.top).toContain("0.5");
    expect(preview?.style.height).toContain("4");
    expect(preview?.textContent).toContain("14:30–18:30");
  });
});
