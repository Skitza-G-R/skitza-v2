// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESKTOP_CAPABILITIES } from "~/lib/desktop/bridge";
import {
  invalidateDesktopSessionValidation,
  resetDesktopSessionValidationForTests,
  updateDesktopSessionValidation,
} from "~/lib/desktop/session-validation";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: "producer-user" }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

import { RuntimeStateProvider } from "../runtime-state-provider";

beforeEach(() => {
  resetDesktopSessionValidationForTests();
  window.__SKITZA_DESKTOP__ = {
    protocolVersion: 1,
    capabilities: [DESKTOP_CAPABILITIES.sessionValidation],
    listen: () => () => undefined,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetDesktopSessionValidationForTests();
  delete window.__SKITZA_DESKTOP__;
});

describe("RuntimeStateProvider desktop validation boundary", () => {
  it("conceals mounted private DOM until validation and again on revocation", () => {
    render(
      <RuntimeStateProvider
        identity={{
          contextId: "producer-studio",
          role: "producer",
          userId: "producer-user",
        }}
      >
        <div>Private studio title</div>
      </RuntimeStateProvider>,
    );

    expect(screen.queryByText("Private studio title")).toBeNull();
    expect(screen.getByLabelText("Checking connection")).toBeTruthy();

    act(() => {
      updateDesktopSessionValidation({
        accountId: "producer-user",
        status: "valid",
      });
    });
    expect(screen.getByText("Private studio title")).toBeTruthy();

    act(() => {
      invalidateDesktopSessionValidation("revoked");
    });
    expect(screen.queryByText("Private studio title")).toBeNull();
    expect(screen.getByText("Sign in again to open your studio.")).toBeTruthy();
  });

  it("conceals mounted private DOM immediately when the browser goes offline", () => {
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    updateDesktopSessionValidation({
      accountId: "producer-user",
      status: "valid",
    });
    render(
      <RuntimeStateProvider
        identity={{
          contextId: "producer-studio",
          role: "producer",
          userId: "producer-user",
        }}
      >
        <div>Private studio title</div>
      </RuntimeStateProvider>,
    );
    expect(screen.getByText("Private studio title")).toBeTruthy();

    act(() => {
      online.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.queryByText("Private studio title")).toBeNull();
    expect(screen.getByLabelText("Checking connection")).toBeTruthy();
  });
});
