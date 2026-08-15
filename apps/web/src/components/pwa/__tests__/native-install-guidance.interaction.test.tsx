// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    const imageProps = { ...props };
    delete imageProps.priority;
    // eslint-disable-next-line @next/next/no-img-element -- Test replacement for next/image.
    return <img {...imageProps} />;
  },
}));

import { NativeInstallGuidance } from "../native-install-guidance";
import {
  captureNativeInstallPrompt,
  clearCapturedNativeInstallPrompt,
  markNativeAppInstalled,
  requestInstallGuidance,
  type NativeInstallPromptEvent,
} from "~/lib/pwa/install-guidance";

const AUTO_OPEN_MS = 900;

function setNavigator({
  userAgent,
  platform,
  maxTouchPoints = 5,
  online = true,
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
  online?: boolean;
}) {
  Object.defineProperties(window.navigator, {
    maxTouchPoints: { configurable: true, value: maxTouchPoints },
    onLine: { configurable: true, value: online },
    platform: { configurable: true, value: platform },
    userAgent: { configurable: true, value: userAgent },
  });
}

function advanceAutoOpen() {
  act(() => {
    vi.advanceTimersByTime(AUTO_OPEN_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearCapturedNativeInstallPrompt();
  setNavigator({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140",
    platform: "Linux armv8l",
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (media: string) =>
        ({
          matches: false,
          media,
          onchange: null,
          addEventListener: vi.fn(),
          addListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
          removeEventListener: vi.fn(),
          removeListener: vi.fn(),
        }) as MediaQueryList,
    ),
  );
});

afterEach(() => {
  cleanup();
  clearCapturedNativeInstallPrompt();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SK-249 mobile install invitation", () => {
  it("opens after the signed-in mobile shell settles and runs the native prompt", async () => {
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
    }) as NativeInstallPromptEvent;
    captureNativeInstallPrompt(event);

    render(<NativeInstallGuidance role="producer" />);
    advanceAutoOpen();

    expect(screen.getByRole("heading", { name: "Get the Skitza app" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install Skitza" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem("skitza:native-installed:v1")).toBe("true");
  });

  it("turns the iPhone action into clear Home Screen instructions", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)",
      platform: "iPhone",
    });

    render(<NativeInstallGuidance role="artist" />);
    advanceAutoOpen();

    fireEvent.click(screen.getByRole("button", { name: "Install Skitza" }));
    expect(screen.getByRole("heading", { name: "Add Skitza to your Home Screen" })).not.toBeNull();
    expect(screen.getByText("Open your browser’s Share menu")).not.toBeNull();
    expect(screen.getByText("Choose Add to Home Screen")).not.toBeNull();
    expect(screen.getByText(/Open as Web App/)).not.toBeNull();
  });

  it("respects a dismissed browser prompt and starts the 90-day quiet period", async () => {
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: "dismissed" as const, platform: "web" }),
    }) as NativeInstallPromptEvent;
    captureNativeInstallPrompt(event);

    render(<NativeInstallGuidance role="producer" />);
    advanceAutoOpen();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install Skitza" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      Number(window.localStorage.getItem("skitza:native-install-dismissed:v1")),
    ).toBeGreaterThan(0);
  });

  it("falls back to truthful browser steps when the native prompt fails", async () => {
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(() => Promise.reject(new Error("prompt unavailable"))),
      userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
    }) as NativeInstallPromptEvent;
    captureNativeInstallPrompt(event);

    render(<NativeInstallGuidance role="artist" />);
    advanceAutoOpen();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install Skitza" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", { name: "Install Skitza from your browser" }),
    ).not.toBeNull();
    expect(screen.getByText(/install window did not open/i)).not.toBeNull();
  });

  it("keeps manual re-entry available after automatic guidance is dismissed", () => {
    render(<NativeInstallGuidance role="producer" />);
    advanceAutoOpen();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      requestInstallGuidance();
    });
    expect(screen.getByRole("heading", { name: "Get the Skitza app" })).not.toBeNull();
  });

  it("returns focus to the account trigger after manual guidance closes", () => {
    render(
      <>
        <button type="button">Open account menu</button>
        <NativeInstallGuidance role="producer" />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Open account menu" });
    trigger.focus();

    act(() => {
      requestInstallGuidance(trigger);
    });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(document.activeElement).toBe(trigger);
  });

  it("suppresses manual guidance when installation is already known", () => {
    markNativeAppInstalled();
    render(<NativeInstallGuidance role="artist" />);
    advanceAutoOpen();

    act(() => {
      requestInstallGuidance();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("remains dismissible when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable");
    });
    render(<NativeInstallGuidance role="producer" />);

    act(() => {
      requestInstallGuidance();
    });
    expect(() => {
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    }).not.toThrow();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not render automatic or manual guidance in standalone mode", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        (media: string) =>
          ({
            matches: media === "(display-mode: standalone)",
            media,
            onchange: null,
            addEventListener: vi.fn(),
            addListener: vi.fn(),
            dispatchEvent: vi.fn(() => true),
            removeEventListener: vi.fn(),
            removeListener: vi.fn(),
          }) as MediaQueryList,
      ),
    );

    render(<NativeInstallGuidance role="artist" />);
    advanceAutoOpen();
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      requestInstallGuidance();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a truthful reconnect state while offline", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
      platform: "Linux armv8l",
      online: false,
    });

    render(<NativeInstallGuidance role="producer" />);
    advanceAutoOpen();

    expect(screen.getByText("Reconnect to install Skitza.")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Reconnect to install" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
