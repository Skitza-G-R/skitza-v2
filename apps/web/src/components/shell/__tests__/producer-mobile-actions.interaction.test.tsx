// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  reducedMotion: false,
  search: "",
}));

vi.mock("@clerk/nextjs", () => {
  const UserButton = Object.assign(
    ({ children }: { children: ReactNode }) => <>{children}</>,
    {
      __experimental_Outlet: () => (
        <button type="button" data-testid="mock-account-outlet">
          Account details
        </button>
      ),
    },
  );

  return {
    UserAvatar: () => <span data-testid="mock-user-avatar" />,
    UserButton,
  };
});

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
    onNavigate?: () => void;
    prefetch?: boolean;
  }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("~/lib/runtime-state/navigation-cache", () => ({
  announceRuntimeMainNavigationIntent: vi.fn(),
  captureRuntimeMainNavigationTarget: vi.fn(),
}));

import { ProducerMobileActions } from "../producer-mobile-actions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "../../ui/sheet";

type PointerCaptureMap = WeakMap<HTMLElement, Set<number>>;

let pointerCaptures: PointerCaptureMap;

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
  type:
    | "lostpointercapture"
    | "pointercancel"
    | "pointerdown"
    | "pointermove"
    | "pointerup",
  {
    clientY,
    pointerId = 7,
    timeStamp,
  }: {
    clientY: number;
    pointerId?: number;
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
    pointerType: { value: "touch" },
    timeStamp: { value: timeStamp },
  });
  if (type === "lostpointercapture" && target instanceof HTMLElement) {
    pointerCaptures.get(target)?.delete(pointerId);
  }
  fireEvent(target, event);
}

function openAccountSheet(): {
  handle: HTMLElement;
  sheet: HTMLElement;
  trigger: HTMLButtonElement;
} {
  const trigger = screen.getByRole<HTMLButtonElement>("button", {
    name: "Open account menu",
  });
  fireEvent.click(trigger);

  const sheet = screen.getByTestId("account-sheet");
  const handle = screen.getByTestId("account-sheet-handle");
  Object.defineProperty(sheet, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ height: 600 }),
  });
  return { handle, sheet, trigger };
}

function AccountOverlayLifecycleHarness() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button
        type="button"
        data-testid="close-account-overlay-lifecycle"
        onClick={() => {
          setOpen(false);
        }}
      >
        Close test sheet
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-testid="account-overlay-lifecycle-sheet"
          className="test-account-sheet-lifecycle"
          overlayClassName="sk-account-sheet-overlay-motion"
        >
          <SheetTitle>Account test sheet</SheetTitle>
          <SheetDescription>Account overlay lifecycle</SheetDescription>
        </SheetContent>
      </Sheet>
    </>
  );
}

beforeEach(() => {
  mocks.pathname = "/dashboard";
  mocks.reducedMotion = false;
  mocks.search = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/dashboard");
  installPointerCapture();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (media: string) =>
        ({
          matches: media.includes("prefers-reduced-motion") && mocks.reducedMotion,
          media,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) as MediaQueryList,
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
});

describe("ProducerMobileActions account sheet interaction", () => {
  it("consumes the post-onboarding cue once and dismisses it when the avatar opens", async () => {
    mocks.search = "storeTip=1";
    window.history.replaceState(null, "", "/dashboard?storeTip=1");

    const { rerender } = render(<ProducerMobileActions producerSlug={null} />);

    expect(await screen.findByText("Manage your Store from your profile photo.")).not.toBeNull();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/dashboard");
      expect(window.location.search).toBe("");
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open account menu",
      }),
    );
    expect(screen.queryByTestId("producer-store-tip")).toBeNull();
    expect(screen.getByTestId("account-sheet")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    rerender(<ProducerMobileActions producerSlug={null} />);
    expect(screen.queryByTestId("producer-store-tip")).toBeNull();
  });

  it("preserves unrelated query state and the hash when consuming the cue", async () => {
    mocks.search = "project=active&storeTip=1";
    window.history.replaceState(
      null,
      "",
      "/dashboard?project=active&storeTip=1#recent",
    );

    render(<ProducerMobileActions producerSlug={null} />);

    expect(await screen.findByText("Manage your Store from your profile photo.")).not.toBeNull();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/dashboard");
      expect(window.location.search).toBe("?project=active");
      expect(window.location.hash).toBe("#recent");
    });
  });

  it("dismisses the post-onboarding cue when navigation changes", async () => {
    mocks.search = "storeTip=1";
    window.history.replaceState(null, "", "/dashboard?storeTip=1");

    const { rerender } = render(<ProducerMobileActions producerSlug={null} />);
    expect(await screen.findByText("Manage your Store from your profile photo.")).not.toBeNull();

    mocks.pathname = "/dashboard/music";
    mocks.search = "";
    rerender(<ProducerMobileActions producerSlug={null} />);

    await waitFor(() => {
      expect(screen.queryByTestId("producer-store-tip")).toBeNull();
    });
  });

  it("renders Store first in a one-column account menu with its helper", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    openAccountSheet();

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard/store",
      "/dashboard/settings",
    ]);
    expect(links[0]?.textContent).toContain("Store");
    expect(links[0]?.textContent).toContain("Products and private offers");
    expect(screen.getByRole("button", { name: /Install Skitza/ })).not.toBeNull();
    const profileLinks = screen.getByTestId("producer-mobile-profile-links");
    expect(profileLinks.classList.contains("grid-cols-1")).toBe(true);
    expect(profileLinks.classList.contains("grid-cols-2")).toBe(false);
  });

  it("opens with the scoped motion surface and a fixed drag handle", () => {
    render(<ProducerMobileActions producerSlug={null} />);

    const { handle, sheet, trigger } = openAccountSheet();
    const overlay = document.querySelector<HTMLElement>(
      ".sk-account-sheet-overlay-motion",
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(sheet.classList.contains("sk-account-sheet-motion")).toBe(true);
    expect(handle.classList.contains("touch-none")).toBe(true);
    expect(overlay?.getAttribute("data-state")).toBe("open");
    expect(overlay?.classList.contains("motion-reduce:animate-none")).toBe(true);
    expect(screen.getByTestId("mock-account-outlet").closest(".overflow-y-auto")).not.toBeNull();
  });

  it("keeps the account overlay mounted in its closed state for the exit", async () => {
    const lifecycleStyles = document.createElement("style");
    lifecycleStyles.textContent = `
      @keyframes test-account-content-open { from { opacity: 0; } to { opacity: 1; } }
      @keyframes test-account-content-closed { from { opacity: 1; } to { opacity: 0; } }
      @keyframes test-account-overlay-open { from { opacity: 0; } to { opacity: 1; } }
      @keyframes skitza-account-sheet-overlay-out { from { opacity: 1; } to { opacity: 0; } }
      .test-account-sheet-lifecycle[data-state="open"] {
        animation-name: test-account-content-open;
        animation-duration: 260ms;
        animation-fill-mode: both;
      }
      .test-account-sheet-lifecycle[data-state="closed"] {
        animation-name: test-account-content-closed;
        animation-duration: 260ms;
        animation-fill-mode: both;
      }
      .sk-account-sheet-overlay-motion[data-state="open"] {
        animation-name: test-account-overlay-open;
        animation-duration: 260ms;
        animation-fill-mode: both;
      }
      .sk-account-sheet-overlay-motion[data-state="closed"] {
        animation-name: skitza-account-sheet-overlay-out;
        animation-duration: 260ms;
        animation-fill-mode: both;
      }
    `;
    document.head.append(lifecycleStyles);

    render(<AccountOverlayLifecycleHarness />);
    const openOverlay = document.querySelector<HTMLElement>(
      ".sk-account-sheet-overlay-motion",
    );
    expect(openOverlay).not.toBeNull();
    if (!openOverlay) throw new Error("Expected the open account overlay");
    await waitFor(() => {
      expect(window.getComputedStyle(openOverlay).animationName).toBe(
        "test-account-overlay-open",
      );
    });
    fireEvent.click(screen.getByTestId("close-account-overlay-lifecycle"));

    const overlay = document.querySelector<HTMLElement>(
      ".sk-account-sheet-overlay-motion",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("data-state")).toBe("closed");
    lifecycleStyles.remove();
  });

  it("leaves default Sheet overlays unchanged when no class is supplied", () => {
    render(
      <Sheet open>
        <SheetContent data-testid="default-sheet">
          <SheetTitle>Default sheet</SheetTitle>
          <SheetDescription>Default behavior</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    const content = screen.getByTestId("default-sheet");
    const overlay = [...document.querySelectorAll<HTMLElement>('[data-state="open"]')].find(
      (element) => element !== content && !element.hasAttribute("data-side"),
    );
    expect(overlay).toBeDefined();
    expect(overlay?.classList.contains("sk-account-sheet-overlay-motion")).toBe(false);
  });

  it("follows one finger down, reverses upward, and springs back when canceled", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 240, timeStamp: 110 });
    expect(sheet.style.transform).toBe("translate3d(0, 140px, 0)");

    dispatchPointer(handle, "pointermove", { clientY: 135, timeStamp: 210 });
    expect(sheet.style.transform).toBe("translate3d(0, 35px, 0)");

    dispatchPointer(handle, "pointercancel", { clientY: 135, timeStamp: 220 });
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it.each([
    { height: 800, width: 360 },
    { height: 844, width: 390 },
  ])("backs the viewport bottom at $width×$height through the maximum upward drag", ({
    height: viewportBottom,
    width: viewportWidth,
  }) => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet } = openAccountSheet();
    const backing = screen.getByTestId("account-sheet-bottom-backing");
    const sheetBorderWidth = 1;

    Object.defineProperty(sheet, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const offset = Number(
          /translate3d\(0,\s*(-?[\d.]+)px/.exec(sheet.style.transform)?.[1] ?? 0,
        );
        return {
          bottom: viewportBottom + offset,
          height: 600,
          left: 0,
          right: viewportWidth,
          top: viewportBottom + offset - 600,
          width: viewportWidth,
        };
      },
    });
    Object.defineProperty(backing, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const sheetBottom = sheet.getBoundingClientRect().bottom;
        const backingHeight = Number.parseFloat(backing.style.height);
        const backingTop = sheetBottom - sheetBorderWidth;
        return {
          bottom: backingTop + backingHeight,
          height: backingHeight,
          left: 0,
          right: viewportWidth,
          top: backingTop,
          width: viewportWidth,
        };
      },
    });

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: -400, timeStamp: 110 });

    expect(sheet.style.transform).toBe("translate3d(0, -24px, 0)");
    expect(sheet.getBoundingClientRect().bottom).toBe(viewportBottom - 24);
    expect(sheet.getBoundingClientRect().width).toBe(viewportWidth);
    expect(backing.getBoundingClientRect().width).toBe(viewportWidth);
    expect(backing.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(viewportBottom);

    dispatchPointer(handle, "pointercancel", { clientY: -400, timeStamp: 120 });
  });

  it("lets position decide after a fast short move pauses before release", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 136, timeStamp: 20 });
    expect(sheet.style.transform).toBe("translate3d(0, 36px, 0)");

    dispatchPointer(handle, "pointerup", { clientY: 136, timeStamp: 220 });

    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("retains a genuinely fresh same-position flick", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();
    vi.useFakeTimers();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 136, timeStamp: 30 });
    dispatchPointer(handle, "pointerup", { clientY: 136, timeStamp: 40 });

    expect(sheet.style.transform).toBe("translate3d(0, 100%, 0)");
    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses a final upward pointer-up reversal instead of stale downward velocity", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 140, timeStamp: 20 });
    expect(sheet.style.transform).toBe("translate3d(0, 40px, 0)");

    dispatchPointer(handle, "pointerup", { clientY: 125, timeStamp: 30 });

    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores a descendant lost-capture event and continues the active drag", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet } = openAccountSheet();
    const handleTip = handle.querySelector("span");
    expect(handleTip).not.toBeNull();
    if (!handleTip) throw new Error("Expected the account sheet handle tip");

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
    dispatchPointer(handleTip, "lostpointercapture", {
      clientY: 140,
      pointerId: 41,
      timeStamp: 30,
    });
    dispatchPointer(handle, "pointermove", {
      clientY: 170,
      pointerId: 41,
      timeStamp: 40,
    });

    expect(sheet.style.transform).toBe("translate3d(0, 70px, 0)");
    dispatchPointer(handle, "pointercancel", {
      clientY: 170,
      pointerId: 41,
      timeStamp: 50,
    });
  });

  it("recovers from handle capture loss, supports another drag, then closes with focus", async () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();
    vi.useFakeTimers();

    dispatchPointer(handle, "pointerdown", {
      clientY: 100,
      pointerId: 43,
      timeStamp: 10,
    });
    dispatchPointer(handle, "pointermove", {
      clientY: 140,
      pointerId: 43,
      timeStamp: 20,
    });
    expect(sheet.style.transform).toBe("translate3d(0, 40px, 0)");
    expect(sheet.style.willChange).toBe("transform");

    dispatchPointer(handle, "lostpointercapture", {
      clientY: 140,
      pointerId: 43,
      timeStamp: 30,
    });
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(sheet.style.transform).toBe("");
    expect(sheet.style.transition).toBe("");
    expect(sheet.style.willChange).toBe("");

    dispatchPointer(handle, "pointerdown", {
      clientY: 100,
      pointerId: 45,
      timeStamp: 300,
    });
    dispatchPointer(handle, "pointermove", {
      clientY: 130,
      pointerId: 45,
      timeStamp: 330,
    });
    expect(sheet.style.transform).toBe("translate3d(0, 30px, 0)");
    dispatchPointer(handle, "pointercancel", {
      clientY: 130,
      pointerId: 45,
      timeStamp: 340,
    });
    act(() => {
      vi.advanceTimersByTime(240);
    });

    vi.useRealTimers();
    expect(
      document.querySelector(".sk-account-sheet-overlay-motion"),
    ).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("ignores lost capture after a normal explicit pointer release", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();
    vi.useFakeTimers();

    dispatchPointer(handle, "pointerdown", {
      clientY: 100,
      pointerId: 47,
      timeStamp: 10,
    });
    dispatchPointer(handle, "pointermove", {
      clientY: 130,
      pointerId: 47,
      timeStamp: 110,
    });
    dispatchPointer(handle, "pointerup", {
      clientY: 130,
      pointerId: 47,
      timeStamp: 230,
    });
    const settleTransition = sheet.style.transition;

    dispatchPointer(handle, "lostpointercapture", {
      clientY: 130,
      pointerId: 47,
      timeStamp: 240,
    });

    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");
    expect(sheet.style.transition).toBe(settleTransition);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("dismisses after a deliberate drag and does not replay a second exit", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();
    vi.useFakeTimers();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 290, timeStamp: 210 });
    dispatchPointer(handle, "pointerup", { clientY: 290, timeStamp: 220 });
    expect(sheet.style.transform).toBe("translate3d(0, 100%, 0)");

    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(sheet.style.animation).toBe("none");
  });

  it("does not move the sheet when a gesture starts in its scrollable content", () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { sheet } = openAccountSheet();
    const scrollBody = screen.getByTestId("mock-account-outlet").closest(".overflow-y-auto");
    expect(scrollBody).not.toBeNull();
    if (!scrollBody) throw new Error("Expected the account menu scroll body");

    dispatchPointer(scrollBody, "pointerdown", { clientY: 300, timeStamp: 10 });
    dispatchPointer(scrollBody, "pointermove", { clientY: 160, timeStamp: 110 });
    dispatchPointer(scrollBody, "pointerup", { clientY: 160, timeStamp: 120 });
    expect(sheet.style.transform).toBe("");
  });

  it("keeps Escape dismissal and returns focus to the avatar trigger", async () => {
    render(<ProducerMobileActions producerSlug={null} />);
    const { trigger } = openAccountSheet();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("settles immediately when reduced motion is requested", () => {
    mocks.reducedMotion = true;
    render(<ProducerMobileActions producerSlug={null} />);
    const { handle, sheet, trigger } = openAccountSheet();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 290, timeStamp: 210 });
    dispatchPointer(handle, "pointerup", { clientY: 290, timeStamp: 220 });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(sheet.style.transition).toBe("");
  });
});
