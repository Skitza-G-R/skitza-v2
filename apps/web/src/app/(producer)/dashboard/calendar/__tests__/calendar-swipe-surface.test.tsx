// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CalendarSwipeSurface } from "../calendar-swipe-surface";

const routerPush = vi.hoisted(() => vi.fn());

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
  it("navigates immediately and preserves the moving panel when server content resolves", () => {
    const { rerender } = render(
      <CalendarSwipeSurface active="sessions">
        <p>Sessions content</p>
      </CalendarSwipeSurface>,
    );
    const surface = screen.getByRole("tabpanel");
    const panel = surface.querySelector<HTMLElement>("[data-tab-swipe-panel]");
    expect(panel).not.toBeNull();

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

    expect(panel?.getAttribute("data-tab-swipe-state")).toBe("dragging");

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

    rerender(
      <CalendarSwipeSurface active="availability">
        <p>Availability content</p>
      </CalendarSwipeSurface>,
    );

    const resolvedSurface = screen.getByRole("tabpanel");
    const resolvedPanel = resolvedSurface.querySelector<HTMLElement>("[data-tab-swipe-panel]");
    expect(resolvedPanel).toBe(panel);
    expect(resolvedPanel?.textContent).toContain("Availability content");
    expect(resolvedPanel?.getAttribute("data-tab-swipe-state")).toBe("settling");
  });
});
