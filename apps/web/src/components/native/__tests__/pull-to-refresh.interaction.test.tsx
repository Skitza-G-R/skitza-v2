// @vitest-environment jsdom

import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PullToRefresh } from "../pull-to-refresh";
import type { PullToRefreshShell } from "../refreshable-path";

const mocks = vi.hoisted(() => ({
  pathname: "/artist",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

function Harness({
  shell = "artist",
  enabled = true,
}: {
  shell?: PullToRefreshShell;
  enabled?: boolean;
}) {
  return (
    <main data-testid="scroll-surface">
      <PullToRefresh shell={shell} enabled={enabled} />
      <div>Home content</div>
      <div data-testid="nested-scroller" style={{ overflowY: "auto" }}>
        Sessions list
      </div>
    </main>
  );
}

function setScrollTop(element: HTMLElement, value: number) {
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value,
  });
}

function makeScrollable(element: HTMLElement) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 900 });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: 300 });
}

afterEach(cleanup);

beforeEach(() => {
  mocks.pathname = "/artist";
  mocks.refresh.mockReset();
});

describe("PullToRefresh", () => {
  it.each([
    ["Artist Home", "/artist", "artist"],
    ["Artist Music", "/artist/music", "artist"],
    ["Artist Sessions", "/artist/sessions", "artist"],
    ["Artist Payments", "/artist/payments", "artist"],
    ["Artist Store", "/artist/store", "artist"],
    ["Producer Home", "/dashboard", "producer"],
    ["Producer Music", "/dashboard/music", "producer"],
    ["Producer Clients", "/dashboard/clients-projects", "producer"],
    ["Producer Calendar", "/dashboard/calendar", "producer"],
    ["Producer Store", "/dashboard/store", "producer"],
    ["Producer Payments", "/dashboard/payments", "producer"],
    ["Producer Requests", "/dashboard/requests", "producer"],
  ] as const)("refreshes %s after a downward pull that starts at the top", (_, pathname, shell) => {
    mocks.pathname = pathname;
    render(<Harness shell={shell} />);
    const surface = screen.getByTestId("scroll-surface");
    setScrollTop(surface, 0);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    const downwardMove = createEvent.touchMove(surface, {
      touches: [{ clientX: 43, clientY: 164 }],
      cancelable: true,
    });
    fireEvent(surface, downwardMove);

    const pullSurface = screen.getByTestId("pull-to-refresh");
    expect(downwardMove.defaultPrevented).toBe(true);
    expect(pullSurface.getAttribute("data-state")).toBe("ready");
    expect(pullSurface.style.height).toBe("52px");

    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 43, clientY: 164 }],
    });

    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh before the pull reaches the release threshold", () => {
    render(<Harness />);
    const surface = screen.getByTestId("scroll-surface");
    setScrollTop(surface, 0);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    const downwardMove = createEvent.touchMove(surface, {
      touches: [{ clientX: 40, clientY: 130 }],
      cancelable: true,
    });
    fireEvent(surface, downwardMove);

    expect(downwardMove.defaultPrevented).toBe(true);
    expect(screen.getByTestId("pull-to-refresh").style.height).toBe("32.5px");

    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 130 }],
    });

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("pull-to-refresh").style.height).toBe("0px");
  });

  it("leaves normal scrolling and horizontal gestures untouched", () => {
    render(<Harness />);
    const surface = screen.getByTestId("scroll-surface");
    setScrollTop(surface, 24);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    const inPageMove = createEvent.touchMove(surface, {
      touches: [{ clientX: 40, clientY: 180 }],
      cancelable: true,
    });
    fireEvent(surface, inPageMove);
    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 180 }],
    });

    expect(inPageMove.defaultPrevented).toBe(false);

    setScrollTop(surface, 0);
    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    const horizontalMove = createEvent.touchMove(surface, {
      touches: [{ clientX: 150, clientY: 100 }],
      cancelable: true,
    });
    fireEvent(surface, horizontalMove);
    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 150, clientY: 100 }],
    });

    expect(horizontalMove.defaultPrevented).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps detail pages elastic without refreshing them", () => {
    mocks.pathname = "/artist/sessions/session-1";
    render(<Harness />);
    const surface = screen.getByTestId("scroll-surface");
    setScrollTop(surface, 0);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    const downwardMove = createEvent.touchMove(surface, {
      touches: [{ clientX: 40, clientY: 180 }],
      cancelable: true,
    });
    fireEvent(surface, downwardMove);

    const pullSurface = screen.getByTestId("pull-to-refresh");
    expect(downwardMove.defaultPrevented).toBe(true);
    expect(pullSurface.getAttribute("data-can-refresh")).toBe("false");
    expect(pullSurface.style.height).toBe("52px");

    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 180 }],
    });

    expect(pullSurface.style.height).toBe("0px");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("ignores a pull that starts inside a nested scroller", () => {
    // Calendar's sessions list, week grid, and availability panel each own
    // their own vertical scrolling inside the shell scroller. Scrolling one
    // of them must not reload the page underneath.
    mocks.pathname = "/dashboard/calendar";
    render(<Harness shell="producer" />);
    const surface = screen.getByTestId("scroll-surface");
    const nested = screen.getByTestId("nested-scroller");
    setScrollTop(surface, 0);
    makeScrollable(nested);

    fireEvent.touchStart(nested, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    const downwardMove = createEvent.touchMove(nested, {
      touches: [{ clientX: 40, clientY: 180 }],
      cancelable: true,
    });
    fireEvent(nested, downwardMove);
    fireEvent.touchEnd(nested, {
      changedTouches: [{ clientX: 40, clientY: 180 }],
    });

    expect(downwardMove.defaultPrevented).toBe(false);
    expect(screen.getByTestId("pull-to-refresh").style.height).toBe("0px");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not install on focused flows that own a nested scroll surface", () => {
    render(<Harness enabled={false} />);

    expect(screen.queryByTestId("pull-to-refresh")).toBeNull();
  });
});
