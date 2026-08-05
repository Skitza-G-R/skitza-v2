// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/artist",
  reducedMotion: false,
  search: "studio=studio-1",
}));

vi.mock("@clerk/nextjs", () => {
  const UserButton = Object.assign(({ children }: { children: ReactNode }) => <>{children}</>, {
    __experimental_Outlet: () => (
      <button type="button" data-testid="mock-artist-account-outlet">
        Account details
      </button>
    ),
  });

  return {
    UserAvatar: () => <span data-testid="mock-artist-avatar" />,
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
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("../account-role-menu-items", () => ({
  renderAccountRoleMenuItems: () => null,
  useAccountRoleMenuModel: () => ({
    currentLabel: "Artist · Current role",
    currentRole: "artist",
    roleAction: null,
    settingsHref: "/artist/settings?studio=studio-1",
  }),
}));

vi.mock("~/lib/runtime-state/navigation-cache", () => ({
  announceRuntimeMainNavigationIntent: vi.fn(),
  captureRuntimeMainNavigationTarget: vi.fn(),
}));

import { ArtistMobileUserButton } from "../artist-user-button";

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
  type: "pointercancel" | "pointerdown" | "pointermove" | "pointerup",
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
  fireEvent(target, event);
}

function renderButton({
  settingsHref = "/artist/settings?studio=studio-1",
}: {
  settingsHref?: string;
} = {}) {
  render(
    <ArtistMobileUserButton
      userId="user-1"
      producerStatus="complete"
      producerUnreadCount={0}
      settingsHref={settingsHref}
      ringClassName="ring-[rgb(var(--border-subtle))]"
    />,
  );
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

  const sheet = screen.getByTestId("artist-account-sheet");
  const handle = screen.getByTestId("artist-account-sheet-handle");
  Object.defineProperty(sheet, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ height: 600 }),
  });
  return { handle, sheet, trigger };
}

beforeEach(() => {
  mocks.pathname = "/artist";
  mocks.reducedMotion = false;
  mocks.search = "studio=studio-1";
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

describe("Artist mobile account sheet", () => {
  it("opens below the viewport with the Producer motion surface and drag handle", () => {
    renderButton();

    const { handle, sheet, trigger } = openAccountSheet();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(sheet.classList.contains("sk-account-sheet-motion")).toBe(true);
    expect(handle.classList.contains("touch-none")).toBe(true);
    expect(document.querySelector(".sk-account-sheet-overlay-motion")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Payments" })).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      "/artist/settings?studio=studio-1",
    );
  });

  it("keeps Payments out of the account sheet without studio query context", () => {
    mocks.search = "";
    renderButton({
      settingsHref: "/artist/settings",
    });

    openAccountSheet();
    expect(screen.queryByRole("link", { name: "Payments" })).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      "/artist/settings",
    );
  });

  it("follows one finger down, reverses upward, and springs back when canceled", () => {
    renderButton();
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

  it("dismisses after a deliberate downward drag", () => {
    renderButton();
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
  });

  it("keeps account-content scrolling separate from handle dragging", () => {
    renderButton();
    const { sheet } = openAccountSheet();
    const scrollBody = screen.getByTestId("mock-artist-account-outlet").closest(".overflow-y-auto");
    expect(scrollBody).not.toBeNull();
    if (!scrollBody) throw new Error("Expected the account menu scroll body");

    dispatchPointer(scrollBody, "pointerdown", { clientY: 300, timeStamp: 10 });
    dispatchPointer(scrollBody, "pointermove", { clientY: 160, timeStamp: 110 });
    dispatchPointer(scrollBody, "pointerup", { clientY: 160, timeStamp: 120 });
    expect(sheet.style.transform).toBe("");
  });

  it("keeps Escape dismissal and returns focus to the avatar trigger", async () => {
    renderButton();
    const { trigger } = openAccountSheet();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("settles immediately when reduced motion is requested", () => {
    mocks.reducedMotion = true;
    renderButton();
    const { handle, sheet, trigger } = openAccountSheet();

    dispatchPointer(handle, "pointerdown", { clientY: 100, timeStamp: 10 });
    dispatchPointer(handle, "pointermove", { clientY: 290, timeStamp: 210 });
    dispatchPointer(handle, "pointerup", { clientY: 290, timeStamp: 220 });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(sheet.style.transition).toBe("");
  });
});
