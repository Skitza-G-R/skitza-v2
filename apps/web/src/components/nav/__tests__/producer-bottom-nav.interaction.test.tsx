// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ProducerBottomNav } from "../producer-bottom-nav";

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

let nextFrameId = 0;
let animationFrames = new Map<number, FrameRequestCallback>();

function flushAnimationFrames(): void {
  const queued = [...animationFrames.entries()];
  animationFrames.clear();
  for (const [, callback] of queued) callback(performance.now());
}

function dispatchPointer(
  target: Element,
  type: "pointercancel" | "pointerdown" | "pointermove" | "pointerup",
  {
    clientX,
    clientY,
    pointerId,
  }: {
    clientX: number;
    clientY: number;
    pointerId: number;
  },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
  });
  fireEvent(target, event);
}

beforeEach(() => {
  mocks.pathname = "/dashboard";
  nextFrameId = 0;
  animationFrames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    nextFrameId += 1;
    animationFrames.set(nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    animationFrames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProducerBottomNav finger-following glass", () => {
  it("tracks the finger through CSS variables and settles back to the active tab", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];
    expect(tabs).toHaveLength(5);

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 94),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(nav.dataset.lensReady).toBe("true");
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("175px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-y")).toBe("34px");

    dispatchPointer(nav, "pointerdown", {
      pointerId: 7,
      clientX: 55,
      clientY: 730,
    });

    expect(nav.dataset.interacting).toBe("true");
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("35px");
    expect(tabs[0]?.style.getPropertyValue("--sk-nav-proximity")).toBe("1.000");

    dispatchPointer(nav, "pointermove", {
      pointerId: 7,
      clientX: 265,
      clientY: 730,
    });
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("35px");

    act(() => {
      flushAnimationFrames();
    });
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("245px");
    expect(tabs[3]?.style.getPropertyValue("--sk-nav-proximity")).toBe("1.000");
    expect(Number(tabs[2]?.style.getPropertyValue("--sk-nav-proximity"))).toBeGreaterThan(0);

    dispatchPointer(nav, "pointerup", {
      pointerId: 7,
      clientX: 265,
      clientY: 730,
    });
    expect(nav.dataset.interacting).toBe("false");
    expect(tabs.every((tab) => tab.style.getPropertyValue("--sk-nav-proximity") === "0")).toBe(
      true,
    );

    act(() => {
      flushAnimationFrames();
    });
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("175px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-y")).toBe("34px");
  });

  it("cancels a queued move cleanly when vertical scrolling takes over", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(12, 700, 336, 94),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(12 + index * 67.2, 700, 67.2, 68),
      });
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    dispatchPointer(nav, "pointerdown", {
      pointerId: 11,
      clientX: 45,
      clientY: 730,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 11,
      clientX: 310,
      clientY: 730,
    });
    dispatchPointer(nav, "pointercancel", {
      pointerId: 11,
      clientX: 310,
      clientY: 730,
    });

    expect(nav.dataset.interacting).toBe("false");
    expect(tabs.every((tab) => tab.style.getPropertyValue("--sk-nav-proximity") === "0")).toBe(
      true,
    );

    act(() => {
      flushAnimationFrames();
    });

    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("168px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-y")).toBe("34px");
  });

  it("responds to physical tab positions when the document is right-to-left", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];
    const magnifiedTabs = [
      ...nav.querySelectorAll<HTMLElement>("[data-producer-nav-magnified-tab]"),
    ];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 94),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + (4 - index) * 70, 700, 70, 68),
      });
    });

    dispatchPointer(nav, "pointerdown", {
      pointerId: 13,
      clientX: 55,
      clientY: 730,
    });

    expect(tabs[4]?.style.getPropertyValue("--sk-nav-proximity")).toBe("1.000");
    expect(tabs[0]?.style.getPropertyValue("--sk-nav-proximity")).toBe("0.000");
    expect(magnifiedTabs[4]?.style.getPropertyValue("--sk-nav-proximity")).toBe("1.000");
  });

  it("settles a tap toward its destination instead of bouncing to the old active tab", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 94),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const paymentTab = tabs[4];
    expect(paymentTab).toBeDefined();
    if (!paymentTab) throw new Error("Expected the Payments tab");

    dispatchPointer(paymentTab, "pointerdown", {
      pointerId: 17,
      clientX: 335,
      clientY: 730,
    });
    dispatchPointer(paymentTab, "pointerup", {
      pointerId: 17,
      clientX: 335,
      clientY: 730,
    });

    act(() => {
      flushAnimationFrames();
    });

    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("315px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-y")).toBe("34px");
  });

  it("does not treat a drag that returns to its start as a tap", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 94),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const paymentTab = tabs[4];
    expect(paymentTab).toBeDefined();
    if (!paymentTab) throw new Error("Expected the Payments tab");

    dispatchPointer(paymentTab, "pointerdown", {
      pointerId: 19,
      clientX: 335,
      clientY: 730,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 19,
      clientX: 55,
      clientY: 730,
    });
    dispatchPointer(paymentTab, "pointerup", {
      pointerId: 19,
      clientX: 335,
      clientY: 730,
    });

    act(() => {
      flushAnimationFrames();
    });

    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("175px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-y")).toBe("34px");
  });

  it("keeps a rapid second touch from being overwritten by the previous settle frame", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 94),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const musicTab = tabs[0];
    const paymentTab = tabs[4];
    expect(musicTab).toBeDefined();
    expect(paymentTab).toBeDefined();
    if (!musicTab || !paymentTab) throw new Error("Expected Music and Payments tabs");

    dispatchPointer(paymentTab, "pointerdown", {
      pointerId: 23,
      clientX: 335,
      clientY: 730,
    });
    dispatchPointer(paymentTab, "pointerup", {
      pointerId: 23,
      clientX: 335,
      clientY: 730,
    });
    dispatchPointer(musicTab, "pointerdown", {
      pointerId: 29,
      clientX: 55,
      clientY: 730,
    });

    act(() => {
      flushAnimationFrames();
    });

    expect(nav.dataset.interacting).toBe("true");
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("35px");
  });
});
