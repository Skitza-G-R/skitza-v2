// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktop: false,
  desktopListeners: new Set<() => void>(),
  reducedMotion: false,
  load: vi.fn(),
  markAll: vi.fn(),
  markOne: vi.fn(),
  open: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
  }),
}));

vi.mock("~/components/artist/artist-notification-actions", () => ({
  loadArtistNotificationFeedAction: mocks.load,
  markAllArtistNotificationsReadAction: mocks.markAll,
  markArtistNotificationReadAction: mocks.markOne,
  openArtistNotificationAction: mocks.open,
}));

import {
  ArtistNotificationBell,
  artistNotificationTabForKey,
  type ArtistNotificationFeedItem,
} from "../artist-notification-bell";

type PointerCaptureMap = WeakMap<HTMLElement, Set<number>>;

let pointerCaptures: PointerCaptureMap;

const previewItems: readonly ArtistNotificationFeedItem[] = [
  {
    id: "notification-unread",
    producerId: "producer-1",
    producerName: "Signal House",
    producerLogoUrl: null,
    kind: "comment_created",
    title: "Mix notes arrived",
    body: "Two notes on the chorus.",
    readAtIso: null,
    openedAtIso: null,
    createdAtIso: "2026-07-30T09:00:00.000Z",
  },
  {
    id: "notification-read",
    producerId: "producer-2",
    producerName: "North Room",
    producerLogoUrl: null,
    kind: "booking_confirmed",
    title: "Session confirmed",
    body: "Friday at 10:00.",
    readAtIso: "2026-07-30T08:30:00.000Z",
    openedAtIso: "2026-07-30T08:30:00.000Z",
    createdAtIso: "2026-07-30T08:00:00.000Z",
  },
];

function installPointerCapture(): void {
  pointerCaptures = new WeakMap();
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        const captured = pointerCaptures.get(this) ?? new Set<number>();
        captured.add(pointerId);
        pointerCaptures.set(this, captured);
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        return pointerCaptures.get(this)?.has(pointerId) ?? false;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        pointerCaptures.get(this)?.delete(pointerId);
      },
    },
  });
}

function dispatchPointer(
  target: Element,
  type: "lostpointercapture" | "pointercancel" | "pointerdown" | "pointermove" | "pointerup",
  {
    clientY,
    pointerId = 7,
    pointerType = "touch",
    timeStamp,
  }: {
    clientY: number;
    pointerId?: number;
    pointerType?: "mouse" | "touch";
    timeStamp: number;
  },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientY,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    timeStamp: { value: timeStamp },
  });
  if (type === "lostpointercapture" && target instanceof HTMLElement) {
    pointerCaptures.get(target)?.delete(pointerId);
  }
  fireEvent(target, event);
}

function renderOpenPreview(): {
  handle: HTMLElement;
  list: HTMLElement;
  sheet: HTMLElement;
  trigger: HTMLButtonElement;
} {
  render(
    <ArtistNotificationBell
      preview={{
        items: previewItems,
        initialOpen: true,
        relativeNow: new Date("2026-07-30T10:00:00.000Z"),
      }}
    />,
  );
  const trigger = screen.getByTestId<HTMLButtonElement>("artist-notification-trigger");
  const sheet = screen.getByTestId("artist-notification-sheet");
  const handle = screen.getByTestId("artist-notification-sheet-handle");
  const list = screen.getByTestId("artist-notification-list");
  Object.defineProperty(sheet, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ height: 600 }),
  });
  return { handle, list, sheet, trigger };
}

beforeEach(() => {
  mocks.desktop = false;
  mocks.desktopListeners.clear();
  mocks.reducedMotion = false;
  mocks.load.mockReset();
  mocks.markAll.mockReset();
  mocks.markOne.mockReset();
  mocks.open.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.load.mockResolvedValue({
    ok: true,
    notifications: previewItems,
    unreadCount: 1,
  });
  mocks.markAll.mockResolvedValue({ ok: true });
  mocks.markOne.mockResolvedValue({ ok: true });
  mocks.open.mockResolvedValue({ ok: true, href: "/artist/studio/producer-1" });

  installPointerCapture();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => {
      const isReducedMotion = media.includes("prefers-reduced-motion");
      return {
        get matches() {
          return isReducedMotion ? mocks.reducedMotion : mocks.desktop;
        },
        media,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_type: string, listener: () => void) => {
          if (!isReducedMotion) mocks.desktopListeners.add(listener);
        }),
        removeEventListener: vi.fn((_type: string, listener: () => void) => {
          if (!isReducedMotion) mocks.desktopListeners.delete(listener);
        }),
        dispatchEvent: vi.fn(() => true),
      } as MediaQueryList;
    }),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      return window.setTimeout(() => {
        callback(performance.now());
      }, 0);
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((handle: number) => {
      window.clearTimeout(handle);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
});

describe("ArtistNotificationBell mobile sheet", () => {
  it("uses preview fixtures locally without invoking production actions or navigation", async () => {
    const { trigger } = renderOpenPreview();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-label")).toBe("Notifications, 1 unread");
    expect(screen.getByText("Mix notes arrived")).not.toBeNull();
    expect(screen.getByText(/Signal House/)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mark Mix notes arrived read" }));
    expect(trigger.getAttribute("aria-label")).toBe("Notifications");

    fireEvent.click(screen.getByRole("button", { name: /Mix notes arrived/ }));
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
    });

    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.markOne).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("loads the production feed once and keeps it across reopen", async () => {
    render(<ArtistNotificationBell />);
    const trigger = screen.getByTestId<HTMLButtonElement>("artist-notification-trigger");

    fireEvent.click(trigger);
    expect(await screen.findByText("Mix notes arrived")).not.toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
    fireEvent.click(trigger);
    expect(screen.getByText("Mix notes arrived")).not.toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("marks every preview item read locally", () => {
    const { trigger } = renderOpenPreview();

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(trigger.getAttribute("aria-label")).toBe("Notifications");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Mark all read" }).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("tab", { name: "unread" }));
    expect(screen.getByText("No unread notifications")).not.toBeNull();
    expect(mocks.markAll).not.toHaveBeenCalled();
  });

  it("provides roving tab focus with Arrow, Home, and End keys", async () => {
    renderOpenPreview();
    const allTab = screen.getByRole<HTMLButtonElement>("tab", { name: "all" });
    const unreadTab = screen.getByRole<HTMLButtonElement>("tab", { name: "unread" });
    const panel = screen.getByRole("tabpanel");

    expect(artistNotificationTabForKey("ArrowRight")).toBe("unread");
    expect(artistNotificationTabForKey("Home")).toBe("all");
    expect(artistNotificationTabForKey("Enter")).toBeNull();
    expect(allTab.tabIndex).toBe(0);
    expect(unreadTab.tabIndex).toBe(-1);
    expect(allTab.getAttribute("aria-controls")).toBe(panel.id);

    allTab.focus();
    fireEvent.keyDown(allTab, { key: "End" });
    expect(unreadTab.getAttribute("aria-selected")).toBe("true");
    expect(unreadTab.tabIndex).toBe(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(unreadTab);
    });
    expect(panel.getAttribute("aria-labelledby")).toBe(unreadTab.id);
    expect(screen.queryByText("Session confirmed")).toBeNull();

    fireEvent.keyDown(unreadTab, { key: "Home" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
    await waitFor(() => {
      expect(document.activeElement).toBe(allTab);
    });
    expect(screen.getByText("Session confirmed")).not.toBeNull();
  });

  it("tracks and reverses handle drags while leaving scroll content untouched", () => {
    const { handle, list, sheet, trigger } = renderOpenPreview();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 240, timeStamp: 110 });
    expect(sheet.style.transform).toBe("translate3d(0, 140px, 0)");

    dispatchPointer(handle, "pointermove", { clientY: 50, timeStamp: 210 });
    expect(sheet.style.transform).toBe("translate3d(0, -9px, 0)");
    dispatchPointer(handle, "pointercancel", { clientY: 50, timeStamp: 220 });
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    dispatchPointer(list, "pointerdown", { clientY: 300, timeStamp: 300 });
    dispatchPointer(list, "pointermove", { clientY: 120, timeStamp: 400 });
    dispatchPointer(list, "pointerup", { clientY: 120, timeStamp: 410 });
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
  });

  it("recovers from lost capture and honors a final upward release reversal", () => {
    const { handle, sheet, trigger } = renderOpenPreview();

    dispatchPointer(handle, "pointerdown", {
      clientY: 100,
      pointerId: 41,
      timeStamp: 10,
    });
    dispatchPointer(handle, "pointermove", {
      clientY: 140,
      pointerId: 41,
      timeStamp: 20,
    });
    dispatchPointer(handle, "lostpointercapture", {
      clientY: 140,
      pointerId: 41,
      timeStamp: 30,
    });
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");

    dispatchPointer(handle, "pointerdown", {
      clientY: 100,
      pointerId: 43,
      timeStamp: 100,
    });
    dispatchPointer(handle, "pointermove", {
      clientY: 140,
      pointerId: 43,
      timeStamp: 110,
    });
    dispatchPointer(handle, "pointerup", {
      clientY: 125,
      pointerId: 43,
      timeStamp: 120,
    });
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("cleans an interrupted settle before switching to the desktop popover", () => {
    const { handle, sheet } = renderOpenPreview();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 140, timeStamp: 20 });
    dispatchPointer(handle, "pointercancel", { clientY: 140, timeStamp: 30 });
    expect(sheet.style.transition).not.toBe("");
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");

    act(() => {
      mocks.desktop = true;
      for (const listener of mocks.desktopListeners) listener();
    });

    expect(screen.queryByTestId("artist-notification-sheet")).toBeNull();
    expect(screen.getByTestId("artist-notification-popover")).not.toBeNull();
    expect(sheet.style.animation).toBe("");
    expect(sheet.style.transition).toBe("");
    expect(sheet.style.transform).toBe("");
    expect(sheet.style.willChange).toBe("");
    expect(sheet.style.pointerEvents).toBe("");
  });

  it("dismisses a deliberate mouse drag and returns focus to the bell", async () => {
    vi.useFakeTimers();
    const { handle, sheet, trigger } = renderOpenPreview();

    dispatchPointer(handle, "pointerdown", {
      clientY: 100,
      pointerType: "mouse",
      timeStamp: 10,
    });
    dispatchPointer(handle, "pointermove", {
      clientY: 290,
      pointerType: "mouse",
      timeStamp: 210,
    });
    dispatchPointer(handle, "pointerup", {
      clientY: 290,
      pointerType: "mouse",
      timeStamp: 220,
    });
    expect(sheet.style.transform).toBe("translate3d(0, 100%, 0)");
    expect(sheet.style.pointerEvents).toBe("none");

    act(() => {
      vi.advanceTimersByTime(240);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("dismisses immediately when reduced motion is requested", () => {
    mocks.reducedMotion = true;
    const { handle, sheet, trigger } = renderOpenPreview();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 290, timeStamp: 210 });
    dispatchPointer(handle, "pointerup", { clientY: 290, timeStamp: 220 });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(sheet.style.transition).toBe("");
  });
});
