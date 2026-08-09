// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleCalendarSessionSyncStatus } from "../google-calendar-session-sync";

type ActionInput = { id: string; operationKey: string };
type ActionResult =
  | { ok: true; status: "not_synced" | "missing" | "conflict"; replayed: boolean }
  | { ok: false; error: string };

const mocks = vi.hoisted(() => ({
  retry: vi.fn<(input: ActionInput) => Promise<ActionResult>>(),
  restore: vi.fn<(input: ActionInput) => Promise<ActionResult>>(),
}));

vi.mock("../google-calendar-session-actions", () => ({
  retryGoogleCalendarSync: mocks.retry,
  restoreGoogleCalendarEvent: mocks.restore,
}));

afterEach(() => {
  cleanup();
  mocks.retry.mockReset();
  mocks.restore.mockReset();
});

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
