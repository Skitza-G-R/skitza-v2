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

function Harness({ homePath = "/artist" }: { homePath?: "/artist" | "/dashboard" }) {
  return (
    <main data-testid="scroll-surface">
      <HomePullToRefresh homePath={homePath} />
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
      fireEvent.touchMove(surface, {
        touches: [{ clientX: 43, clientY: 164 }],
      });

      expect(screen.getByTestId("home-pull-to-refresh").getAttribute("data-state")).toBe("ready");

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
    fireEvent.touchMove(surface, {
      touches: [{ clientX: 40, clientY: 130 }],
    });
    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 130 }],
    });

    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("leaves normal scrolling and horizontal gestures untouched", () => {
    render(<Harness />);
    const surface = screen.getByTestId("scroll-surface");
    setScrollTop(surface, 24);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    fireEvent.touchMove(surface, {
      touches: [{ clientX: 40, clientY: 180 }],
    });
    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 180 }],
    });

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

  it("does not install the gesture away from the configured Home route", () => {
    mocks.pathname = "/artist/sessions";
    render(<Harness />);
    const surface = screen.getByTestId("scroll-surface");
    setScrollTop(surface, 0);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    fireEvent.touchMove(surface, {
      touches: [{ clientX: 40, clientY: 180 }],
    });
    fireEvent.touchEnd(surface, {
      changedTouches: [{ clientX: 40, clientY: 180 }],
    });

    expect(screen.queryByTestId("home-pull-to-refresh")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
