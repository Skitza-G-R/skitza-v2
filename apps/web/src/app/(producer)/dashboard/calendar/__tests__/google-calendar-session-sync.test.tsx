// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GoogleCalendarSessionSyncStatus,
  LiveGoogleCalendarSessionSyncStatus,
} from "../google-calendar-session-sync";

type ActionInput = { id: string; operationKey: string };
type ActionResult =
  | { ok: true; status: "not_synced" | "missing" | "conflict"; replayed: boolean }
  | { ok: false; error: string };
type SyncState = "pending" | "synced" | "not_synced" | "missing" | "conflict" | "disconnected";

const mocks = vi.hoisted(() => ({
  retry: vi.fn<(input: ActionInput) => Promise<ActionResult>>(),
  restore: vi.fn<(input: ActionInput) => Promise<ActionResult>>(),
  status: vi.fn<
    (input: { id: string }) => Promise<{ ok: true; status: SyncState | null } | { ok: false }>
  >(),
}));

vi.mock("../google-calendar-session-actions", () => ({
  retryGoogleCalendarSync: mocks.retry,
  restoreGoogleCalendarEvent: mocks.restore,
  getGoogleCalendarSyncStatus: mocks.status,
}));

beforeEach(() => {
  installViewport(true);
  mocks.status.mockResolvedValue({ ok: false });
});

afterEach(() => {
  cleanup();
  mocks.retry.mockReset();
  mocks.restore.mockReset();
  mocks.status.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function installViewport(isMobile: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(max-width: 1023px)" ? isMobile : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  );
}

describe("GoogleCalendarSessionSyncStatus", () => {
  it("keeps healthy rows quiet and explains every recovery state safely", () => {
    const { rerender } = render(
      <GoogleCalendarSessionSyncStatus bookingId="booking-1" sync={{ state: "synced" }} />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<GoogleCalendarSessionSyncStatus bookingId="booking-1" sync={{ state: "pending" }} />);
    expect(screen.getByText("Syncing calendar")).not.toBeNull();

    rerender(
      <GoogleCalendarSessionSyncStatus bookingId="booking-1" sync={{ state: "conflict" }} />,
    );
    expect(
      screen.getByText("Google change couldn’t be applied. Skitza time was kept."),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeNull();

    rerender(
      <GoogleCalendarSessionSyncStatus bookingId="booking-1" sync={{ state: "disconnected" }} />,
    );
    expect(screen.getByText("Google disconnected. Reconnect above to sync.")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("clears the pending badge automatically when calendar delivery completes", async () => {
    vi.useFakeTimers();
    mocks.status.mockResolvedValue({ ok: true, status: "synced" });
    render(
      <LiveGoogleCalendarSessionSyncStatus
        bookingId="booking-live"
        sync={{ state: "pending" }}
      />,
    );

    expect(screen.getByText("Syncing calendar")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(mocks.status).toHaveBeenCalledWith({ id: "booking-live" });
    expect(screen.queryByText("Syncing calendar")).toBeNull();
  });

  it("starts polling again for a later pending server snapshot", async () => {
    vi.useFakeTimers();
    mocks.status.mockResolvedValue({ ok: true, status: "synced" });
    const { rerender } = render(
      <LiveGoogleCalendarSessionSyncStatus
        bookingId="booking-repeat"
        sync={{ state: "pending" }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(screen.queryByText("Syncing calendar")).toBeNull();
    mocks.status.mockClear();

    rerender(
      <LiveGoogleCalendarSessionSyncStatus
        bookingId="booking-repeat"
        sync={{ state: "pending" }}
      />,
    );
    expect(screen.getByText("Syncing calendar")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Syncing calendar")).toBeNull();
  });

  it("never polls from the CSS-hidden mobile row on desktop", async () => {
    vi.useFakeTimers();
    installViewport(false);
    mocks.status.mockResolvedValue({ ok: true, status: "synced" });
    render(
      <LiveGoogleCalendarSessionSyncStatus
        bookingId="booking-desktop"
        sync={{ state: "pending" }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(mocks.status).not.toHaveBeenCalled();
    expect(screen.getByText("Syncing calendar")).not.toBeNull();
  });

  it("polls a retry through its retained conflict state until it completes", async () => {
    vi.useFakeTimers();
    mocks.retry.mockResolvedValue({ ok: true, status: "conflict", replayed: false });
    mocks.status
      .mockResolvedValueOnce({ ok: true, status: "conflict" })
      .mockResolvedValueOnce({ ok: true, status: "synced" });
    const { rerender } = render(
      <LiveGoogleCalendarSessionSyncStatus
        bookingId="booking-conflict"
        sync={{ state: "conflict" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(() => Promise.resolve());
    expect(screen.getByText("Syncing calendar")).not.toBeNull();

    rerender(
      <LiveGoogleCalendarSessionSyncStatus
        bookingId="booking-conflict"
        sync={{ state: "conflict" }}
      />,
    );
    expect(screen.getByText("Syncing calendar")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Syncing calendar")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Syncing calendar")).toBeNull();
  });

  it("polls a restore through its retained missing state until it completes", async () => {
    vi.useFakeTimers();
    mocks.restore.mockResolvedValue({ ok: true, status: "missing", replayed: false });
    mocks.status
      .mockResolvedValueOnce({ ok: true, status: "missing" })
      .mockResolvedValueOnce({ ok: true, status: "synced" });
    render(
      <LiveGoogleCalendarSessionSyncStatus
        bookingId="booking-missing"
        sync={{ state: "missing" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore event" }));
    await act(() => Promise.resolve());
    expect(screen.getByText("Syncing calendar")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Syncing calendar")).toBeNull();
  });

  it("keeps retry locked after success until the visible server state changes", async () => {
    let finish: ((value: { ok: true; status: "not_synced"; replayed: false }) => void) | undefined;
    mocks.retry.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <GoogleCalendarSessionSyncStatus bookingId="booking-1" sync={{ state: "not_synced" }} />,
    );

    const retry = screen.getByRole<HTMLButtonElement>("button", { name: "Retry" });
    expect(retry.className).toContain("h-11");
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(mocks.retry).toHaveBeenCalledTimes(1);
    const retryInput = mocks.retry.mock.calls[0]?.[0];
    expect(retryInput?.id).toBe("booking-1");
    expect(retryInput?.operationKey).toMatch(/^producer-google-retry:booking-1:/);
    expect(retry.disabled).toBe(true);

    await act(async () => {
      finish?.({ ok: true, status: "not_synced", replayed: false });
      await Promise.resolve();
    });
    expect(screen.getByRole("status").textContent).toContain("retry started");
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });

  it("reuses the same operation key after a safe failure", async () => {
    mocks.retry
      .mockResolvedValueOnce({ ok: false, error: "Could not retry calendar sync. Try again." })
      .mockResolvedValueOnce({ ok: true, status: "not_synced", replayed: false });
    render(
      <GoogleCalendarSessionSyncStatus bookingId="booking-retry" sync={{ state: "not_synced" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(() => Promise.resolve());
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(() => Promise.resolve());

    expect(mocks.retry).toHaveBeenCalledTimes(2);
    expect(mocks.retry.mock.calls[1]?.[0].operationKey).toBe(
      mocks.retry.mock.calls[0]?.[0].operationKey,
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Started" }).disabled).toBe(true);
  });

  it("unlocks with a new operation key after the server-rendered state changes", async () => {
    mocks.retry.mockResolvedValue({ ok: true, status: "not_synced", replayed: false });
    const { rerender } = render(
      <GoogleCalendarSessionSyncStatus bookingId="booking-state" sync={{ state: "not_synced" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(() => Promise.resolve());
    const firstKey = mocks.retry.mock.calls[0]?.[0].operationKey;

    rerender(
      <GoogleCalendarSessionSyncStatus bookingId="booking-state" sync={{ state: "conflict" }} />,
    );
    const retry = screen.getByRole<HTMLButtonElement>("button", { name: "Retry" });
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    await act(() => Promise.resolve());

    expect(mocks.retry).toHaveBeenCalledTimes(2);
    expect(mocks.retry.mock.calls[1]?.[0].operationKey).not.toBe(firstKey);
  });

  it("restores a missing event without hiding the existing session", async () => {
    mocks.restore.mockResolvedValue({ ok: true, status: "missing", replayed: false });
    render(<GoogleCalendarSessionSyncStatus bookingId="booking-2" sync={{ state: "missing" }} />);

    expect(screen.getByText("Google event missing")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore event" }));
    await act(() => Promise.resolve());

    const restoreInput = mocks.restore.mock.calls[0]?.[0];
    expect(restoreInput?.id).toBe("booking-2");
    expect(restoreInput?.operationKey).toMatch(/^producer-google-restore:booking-2:/);
    expect(screen.getByRole("status").textContent).toContain("restore started");
  });
});
