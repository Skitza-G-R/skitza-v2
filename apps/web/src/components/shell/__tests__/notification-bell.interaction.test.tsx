// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShellNotificationItem } from "~/server/shell-data";

const mocks = vi.hoisted(() => ({
  archiveAll: vi.fn(),
  archiveOne: vi.fn(),
  markOne: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("../notification-bell-actions", () => ({
  archiveAllNotifications: mocks.archiveAll,
  archiveNotification: mocks.archiveOne,
  markNotificationRead: mocks.markOne,
}));

import { NotificationBell } from "../notification-bell";

const notifications: readonly ShellNotificationItem[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "comment_created",
    title: "New mix comment",
    body: "The bridge note is ready.",
    createdAtIso: "2026-08-04T08:00:00.000Z",
    projectId: "project-1",
    trackVersionId: "version-1",
    commentId: "comment-1",
    bookingId: null,
    purchaseRequestId: null,
    purchaseId: null,
    paymentProofId: null,
    readAtIso: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "booking_requested",
    title: "Read booking request",
    body: "Friday at ten.",
    createdAtIso: "2026-08-04T07:00:00.000Z",
    projectId: null,
    trackVersionId: null,
    commentId: null,
    bookingId: "booking-1",
    purchaseRequestId: null,
    purchaseId: null,
    paymentProofId: null,
    readAtIso: "2026-08-04T07:30:00.000Z",
  },
];

function renderOpenBell() {
  render(<NotificationBell unreadCount={1} notifications={notifications} />);
  const trigger = screen.getByTestId<HTMLButtonElement>("notification-bell-trigger");
  fireEvent.click(trigger);
  return trigger;
}

beforeEach(() => {
  mocks.archiveAll.mockReset();
  mocks.archiveOne.mockReset();
  mocks.markOne.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.archiveAll.mockResolvedValue({ ok: true });
  mocks.archiveOne.mockResolvedValue({ ok: true });
  mocks.markOne.mockResolvedValue({ ok: true });

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      media: "(min-width: 1024px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })) as typeof window.matchMedia,
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("producer NotificationBell dismissal", () => {
  it("opens on Unread by default while All retains read notifications", () => {
    renderOpenBell();

    expect(screen.getByRole("tab", { name: /Unread/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("New mix comment")).not.toBeNull();
    expect(screen.queryByText("Read booking request")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("Read booking request")).not.toBeNull();
  });

  it("removes one persisted item, synchronizes the badge, and does not navigate", async () => {
    const trigger = renderOpenBell();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss New mix comment" }));

    await waitFor(() => {
      expect(screen.queryByText("New mix comment")).toBeNull();
    });
    expect(mocks.archiveOne).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(trigger.getAttribute("aria-label")).toBe("Notifications");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the item and badge when dismissal fails", async () => {
    mocks.archiveOne.mockResolvedValueOnce({
      ok: false,
      error: "Notification couldn't be removed. Try again.",
    });
    const trigger = renderOpenBell();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss New mix comment" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Notification couldn't be removed. Try again.",
    );
    expect(screen.getByText("New mix comment")).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Notifications (1 unread)");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("Clear all removes active read and unread rows and is guarded while pending", async () => {
    let resolveClear: ((value: { ok: true }) => void) | undefined;
    mocks.archiveAll.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveClear = resolve;
        }),
    );
    const trigger = renderOpenBell();
    const clear = screen.getByRole<HTMLButtonElement>("button", { name: "Clear all" });

    fireEvent.click(clear);
    fireEvent.click(clear);
    expect(mocks.archiveAll).toHaveBeenCalledTimes(1);

    resolveClear?.({ ok: true });
    await waitFor(() => {
      expect(screen.getByText("You're all caught up.")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("No notifications yet.")).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Notifications");
  });

  it("keeps all rows and the badge when Clear all fails", async () => {
    mocks.archiveAll.mockResolvedValueOnce({
      ok: false,
      error: "Notifications couldn't be cleared. Try again.",
    });
    const trigger = renderOpenBell();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Notifications couldn't be cleared. Try again.",
    );
    expect(screen.getByText("New mix comment")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("Read booking request")).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Notifications (1 unread)");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("preserves notification navigation independently of the X control", async () => {
    renderOpenBell();

    fireEvent.click(screen.getByRole("button", { name: "New mix comment, unread" }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/dashboard/music/version-1");
    });
    expect(mocks.markOne).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mocks.archiveOne).not.toHaveBeenCalled();
  });
});
