// @vitest-environment jsdom

import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomePullToRefresh } from "../home-pull-to-refresh";

const mocks = vi.hoisted(() => ({
  pathname: "/artist",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

function Harness({
  homePath = "/artist",
  enabled = true,
}: {
  homePath?: "/artist" | "/dashboard";
  enabled?: boolean;
}) {
  return (
    <main data-testid="scroll-surface">
      <HomePullToRefresh homePath={homePath} enabled={enabled} />
      <div>Home content</div>
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

afterEach(cleanup);

beforeEach(() => {
  mocks.pathname = "/artist";
  mocks.refresh.mockReset();
});

describe("HomePullToRefresh", () => {
  it.each([
    ["Artist Home", "/artist", "/artist"],
    ["Producer Home", "/dashboard", "/dashboard"],
  ] as const)(
    "refreshes %s after a downward pull that starts at the top",
    (_, pathname, homePath) => {
      mocks.pathname = pathname;
      render(<Harness homePath={homePath} />);
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

      const pullSurface = screen.getByTestId("home-pull-to-refresh");
      expect(downwardMove.defaultPrevented).toBe(true);
      expect(pullSurface.getAttribute("data-state")).toBe("ready");
      expect(pullSurface.style.height).toBe("52px");

      fireEvent.touchEnd(surface, {
        changedTouches: [{ clientX: 43, clientY: 164 }],
      });

      expect(mocks.refresh).toHaveBeenCalledOnce();
    },
  );

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
    expect(screen.getByTestId("home-pull-to-refresh").style.height).toBe("32.5px");

    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 130 }],
    });

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("home-pull-to-refresh").style.height).toBe("0px");
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

  it("keeps the page elastic away from Home without refreshing it", () => {
    mocks.pathname = "/artist/sessions";
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

    const pullSurface = screen.getByTestId("home-pull-to-refresh");
    expect(downwardMove.defaultPrevented).toBe(true);
    expect(pullSurface.getAttribute("data-home-refresh")).toBe("false");
    expect(pullSurface.style.height).toBe("52px");

    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 180 }],
    });

    expect(pullSurface.style.height).toBe("0px");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not install on focused flows that own a nested scroll surface", () => {
    render(<Harness enabled={false} />);

    expect(screen.queryByTestId("home-pull-to-refresh")).toBeNull();
  });
});
