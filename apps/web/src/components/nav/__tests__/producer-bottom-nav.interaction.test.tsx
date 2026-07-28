// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: true,
  pathname: "/dashboard",
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => mocks.online,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
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
  type:
    | "lostpointercapture"
    | "pointercancel"
    | "pointerdown"
    | "pointermove"
    | "pointerup",
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
  mocks.online = true;
  mocks.pathname = "/dashboard";
  mocks.toast.mockReset();
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProducerBottomNav finger-following glass", () => {
  it("starts destination navigation while the finger is still down after crossing tabs", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const todayTab = tabs[2];
    const calendarTab = tabs[3];
    const paymentsTab = tabs[4];
    expect(todayTab).toBeDefined();
    expect(calendarTab).toBeDefined();
    expect(paymentsTab).toBeDefined();
    if (!todayTab || !calendarTab || !paymentsTab) {
      throw new Error("Expected the Today, Calendar, and Payments tabs");
    }
    const navigateCalendar = vi.spyOn(calendarTab, "click").mockImplementation(() => undefined);
    const navigatePayments = vi.spyOn(paymentsTab, "click").mockImplementation(() => undefined);

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 5,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 5,
      clientX: 265,
      clientY: 734,
    });

    expect(navigateCalendar).toHaveBeenCalledOnce();
    expect(nav.dataset.interacting).toBe("true");

    dispatchPointer(nav, "pointermove", {
      pointerId: 5,
      clientX: 270,
      clientY: 734,
    });
    expect(navigateCalendar).toHaveBeenCalledOnce();

    dispatchPointer(nav, "pointermove", {
      pointerId: 5,
      clientX: 335,
      clientY: 734,
    });
    expect(navigatePayments).toHaveBeenCalledOnce();
  });

  it("ignores boundary jitter but still navigates on a deliberate stable reverse", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const todayTab = tabs[2];
    const calendarTab = tabs[3];
    expect(todayTab).toBeDefined();
    expect(calendarTab).toBeDefined();
    if (!todayTab || !calendarTab) {
      throw new Error("Expected the Today and Calendar tabs");
    }
    const navigateToday = vi.spyOn(todayTab, "click").mockImplementation(() => undefined);
    const navigateCalendar = vi.spyOn(calendarTab, "click").mockImplementation(() => undefined);

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 31,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 31,
      clientX: 245,
      clientY: 734,
    });
    expect(navigateCalendar).toHaveBeenCalledOnce();

    for (const clientX of [229, 231, 230, 229, 231]) {
      dispatchPointer(nav, "pointermove", {
        pointerId: 31,
        clientX,
        clientY: 734,
      });
    }

    expect(navigateCalendar).toHaveBeenCalledOnce();
    expect(navigateToday).not.toHaveBeenCalled();

    dispatchPointer(nav, "pointermove", {
      pointerId: 31,
      clientX: 218,
      clientY: 734,
    });
    expect(navigateToday).toHaveBeenCalledOnce();
  });

  it("does not switch tabs outside the nav y-band after horizontal intent locks", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const todayTab = tabs[2];
    const calendarTab = tabs[3];
    expect(todayTab).toBeDefined();
    expect(calendarTab).toBeDefined();
    if (!todayTab || !calendarTab) {
      throw new Error("Expected the Today and Calendar tabs");
    }
    const navigateCalendar = vi.spyOn(calendarTab, "click").mockImplementation(() => undefined);

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 37,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 37,
      clientX: 215,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 37,
      clientX: 265,
      clientY: 620,
    });

    expect(navigateCalendar).not.toHaveBeenCalled();

    dispatchPointer(nav, "pointermove", {
      pointerId: 37,
      clientX: 265,
      clientY: 734,
    });
    expect(navigateCalendar).toHaveBeenCalledOnce();
  });

  it("keeps the outer edges of the first and last tabs eligible", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const musicTab = tabs[0];
    const todayTab = tabs[2];
    const paymentsTab = tabs[4];
    expect(musicTab).toBeDefined();
    expect(todayTab).toBeDefined();
    expect(paymentsTab).toBeDefined();
    if (!musicTab || !todayTab || !paymentsTab) {
      throw new Error("Expected the Music, Today, and Payments tabs");
    }
    const navigateMusic = vi.spyOn(musicTab, "click").mockImplementation(() => undefined);
    const navigatePayments = vi.spyOn(paymentsTab, "click").mockImplementation(() => undefined);

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 41,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 41,
      clientX: 369,
      clientY: 734,
    });
    expect(navigatePayments).toHaveBeenCalledOnce();

    dispatchPointer(nav, "pointermove", {
      pointerId: 41,
      clientX: 21,
      clientY: 734,
    });
    expect(navigateMusic).toHaveBeenCalledOnce();
  });

  it("captures only a horizontal drag so its release stays owned by the nav", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];
    const capturePointer = vi.fn();
    Object.defineProperty(nav, "setPointerCapture", {
      value: capturePointer,
    });
    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const todayTab = tabs[2];
    expect(todayTab).toBeDefined();
    if (!todayTab) throw new Error("Expected the Today tab");

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 43,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 43,
      clientX: 199,
      clientY: 780,
    });
    expect(capturePointer).not.toHaveBeenCalled();
    dispatchPointer(nav, "pointerup", {
      pointerId: 43,
      clientX: 199,
      clientY: 780,
    });

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 47,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 47,
      clientX: 215,
      clientY: 734,
    });
    expect(capturePointer).toHaveBeenCalledOnce();
    expect(capturePointer).toHaveBeenCalledWith(47);
  });

  it("ignores descendant capture loss while a transferred touch drag stays active", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];
    Object.defineProperty(nav, "setPointerCapture", {
      value: vi.fn(),
    });
    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const clientsTab = tabs[1];
    const calendarTab = tabs[3];
    const paymentsTab = tabs[4];
    expect(clientsTab).toBeDefined();
    expect(calendarTab).toBeDefined();
    expect(paymentsTab).toBeDefined();
    if (!clientsTab || !calendarTab || !paymentsTab) {
      throw new Error("Expected the Clients, Calendar, and Payments tabs");
    }
    const navigateCalendar = vi.spyOn(calendarTab, "click").mockImplementation(() => undefined);
    const navigatePayments = vi.spyOn(paymentsTab, "click").mockImplementation(() => undefined);

    dispatchPointer(clientsTab, "pointerdown", {
      pointerId: 59,
      clientX: 125,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 59,
      clientX: 265,
      clientY: 734,
    });
    expect(navigateCalendar).toHaveBeenCalledOnce();
    expect(nav.dataset.interacting).toBe("true");

    dispatchPointer(clientsTab, "lostpointercapture", {
      pointerId: 59,
      clientX: 265,
      clientY: 734,
    });
    expect(nav.dataset.interacting).toBe("true");

    dispatchPointer(nav, "pointermove", {
      pointerId: 59,
      clientX: 335,
      clientY: 734,
    });
    expect(navigatePayments).toHaveBeenCalledOnce();

    dispatchPointer(nav, "lostpointercapture", {
      pointerId: 59,
      clientX: 335,
      clientY: 734,
    });
    expect(nav.dataset.interacting).toBe("false");
  });

  it("suppresses a detail-zero physical release click after a live drag", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const clientsTab = tabs[1];
    const calendarTab = tabs[3];
    expect(clientsTab).toBeDefined();
    expect(calendarTab).toBeDefined();
    if (!clientsTab || !calendarTab) {
      throw new Error("Expected the Clients and Calendar tabs");
    }
    vi.spyOn(calendarTab, "click").mockImplementation(() => undefined);

    dispatchPointer(clientsTab, "pointerdown", {
      pointerId: 53,
      clientX: 125,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 53,
      clientX: 265,
      clientY: 734,
    });
    dispatchPointer(nav, "pointerup", {
      pointerId: 53,
      clientX: 265,
      clientY: 734,
    });

    const physicalReleaseWasAllowed = fireEvent(
      clientsTab,
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 0,
      }),
    );
    expect(physicalReleaseWasAllowed).toBe(false);
  });

  it("does not let a cancelled drag swallow the next keyboard-style offline activation", () => {
    mocks.online = false;
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const todayTab = tabs[2];
    const calendarTab = tabs[3];
    expect(todayTab).toBeDefined();
    expect(calendarTab).toBeDefined();
    if (!todayTab || !calendarTab) {
      throw new Error("Expected the Today and Calendar tabs");
    }

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 61,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 61,
      clientX: 215,
      clientY: 734,
    });
    dispatchPointer(nav, "pointercancel", {
      pointerId: 61,
      clientX: 215,
      clientY: 734,
    });

    expect(mocks.toast).not.toHaveBeenCalled();
    fireEvent(
      calendarTab,
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 0,
      }),
    );
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(
      "You’re offline. This screen will stay open until you reconnect.",
      "error",
    );
  });

  it("expires an unused release-click guard before a later keyboard activation", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { rerender } = render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const clientsTab = tabs[1];
    const calendarTab = tabs[3];
    expect(clientsTab).toBeDefined();
    expect(calendarTab).toBeDefined();
    if (!clientsTab || !calendarTab) {
      throw new Error("Expected the Clients and Calendar tabs");
    }
    vi.spyOn(calendarTab, "click").mockImplementation(() => undefined);

    dispatchPointer(clientsTab, "pointerdown", {
      pointerId: 67,
      clientX: 125,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 67,
      clientX: 265,
      clientY: 734,
    });
    dispatchPointer(nav, "pointerup", {
      pointerId: 67,
      clientX: 265,
      clientY: 734,
    });

    now.mockReturnValue(2_000);
    mocks.online = false;
    rerender(<ProducerBottomNav />);
    fireEvent(
      calendarTab,
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 0,
      }),
    );

    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(
      "You’re offline. This screen will stay open until you reconnect.",
      "error",
    );
  });

  it("preserves vertical-scroll intent without switching tabs", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const todayTab = tabs[2];
    expect(todayTab).toBeDefined();
    if (!todayTab) throw new Error("Expected the Today tab");
    const navigations = tabs.map((tab) =>
      vi.spyOn(tab, "click").mockImplementation(() => undefined),
    );

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 6,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 6,
      clientX: 199,
      clientY: 780,
    });

    expect(navigations.every((navigate) => navigate.mock.calls.length === 0)).toBe(true);
  });

  it("keeps the current screen open when an offline drag crosses a tab", () => {
    mocks.online = false;
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });

    const todayTab = tabs[2];
    expect(todayTab).toBeDefined();
    if (!todayTab) throw new Error("Expected the Today tab");
    const initialPath = window.location.pathname;

    dispatchPointer(todayTab, "pointerdown", {
      pointerId: 8,
      clientX: 195,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      pointerId: 8,
      clientX: 265,
      clientY: 734,
    });

    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(
      "You’re offline. This screen will stay open until you reconnect.",
      "error",
    );
    expect(window.location.pathname).toBe(initialPath);
    expect(nav.dataset.interacting).toBe("false");
  });

  it("tracks the finger through CSS variables and settles on the crossed destination", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];
    expect(tabs).toHaveLength(5);

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(20 + index * 70, 700, 70, 68),
      });
    });
    const calendarTab = tabs[3];
    expect(calendarTab).toBeDefined();
    if (!calendarTab) throw new Error("Expected the Calendar tab");
    const navigate = vi.spyOn(calendarTab, "click").mockImplementation(() => undefined);

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
    expect(navigate).toHaveBeenCalledOnce();

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
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("245px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-y")).toBe("34px");
  });

  it("keeps the crossed destination when a horizontal gesture is cancelled", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(12, 700, 336, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(12 + index * 67.2, 700, 67.2, 68),
      });
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const paymentsTab = tabs[4];
    expect(paymentsTab).toBeDefined();
    if (!paymentsTab) throw new Error("Expected the Payments tab");
    const navigate = vi.spyOn(paymentsTab, "click").mockImplementation(() => undefined);

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
    expect(navigate).toHaveBeenCalledOnce();
    expect(tabs.every((tab) => tab.style.getPropertyValue("--sk-nav-proximity") === "0")).toBe(
      true,
    );

    act(() => {
      flushAnimationFrames();
    });

    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("302.4px");
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
      value: () => makeRect(20, 700, 350, 68),
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
      value: () => makeRect(20, 700, 350, 68),
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
      value: () => makeRect(20, 700, 350, 68),
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
    if (!musicTab || !paymentTab) throw new Error("Expected the Music and Payments tabs");
    const navigate = vi.spyOn(musicTab, "click").mockImplementation(() => undefined);

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

    expect(navigate).toHaveBeenCalledOnce();
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("35px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-y")).toBe("34px");
  });

  it("keeps a rapid second touch from being overwritten by the previous settle frame", () => {
    render(<ProducerBottomNav />);

    const nav = screen.getByRole("navigation", { name: "Producer tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")];

    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(20, 700, 350, 68),
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
