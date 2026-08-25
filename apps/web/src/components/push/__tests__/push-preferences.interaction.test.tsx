// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUSH_CATEGORIES } from "~/lib/push/categories";

const getPushStatusAction = vi.fn();
const savePushSubscriptionAction = vi.fn();
const unsubscribePushAction = vi.fn();
const enableAllPushCategories = vi.fn();
const requestInstallGuidance = vi.fn();

vi.mock("~/app/push-actions", () => ({
  getPushStatusAction: (endpoint: string | null): unknown => getPushStatusAction(endpoint),
  savePushSubscriptionAction: (input: unknown): unknown => savePushSubscriptionAction(input),
  unsubscribePushAction: (endpoint: string): unknown => unsubscribePushAction(endpoint),
}));

vi.mock("~/lib/push/enable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/push/enable")>();
  return {
    ...actual,
    enableAllPushCategories: (publicKey: string): unknown => enableAllPushCategories(publicKey),
  };
});

vi.mock("~/lib/pwa/install-guidance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/pwa/install-guidance")>();
  return {
    ...actual,
    requestInstallGuidance: (): void => {
      requestInstallGuidance();
    },
  };
});

const { PushPreferences } = await import("../push-preferences");

function stubPushCapableBrowser(subscription: unknown = null) {
  vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn() });
  vi.stubGlobal("PushManager", function PushManagerStub() {
    /* presence is all the component checks */
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: () => Promise.resolve(subscription) },
      }),
      getRegistration: () => Promise.resolve(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPushStatusAction.mockResolvedValue({
    ok: true,
    configured: true,
    publicKey: "test-public-key",
    categories: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SK-276 push preferences card", () => {
  it("offers one tap that turns on every category, then hides the master button", async () => {
    stubPushCapableBrowser();
    enableAllPushCategories.mockResolvedValue({
      ok: true,
      categories: [...PUSH_CATEGORIES],
      subscription: { endpoint: "https://push.example/x" },
    });

    render(<PushPreferences />);

    const turnOn = await screen.findByRole("button", { name: "Turn on notifications" });
    await userEvent.click(turnOn);

    await waitFor(() => {
      expect(enableAllPushCategories).toHaveBeenCalledWith("test-public-key");
    });

    // Every category switch flips on, and the master button steps aside.
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /Bookings/ }).getAttribute("aria-checked"),
      ).toBe("true");
    });
    expect(
      screen.queryByRole("button", { name: "Turn on notifications" }),
    ).toBeNull();
  });

  it("surfaces a refused permission without turning anything on", async () => {
    stubPushCapableBrowser();
    enableAllPushCategories.mockResolvedValue({
      ok: false,
      reason: "permission",
      message: "Allow notifications in your browser to turn this on.",
    });

    render(<PushPreferences />);
    await userEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));

    expect(
      await screen.findByText("Allow notifications in your browser to turn this on."),
    ).not.toBeNull();
    expect(
      screen.getByRole("switch", { name: /Bookings/ }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("shows artist wording instead of producer wording", async () => {
    stubPushCapableBrowser();

    render(<PushPreferences role="artist" />);

    expect(await screen.findByRole("switch", { name: /Sessions/ })).not.toBeNull();
    expect(screen.getByText("Song updates")).not.toBeNull();
    expect(screen.queryByText("Bookings")).toBeNull();
  });

  it("asks iPhone Safari to install the app instead of showing dead switches", async () => {
    // No serviceWorker/PushManager — exactly what iPhone Safari exposes.
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn() }));

    render(<PushPreferences role="artist" />);

    const how = await screen.findByRole("button", { name: "Show me how" });
    await userEvent.click(how);

    expect(requestInstallGuidance).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("switch", { name: /Sessions/ })).toBeNull();
  });
});
