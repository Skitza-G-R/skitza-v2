// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleCalendarControlActions } from "../google-calendar-ui-model";

const mocks = vi.hoisted(() => ({
  actions: null as GoogleCalendarControlActions | null,
  save: vi.fn(() => Promise.resolve({ ok: true as const })),
  refresh: vi.fn(() => Promise.resolve({ ok: true as const })),
  disconnect: vi.fn(() => Promise.resolve({ ok: true as const })),
  repair: vi.fn(() => Promise.resolve({ ok: true as const })),
  routerRefresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("../google-calendar-control", () => ({
  GoogleCalendarControl: ({ actions }: { actions: GoogleCalendarControlActions }) => {
    mocks.actions = actions;
    return null;
  },
}));

vi.mock("../google-calendar-actions", () => ({
  saveGoogleCalendarSelection: mocks.save,
  refreshGoogleCalendarCalendars: mocks.refresh,
  disconnectGoogleCalendar: mocks.disconnect,
  repairGoogleCalendarSync: mocks.repair,
}));

import { GoogleCalendarControlBoundary } from "../google-calendar-control-boundary";

afterEach(() => {
  cleanup();
  mocks.actions = null;
  mocks.save.mockClear();
  mocks.refresh.mockClear();
  mocks.disconnect.mockClear();
  mocks.repair.mockClear();
  mocks.routerRefresh.mockClear();
  mocks.toast.mockClear();
  vi.restoreAllMocks();
});

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

describe("GoogleCalendarControlBoundary", () => {
  it("uses only the fixed OAuth routes for connect, reconnect, and confirmed switch", async () => {
    setOnline(true);
    const navigate = vi.fn();
    render(
      <GoogleCalendarControlBoundary model={{ status: "not_connected" }} navigate={navigate} />,
    );
    const actions = mocks.actions;
    if (!actions) throw new Error("actions were not captured");

    await actions.connect();
    await actions.reconnect();
    await actions.confirmAccountSwitch();

    expect(navigate.mock.calls).toEqual([
      ["/api/integrations/google-calendar/connect?intent=connect"],
      ["/api/integrations/google-calendar/connect?intent=reconnect"],
      ["/api/integrations/google-calendar/connect?intent=switch_account"],
    ]);
  });

  it("blocks navigation and writes while offline", async () => {
    setOnline(false);
    const navigate = vi.fn();
    render(
      <GoogleCalendarControlBoundary model={{ status: "not_connected" }} navigate={navigate} />,
    );
    const actions = mocks.actions;
    if (!actions) throw new Error("actions were not captured");
    const selection = {
      destinationSelectionKey: "00000000-0000-4000-8000-000000000001",
      busySelectionKeys: ["00000000-0000-4000-8000-000000000001"],
    };

    await expect(actions.connect()).resolves.toEqual({ ok: false, reason: "offline" });
    await expect(actions.saveSelection(selection)).resolves.toEqual({
      ok: false,
      reason: "offline",
    });
    await expect(actions.refreshCalendars()).resolves.toEqual({
      ok: false,
      reason: "offline",
    });
    await expect(actions.disconnect()).resolves.toEqual({ ok: false, reason: "offline" });
    await expect(actions.repairSync()).resolves.toEqual({ ok: false, reason: "offline" });
    expect(navigate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.repair).not.toHaveBeenCalled();
  });

  it("forwards only opaque selection keys to the server action", async () => {
    setOnline(true);
    render(
      <GoogleCalendarControlBoundary model={{ status: "not_connected" }} navigate={vi.fn()} />,
    );
    const actions = mocks.actions;
    if (!actions) throw new Error("actions were not captured");
    const selection = {
      destinationSelectionKey: "00000000-0000-4000-8000-000000000001",
      busySelectionKeys: ["00000000-0000-4000-8000-000000000002"],
    };

    await actions.saveSelection(selection);
    await actions.refreshCalendars();
    await actions.disconnect();
    await actions.repairSync();

    expect(mocks.save).toHaveBeenCalledWith(selection);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.repair).toHaveBeenCalledWith({ forcePending: true });
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("automatically wakes due retries while a connected calendar is still syncing", async () => {
    setOnline(true);
    render(
      <GoogleCalendarControlBoundary
        model={{
          status: "connected",
          accountLabel: "producer@example.test",
          calendars: [],
          selection: {
            destinationSelectionKey: "00000000-0000-4000-8000-000000000001",
            busySelectionKeys: ["00000000-0000-4000-8000-000000000001"],
          },
          syncSummary: {
            syncing: 1,
            notSynced: 0,
            missing: 0,
            conflicts: 0,
            issues: [],
          },
        }}
        navigate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mocks.repair).toHaveBeenCalledWith({ forcePending: false });
    });
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("checks again after the short retry window while work is still pending", async () => {
    vi.useFakeTimers();
    try {
      setOnline(true);
      const view = render(
        <GoogleCalendarControlBoundary
          model={{
            status: "connected",
            accountLabel: "producer@example.test",
            calendars: [],
            selection: {
              destinationSelectionKey: "00000000-0000-4000-8000-000000000001",
              busySelectionKeys: ["00000000-0000-4000-8000-000000000001"],
            },
            syncSummary: {
              syncing: 1,
              notSynced: 0,
              missing: 0,
              conflicts: 0,
              issues: [],
            },
          }}
          navigate={vi.fn()}
        />,
      );

      await act(async () => Promise.resolve());
      expect(mocks.repair).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(mocks.repair).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only fixed callback feedback", () => {
    render(
      <GoogleCalendarControlBoundary
        model={{ status: "not_connected" }}
        callbackStatus="wrong-account"
        navigate={vi.fn()}
      />,
    );

    expect(mocks.toast).toHaveBeenCalledWith(
      "Choose the Google account already connected to Skitza.",
      "error",
    );
  });
});
