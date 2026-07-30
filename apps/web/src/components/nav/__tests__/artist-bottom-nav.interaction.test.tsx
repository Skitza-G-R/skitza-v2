// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/artist",
  search: "studio=studio-2",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

import { ArtistBottomNav } from "../artist-bottom-nav";

const STUDIOS = [
  { producerId: "studio-1", name: "One", slug: "one", logoUrl: null },
  { producerId: "studio-2", name: "Two", slug: "two", logoUrl: null },
] as const;

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
  type: "pointerdown" | "pointermove",
  {
    clientX,
    clientY,
  }: {
    clientX: number;
    clientY: number;
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
    pointerId: { value: 9 },
    pointerType: { value: "touch" },
  });
  fireEvent(target, event);
}

let nextFrameId = 0;
let animationFrames = new Map<number, FrameRequestCallback>();

function flushAnimationFrames(): void {
  const queued = [...animationFrames.values()];
  animationFrames.clear();
  for (const callback of queued) callback(performance.now());
}

beforeEach(() => {
  mocks.pathname = "/artist";
  mocks.search = "studio=studio-2";
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

describe("ArtistBottomNav liquid-glass adapter", () => {
  it("renders four studio-aware tabs in a fixed shared frame", () => {
    render(<ArtistBottomNav studios={[...STUDIOS]} initialStudioId="studio-1" />);

    const nav = screen.getByRole("navigation", { name: "Artist app tabs" });
    const frame = nav.parentElement;
    const tabs = [...nav.querySelectorAll<HTMLAnchorElement>("[data-liquid-glass-nav-tab]")];

    expect(frame?.dataset.liquidGlassBottomNavFrame).toBe("fixed");
    expect(nav.style.getPropertyValue("--sk-nav-column-count")).toBe("4");
    expect(nav.style.getPropertyValue("--sk-nav-column-width")).toBe("25%");
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      "/artist?studio=studio-2",
      "/artist/music?studio=studio-2",
      "/artist/sessions?studio=studio-2",
      "/artist/store?studio=studio-2",
    ]);
    expect(tabs[0]?.getAttribute("aria-current")).toBe("page");
  });

  it("sizes and tracks the lens from the actual four-tab geometry", () => {
    render(<ArtistBottomNav studios={[...STUDIOS]} initialStudioId="studio-1" />);

    const nav = screen.getByRole("navigation", { name: "Artist app tabs" });
    const tabs = [...nav.querySelectorAll<HTMLElement>("[data-liquid-glass-nav-tab]")];
    Object.defineProperty(nav, "getBoundingClientRect", {
      value: () => makeRect(0, 700, 360, 68),
    });
    tabs.forEach((tab, index) => {
      Object.defineProperty(tab, "getBoundingClientRect", {
        value: () => makeRect(index * 90, 700, 90, 68),
      });
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(nav.style.getPropertyValue("--sk-nav-lens-width")).toBe("88px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("45px");

    const musicTab = tabs[1];
    expect(musicTab).toBeDefined();
    if (!musicTab) throw new Error("Expected the Music tab");
    const navigateMusic = vi.spyOn(musicTab, "click").mockImplementation(() => undefined);

    dispatchPointer(tabs[0] ?? nav, "pointerdown", {
      clientX: 45,
      clientY: 734,
    });
    dispatchPointer(nav, "pointermove", {
      clientX: 135,
      clientY: 734,
    });

    act(() => {
      flushAnimationFrames();
    });

    expect(navigateMusic).toHaveBeenCalledOnce();
    expect(nav.style.getPropertyValue("--sk-nav-lens-width")).toBe("88px");
    expect(nav.style.getPropertyValue("--sk-nav-lens-x")).toBe("135px");
    expect(tabs[1]?.style.getPropertyValue("--sk-nav-proximity")).toBe("1.000");
  });
});
