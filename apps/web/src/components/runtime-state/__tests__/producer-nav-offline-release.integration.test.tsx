// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  writeRuntimeScreenSafeView,
  type RuntimeScreenSafeView,
  type RuntimeStateIdentity,
} from "~/lib/runtime-state/runtime-state";

const mocked = vi.hoisted(() => ({
  online: false,
  pathname: "/dashboard",
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
  toast: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    isLoaded: true,
    userId: "producer-user",
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocked.pathname,
  useRouter: () => mocked.router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../runtime-state-provider", () => ({
  useRuntimeState: () => ({
    identity: {
      userId: "producer-user",
      role: "producer",
      contextId: "producer-studio",
    },
    privateStateAccessAllowed: true,
    storage: window.localStorage,
  }),
}));

vi.mock("../online-required-link", () => ({
  useOnlineStatus: () => mocked.online,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocked.toast }),
}));

import { ProducerBottomNav } from "~/components/nav/producer-bottom-nav";

import { RuntimeScreenTransitionBoundary } from "../runtime-screen-view";

const PRODUCER: RuntimeStateIdentity = {
  userId: "producer-user",
  role: "producer",
  contextId: "producer-studio",
};

function savedView(title: string): RuntimeScreenSafeView {
  return {
    kind: "producer-workspace",
    title,
    subtitle: "Saved offline view",
    metrics: [],
    sections: [],
  };
}

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

function dispatchPointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
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
  window.localStorage.clear();
  mocked.online = false;
  mocked.pathname = "/dashboard";
  mocked.router.push.mockReset();
  mocked.router.replace.mockReset();
  mocked.toast.mockReset();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => mocked.online,
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(performance.now());
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderOfflineNavigation(): {
  musicTab: HTMLElement;
  nav: HTMLElement;
} {
  expect(
    writeRuntimeScreenSafeView(window.localStorage, PRODUCER, "/dashboard/music", {
      ...savedView("Saved Music"),
      kind: "producer-music",
    }),
  ).toBe(true);
  expect(
    writeRuntimeScreenSafeView(
      window.localStorage,
      PRODUCER,
      "/dashboard/clients-projects",
      savedView("Saved Clients"),
    ),
  ).toBe(true);

  render(
    <>
      <RuntimeScreenTransitionBoundary>
        <div>Current server screen</div>
      </RuntimeScreenTransitionBoundary>
      <ProducerBottomNav />
    </>,
  );

  const nav = screen.getByRole("navigation", { name: "Producer tabs" });
  const tabs = [...nav.querySelectorAll<HTMLElement>("[data-liquid-glass-nav-tab]")];
  Object.defineProperty(nav, "getBoundingClientRect", {
    value: () => makeRect(20, 700, 350, 68),
  });
  tabs.forEach((tab, index) => {
    Object.defineProperty(tab, "getBoundingClientRect", {
      value: () => makeRect(20 + index * 70, 700, 70, 68),
    });
  });

  return {
    musicTab: screen.getByRole("link", { name: "Music" }),
    nav,
  };
}

function startMusicToClients(nav: HTMLElement, musicTab: HTMLElement): void {
  dispatchPointer(musicTab, "pointerdown", {
    pointerId: 71,
    clientX: 125,
    clientY: 734,
  });
  dispatchPointer(nav, "pointermove", {
    pointerId: 71,
    clientX: 195,
    clientY: 734,
  });
  expect(screen.getByText("Saved Clients")).toBeTruthy();
}

function releaseOnClients(nav: HTMLElement): void {
  dispatchPointer(nav, "pointerup", {
    pointerId: 71,
    clientX: 195,
    clientY: 734,
  });
}

describe("producer nav and runtime-shell offline integration", () => {
  it("keeps the crossed destination when the physical release clicks the pressed tab", () => {
    const { musicTab, nav } = renderOfflineNavigation();
    startMusicToClients(nav, musicTab);
    dispatchPointer(nav, "pointermove", {
      pointerId: 71,
      clientX: 125,
      clientY: 734,
    });
    expect(screen.getByText("Saved Music")).toBeTruthy();
    dispatchPointer(nav, "pointermove", {
      pointerId: 71,
      clientX: 195,
      clientY: 734,
    });
    expect(screen.getByText("Saved Clients")).toBeTruthy();
    expect(mocked.toast).toHaveBeenCalledOnce();
    releaseOnClients(nav);

    fireEvent(
      musicTab,
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 0,
      }),
    );

    expect(screen.getByText("Saved Clients")).toBeTruthy();
    expect(screen.queryByText("Saved Music")).toBeNull();

    mocked.online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(mocked.router.push).toHaveBeenCalledOnce();
    expect(mocked.router.push).toHaveBeenCalledWith("/dashboard/clients-projects");
    expect(mocked.router.push).not.toHaveBeenCalledWith("/dashboard/music");
  });

  it("allows an immediate keyboard activation after a completed drag", () => {
    const { musicTab, nav } = renderOfflineNavigation();
    startMusicToClients(nav, musicTab);
    releaseOnClients(nav);

    fireEvent.keyDown(musicTab, { key: "Enter" });
    fireEvent(
      musicTab,
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 0,
      }),
    );

    expect(screen.getByText("Saved Music")).toBeTruthy();
    expect(screen.queryByText("Saved Clients")).toBeNull();
  });
});
