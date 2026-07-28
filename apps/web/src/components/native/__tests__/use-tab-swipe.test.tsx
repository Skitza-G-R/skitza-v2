// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import {
  resolveTabSwipeDragOffset,
  resolveTabSwipeReleaseTargetIndex,
  resolveTabSwipeTargetIndex,
  shouldIgnoreTabSwipeStart,
  useTabSwipe,
} from "../use-tab-swipe";

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("resolveTabSwipeTargetIndex", () => {
  it("moves left to the next tab and right to the previous tab", () => {
    expect(
      resolveTabSwipeTargetIndex({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -80,
        deltaY: 8,
      }),
    ).toBe(2);
    expect(
      resolveTabSwipeTargetIndex({
        activeIndex: 1,
        itemCount: 3,
        deltaX: 80,
        deltaY: 8,
      }),
    ).toBe(0);
  });

  it("ignores short and predominantly vertical gestures", () => {
    expect(
      resolveTabSwipeTargetIndex({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -40,
        deltaY: 2,
      }),
    ).toBeNull();
    expect(
      resolveTabSwipeTargetIndex({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -80,
        deltaY: 72,
      }),
    ).toBeNull();
  });

  it("stays at the first and last tab instead of wrapping", () => {
    expect(
      resolveTabSwipeTargetIndex({
        activeIndex: 0,
        itemCount: 3,
        deltaX: 80,
        deltaY: 0,
      }),
    ).toBeNull();
    expect(
      resolveTabSwipeTargetIndex({
        activeIndex: 2,
        itemCount: 3,
        deltaX: -80,
        deltaY: 0,
      }),
    ).toBeNull();
  });
});

describe("resolveTabSwipeReleaseTargetIndex", () => {
  it("commits by distance or by a short intentional flick", () => {
    expect(
      resolveTabSwipeReleaseTargetIndex({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -64,
        deltaY: 5,
        velocityX: -0.1,
      }),
    ).toBe(2);
    expect(
      resolveTabSwipeReleaseTargetIndex({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -28,
        deltaY: 3,
        velocityX: -0.7,
      }),
    ).toBe(2);
  });

  it("does not commit a reversed flick or cross a boundary", () => {
    expect(
      resolveTabSwipeReleaseTargetIndex({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -28,
        deltaY: 3,
        velocityX: 0.7,
      }),
    ).toBeNull();
    expect(
      resolveTabSwipeReleaseTargetIndex({
        activeIndex: 0,
        itemCount: 3,
        deltaX: 90,
        deltaY: 0,
        velocityX: 0.8,
      }),
    ).toBeNull();
  });
});

describe("resolveTabSwipeDragOffset", () => {
  it("tracks a valid neighbor beyond the commit threshold and rubber-bands at a boundary", () => {
    expect(
      resolveTabSwipeDragOffset({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -96,
      }),
    ).toBe(-80);
    expect(
      resolveTabSwipeDragOffset({
        activeIndex: 1,
        itemCount: 3,
        deltaX: -200,
      }),
    ).toBe(-132);
    expect(
      resolveTabSwipeDragOffset({
        activeIndex: 0,
        itemCount: 3,
        deltaX: 120,
      }),
    ).toBe(24);
  });
});

describe("shouldIgnoreTabSwipeStart", () => {
  it("ignores a portaled target outside the DOM surface", () => {
    const surface = document.createElement("div");
    const portaledTarget = document.createElement("button");
    document.body.append(surface, portaledTarget);

    expect(shouldIgnoreTabSwipeStart(portaledTarget, surface)).toBe(true);

    surface.remove();
    portaledTarget.remove();
  });

  it("leaves a horizontally scrollable child in control of its gesture", () => {
    const surface = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.style.overflowX = "auto";
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 240 },
    });
    surface.append(scroller);
    document.body.append(surface);

    expect(shouldIgnoreTabSwipeStart(scroller, surface)).toBe(true);

    surface.remove();
  });
});

const ITEMS = ["first", "second", "third"] as const;

function Harness({
  initialValue = "first",
  onButtonClick = () => undefined,
  onValueChange = () => undefined,
}: {
  initialValue?: (typeof ITEMS)[number];
  onButtonClick?: () => void;
  onValueChange?: (value: (typeof ITEMS)[number]) => void;
}) {
  const [value, setValue] = useState<(typeof ITEMS)[number]>(initialValue);
  const swipeHandlers = useTabSwipe({
    items: ITEMS,
    value,
    onChange(next) {
      onValueChange(next);
      setValue(next);
    },
  });

  return (
    <div data-testid="surface" data-tab-swipe-surface {...swipeHandlers}>
      <div data-testid="panel" data-tab-swipe-panel>
        <output data-testid="value">{value}</output>
        <button type="button" onClick={onButtonClick}>
          Row action
        </button>
        <input aria-label="Search" />
        <div role="slider" aria-label="Waveform" />
        <div data-tab-swipe-ignore data-testid="ignored-area" />
        <div data-tab-swipe-surface data-testid="nested-surface" />
      </div>
    </div>
  );
}

function swipe(target: Element, fromX: number, toX: number, fromY = 20, toY = 24) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: fromX,
    clientY: fromY,
  });
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: toX,
    clientY: toY,
  });
}

function startSwipe(target: Element, fromX = 120, fromY = 20) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: fromX,
    clientY: fromY,
  });
}

function moveSwipe(target: Element, toX: number, toY = 24) {
  fireEvent.pointerMove(target, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: toX,
    clientY: toY,
  });
}

function endSwipe(target: Element, toX: number, toY = 24) {
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: toX,
    clientY: toY,
  });
}

function dispatchSwipeEventAt(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  timeStamp: number,
) {
  const event = new TestPointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX,
    clientY: 20,
  });
  Object.defineProperty(event, "timeStamp", { configurable: true, value: timeStamp });
  fireEvent(target, event);
}

describe("useTabSwipe", () => {
  it("switches adjacent tabs and suppresses the release click", () => {
    const onButtonClick = vi.fn();
    render(<Harness onButtonClick={onButtonClick} />);

    const button = screen.getByRole("button", { name: "Row action" });
    swipe(button, 120, 30);
    fireEvent.click(button);

    expect(screen.getByTestId("value").textContent).toBe("second");
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  it.each([
    ["an outward boundary swipe", 30, 120],
    ["a short horizontal drag", 120, 90],
  ])("suppresses the release click after %s", (_label, fromX, toX) => {
    const onButtonClick = vi.fn();
    render(<Harness onButtonClick={onButtonClick} />);

    const button = screen.getByRole("button", { name: "Row action" });
    swipe(button, fromX, toX);
    fireEvent.click(button);

    expect(screen.getByTestId("value").textContent).toBe("first");
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  it.each([
    ["form fields", () => screen.getByRole("textbox", { name: "Search" })],
    ["media sliders", () => screen.getByRole("slider", { name: "Waveform" })],
    ["explicit ignored areas", () => screen.getByTestId("ignored-area")],
    ["nested swipe surfaces", () => screen.getByTestId("nested-surface")],
  ])("does not start from %s", (_label, getTarget) => {
    render(<Harness />);

    swipe(getTarget(), 120, 30);

    expect(screen.getByTestId("value").textContent).toBe("first");
  });

  it("ignores mouse drags", () => {
    render(<Harness />);
    const surface = screen.getByTestId("surface");

    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: 120,
      clientY: 20,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: 30,
      clientY: 20,
    });

    expect(screen.getByTestId("value").textContent).toBe("first");
  });

  it("paints horizontal progress before release and settles immediately to the next tab", () => {
    vi.useFakeTimers();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const surface = screen.getByTestId("surface");
    const panel = screen.getByTestId("panel");
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(surface, {
      setPointerCapture,
      releasePointerCapture,
      hasPointerCapture: () => true,
    });

    startSwipe(surface);
    moveSwipe(surface, 56);

    expect(panel.getAttribute("data-tab-swipe-state")).toBe("dragging");
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("-64px");
    expect(screen.getByTestId("value").textContent).toBe("first");
    expect(setPointerCapture).toHaveBeenCalledWith(1);

    endSwipe(surface, 56);

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("second");
    expect(screen.getByTestId("value").textContent).toBe("second");
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(panel.getAttribute("data-tab-swipe-state")).toBe("settling");
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("0px");

    vi.runAllTimers();
    expect(panel.hasAttribute("data-tab-swipe-state")).toBe(false);
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("");
  });

  it("locks to vertical scrolling and never changes its mind later", () => {
    render(<Harness />);
    const surface = screen.getByTestId("surface");
    const panel = screen.getByTestId("panel");

    startSwipe(surface, 120, 20);
    moveSwipe(surface, 112, 64);
    moveSwipe(surface, 20, 68);
    endSwipe(surface, 20, 68);

    expect(screen.getByTestId("value").textContent).toBe("first");
    expect(panel.hasAttribute("data-tab-swipe-state")).toBe(false);
  });

  it("follows a reversal and commits in the final direction", () => {
    const onValueChange = vi.fn();
    render(<Harness initialValue="second" onValueChange={onValueChange} />);
    const surface = screen.getByTestId("surface");
    const panel = screen.getByTestId("panel");

    startSwipe(surface, 120, 20);
    moveSwipe(surface, 35, 22);
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("-74.5px");

    moveSwipe(surface, 195, 22);
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("69.5px");
    endSwipe(surface, 195, 22);

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("first");
    expect(screen.getByTestId("value").textContent).toBe("first");
  });

  it("suppresses a row click after a horizontal drag returns near its start", () => {
    const onButtonClick = vi.fn();
    render(<Harness onButtonClick={onButtonClick} />);
    const surface = screen.getByTestId("surface");
    const button = screen.getByRole("button", { name: "Row action" });

    startSwipe(button, 120, 20);
    moveSwipe(surface, 35, 22);
    moveSwipe(surface, 116, 22);
    endSwipe(surface, 116, 22);
    fireEvent.click(button);

    expect(onButtonClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("value").textContent).toBe("first");
  });

  it("accepts a new gesture immediately while the previous panel is settling", () => {
    vi.useFakeTimers();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const surface = screen.getByTestId("surface");
    const panel = screen.getByTestId("panel");

    swipe(surface, 120, 40);
    expect(screen.getByTestId("value").textContent).toBe("second");
    expect(panel.getAttribute("data-tab-swipe-state")).toBe("settling");

    startSwipe(surface, 120, 20);
    moveSwipe(surface, 40, 22);
    expect(panel.getAttribute("data-tab-swipe-state")).toBe("dragging");
    endSwipe(surface, 40, 22);

    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(onValueChange).toHaveBeenLastCalledWith("third");
    expect(screen.getByTestId("value").textContent).toBe("third");
  });

  it("rubber-bands an outward boundary drag and springs back without navigation", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const surface = screen.getByTestId("surface");
    const panel = screen.getByTestId("panel");

    startSwipe(surface, 40, 20);
    moveSwipe(surface, 160, 20);

    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("24px");

    endSwipe(surface, 160, 20);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("value").textContent).toBe("first");
    expect(panel.getAttribute("data-tab-swipe-state")).toBe("settling");
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("0px");
  });

  it("springs back on pointer cancellation without changing tabs", () => {
    const onValueChange = vi.fn();
    render(<Harness initialValue="second" onValueChange={onValueChange} />);
    const surface = screen.getByTestId("surface");
    const panel = screen.getByTestId("panel");

    startSwipe(surface);
    moveSwipe(surface, 65);
    fireEvent.pointerCancel(surface, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 65,
      clientY: 24,
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("value").textContent).toBe("second");
    expect(panel.getAttribute("data-tab-swipe-state")).toBe("settling");
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("0px");
  });

  it("does not treat a fast move followed by a pause as a release flick", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const surface = screen.getByTestId("surface");

    dispatchSwipeEventAt(surface, "pointerdown", 120, 1_000);
    dispatchSwipeEventAt(surface, "pointermove", 90, 1_020);
    dispatchSwipeEventAt(surface, "pointerup", 90, 1_220);

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("value").textContent).toBe("first");
  });

  it("preserves the last real movement velocity when a short flick releases in place", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const surface = screen.getByTestId("surface");

    dispatchSwipeEventAt(surface, "pointerdown", 120, 1_000);
    dispatchSwipeEventAt(surface, "pointermove", 92, 1_020);
    dispatchSwipeEventAt(surface, "pointerup", 92, 1_025);

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("second");
    expect(screen.getByTestId("value").textContent).toBe("second");
  });

  it("suppresses a release click when pointer capture is unexpectedly lost", () => {
    const onButtonClick = vi.fn();
    render(<Harness onButtonClick={onButtonClick} />);
    const surface = screen.getByTestId("surface");
    const button = screen.getByRole("button", { name: "Row action" });

    startSwipe(button);
    moveSwipe(surface, 50);
    fireEvent.lostPointerCapture(surface, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 50,
      clientY: 24,
    });
    fireEvent.click(button);

    expect(onButtonClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("value").textContent).toBe("first");
  });

  it("keeps functional switching but removes gesture motion for reduced-motion users", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(
        () =>
          ({
            matches: true,
            media: "(prefers-reduced-motion: reduce)",
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as MediaQueryList,
      ),
    });
    render(<Harness />);
    const surface = screen.getByTestId("surface");
    const panel = screen.getByTestId("panel");

    startSwipe(surface);
    moveSwipe(surface, 40);

    expect(panel.hasAttribute("data-tab-swipe-state")).toBe(false);
    expect(panel.style.getPropertyValue("--sk-tab-swipe-x")).toBe("");

    endSwipe(surface, 40);
    expect(screen.getByTestId("value").textContent).toBe("second");
    expect(panel.hasAttribute("data-tab-swipe-state")).toBe(false);
  });
});
