// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CalendarSwipeSurface } from "../calendar-swipe-surface";
import { useManualSessionLauncher } from "../manual-session-launcher-context";

const routerPush = vi.hoisted(() => vi.fn());
const manualOptions = { studioTimeZone: "UTC", clients: [] } as const;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(
    type: string,
    init: MouseEventInit & {
      pointerId?: number;
      pointerType?: string;
      isPrimary?: boolean;
    } = {},
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "";
    this.isPrimary = init.isPrimary ?? false;
  }
}

beforeAll(() => {
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: TestPointerEvent,
  });
});

afterEach(() => {
  cleanup();
  routerPush.mockReset();
});

describe("CalendarSwipeSurface", () => {
  it("keeps the visible New session fallback and opens at the first missing step", () => {
    render(
      <CalendarSwipeSurface
        active="sessions"
        eyebrows={{
          schedule: "THIS WEEK",
          sessions: "2 SESSIONS",
          availability: "8H OPEN PER WEEK",
        }}
        scheduleEyebrow="THIS WEEK"
        sessionsContent={<p>Sessions content</p>}
        availabilityContent={<p>Availability content</p>}
        manualOptions={manualOptions}
      />,
    );

    const [newSessionButton] = screen.getAllByRole("button", { name: "New session" });
    expect(newSessionButton).toBeDefined();
    if (!newSessionButton) return;
    fireEvent.click(newSessionButton);

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Book a session" })).not.toBeNull();
    expect(screen.getByRole("listbox", { name: "Client" })).not.toBeNull();
    expect(screen.getByText("No clients available")).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Date" })).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Start" })).toBeNull();
  });

  it("preserves a double-clicked calendar slot while the progressive drawer starts with Client", () => {
    render(
      <CalendarSwipeSurface
        active="sessions"
        eyebrows={{
          schedule: "THIS WEEK",
          sessions: "2 SESSIONS",
          availability: "8H OPEN PER WEEK",
        }}
        scheduleEyebrow="THIS WEEK"
        sessionsContent={<CalendarSlotShortcut />}
        availabilityContent={<p>Availability content</p>}
        manualOptions={manualOptions}
      />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: "Open calendar slot" }));

    expect(screen.getByRole("listbox", { name: "Client" })).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Date" })).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Start" })).toBeNull();
    expect(screen.getByLabelText("Provisional slot").textContent).toBe("2026-08-13/870/pending");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("Provisional slot").textContent).toBe("none");
  });

  it("shows a plain reduced-protection warning without exposing provider details", () => {
    const { rerender } = render(
      <CalendarSwipeSurface
        active="sessions"
        eyebrows={{
          schedule: "THIS WEEK",
          sessions: "2 SESSIONS",
          availability: "8H OPEN PER WEEK",
        }}
        scheduleEyebrow="THIS WEEK"
        sessionsContent={<p>Sessions content</p>}
        availabilityContent={<p>Availability content</p>}
        manualOptions={manualOptions}
        googleBusyProtectionReduced
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("Google busy-time check is limited");
    expect(screen.getByRole("status").textContent).toContain(
      "Booking stays open using your Skitza availability.",
    );
    expect(screen.getByRole("status").textContent).not.toMatch(/token|calendar id|provider|error/i);

    rerender(
      <CalendarSwipeSurface
        active="sessions"
        eyebrows={{
          schedule: "THIS WEEK",
          sessions: "2 SESSIONS",
          availability: "8H OPEN PER WEEK",
        }}
        scheduleEyebrow="THIS WEEK"
        sessionsContent={<p>Sessions content</p>}
        availabilityContent={<p>Availability content</p>}
        manualOptions={manualOptions}
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the same warning when the live visible-week check reports reduced protection", () => {
    render(
      <CalendarSwipeSurface
        active="sessions"
        eyebrows={{
          schedule: "THIS WEEK",
          sessions: "2 SESSIONS",
          availability: "8H OPEN PER WEEK",
        }}
        scheduleEyebrow="THIS WEEK"
        sessionsContent={<GoogleProtectionShortcut />}
        availabilityContent={<p>Availability content</p>}
        manualOptions={manualOptions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report reduced protection" }));

    expect(screen.getByRole("status").textContent).toContain("Google busy-time check is limited");
  });

  it("shows the adjacent destination immediately and does not freeze while server navigation resolves", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <CalendarSwipeSurface
        active="sessions"
        eyebrows={{
          schedule: "THIS WEEK",
          sessions: "2 SESSIONS",
          availability: "8H OPEN PER WEEK",
        }}
        scheduleEyebrow="THIS WEEK"
        sessionsContent={<p>Sessions content</p>}
        availabilityContent={<p>Availability content</p>}
        manualOptions={manualOptions}
        googleCalendarControl={<button type="button">Google calendar control</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Google calendar control" })).not.toBeNull();
    const surface = screen.getByRole("tabpanel");
    const track = surface.parentElement;
    expect(track?.getAttribute("data-calendar-swipe-active")).toBe("sessions");
    expect(track?.hasAttribute("data-tab-swipe-panel")).toBe(true);
    expect(
      screen
        .getByText("Availability content")
        .closest("[role='tabpanel']")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    const inactiveAvailabilityPanel = screen
      .getByText("Availability content")
      .closest("[role='tabpanel']");
    expect(inactiveAvailabilityPanel?.className).toContain("absolute inset-0 overflow-hidden");
    expect(inactiveAvailabilityPanel?.className).not.toContain("min-h-full");
    expect(
      screen.getByText("Sessions content").closest("[role='tabpanel']")?.className,
    ).not.toContain("overflow-hidden");

    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 120,
      clientY: 20,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 40,
      clientY: 22,
    });

    expect(track?.getAttribute("data-tab-swipe-state")).toBe("dragging");
    expect(track?.style.getPropertyValue("--sk-tab-swipe-x")).toBe("-80px");

    fireEvent.pointerUp(surface, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 40,
      clientY: 22,
    });

    expect(routerPush).toHaveBeenCalledOnce();
    expect(routerPush).toHaveBeenCalledWith("/dashboard/calendar?tab=availability", {
      scroll: false,
    });

    expect(track?.getAttribute("data-calendar-swipe-active")).toBe("availability");
    expect(screen.getByRole("tabpanel").textContent).toContain("Availability content");
    expect(
      screen
        .getByText("Sessions content")
        .closest("[role='tabpanel']")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    const inactiveSessionsPanel = screen.getByText("Sessions content").closest("[role='tabpanel']");
    expect(inactiveSessionsPanel?.className).toContain("absolute inset-0 overflow-hidden");
    expect(inactiveSessionsPanel?.className).not.toContain("min-h-full");
    expect(
      screen.getByText("Availability content").closest("[role='tabpanel']")?.className,
    ).not.toContain("overflow-hidden");

    // The destination remains selected after the old 190ms cleanup window,
    // even though the server-owned `active` prop has not resolved yet.
    vi.advanceTimersByTime(250);
    expect(track?.getAttribute("data-calendar-swipe-active")).toBe("availability");
    expect(screen.getByRole("tabpanel").textContent).toContain("Availability content");

    rerender(
      <CalendarSwipeSurface
        active="availability"
        eyebrows={{
          schedule: "THIS WEEK",
          sessions: "2 SESSIONS",
          availability: "8H OPEN PER WEEK",
        }}
        scheduleEyebrow="THIS WEEK"
        sessionsContent={<p>Sessions content</p>}
        availabilityContent={<p>Availability content</p>}
        manualOptions={manualOptions}
        googleCalendarControl={<button type="button">Google calendar control</button>}
      />,
    );

    expect(screen.getByRole("tabpanel").textContent).toContain("Availability content");
    expect(screen.getByText("8H OPEN PER WEEK").textContent).toBe("8H OPEN PER WEEK");
  });
});

function CalendarSlotShortcut() {
  const { openManualSession, provisionalSlot } = useManualSessionLauncher();

  return (
    <div>
      <button
        type="button"
        onDoubleClick={() => {
          openManualSession({ studioDate: "2026-08-13", studioStartMin: 14 * 60 + 30 });
        }}
      >
        Open calendar slot
      </button>
      <output aria-label="Provisional slot">
        {provisionalSlot
          ? `${provisionalSlot.studioDate}/${String(provisionalSlot.studioStartMin)}/${
              provisionalSlot.durationMin === null ? "pending" : String(provisionalSlot.durationMin)
            }`
          : "none"}
      </output>
    </div>
  );
}

function GoogleProtectionShortcut() {
  const { reportGoogleBusyProtection } = useManualSessionLauncher();

  return (
    <button
      type="button"
      onClick={() => {
        reportGoogleBusyProtection(true);
      }}
    >
      Report reduced protection
    </button>
  );
}
