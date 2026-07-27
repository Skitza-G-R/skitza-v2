// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import {
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

afterEach(cleanup);

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

function Harness({ onButtonClick = () => undefined }: { onButtonClick?: () => void }) {
  const [value, setValue] = useState<(typeof ITEMS)[number]>("first");
  const swipeHandlers = useTabSwipe({
    items: ITEMS,
    value,
    onChange: setValue,
  });

  return (
    <div data-testid="surface" data-tab-swipe-surface {...swipeHandlers}>
      <output data-testid="value">{value}</output>
      <button type="button" onClick={onButtonClick}>
        Row action
      </button>
      <input aria-label="Search" />
      <div role="slider" aria-label="Waveform" />
      <div data-tab-swipe-ignore data-testid="ignored-area" />
      <div data-tab-swipe-surface data-testid="nested-surface" />
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
});
