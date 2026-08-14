// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionListItem } from "../session-row";
import { SessionManagementSheet } from "../session-management-sheet";

const mocks = vi.hoisted(() => ({
  cancelSession: vi.fn(),
  getSessionRescheduleAvailability: vi.fn(),
  previewSessionReschedule: vi.fn(),
  refresh: vi.fn(),
  rescheduleSession: vi.fn(),
  setSessionTitle: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("../calendar-actions", () => ({
  cancelSession: mocks.cancelSession,
  getSessionRescheduleAvailability: mocks.getSessionRescheduleAvailability,
  previewSessionReschedule: mocks.previewSessionReschedule,
  rescheduleSession: mocks.rescheduleSession,
  setSessionTitle: mocks.setSessionTitle,
}));

const session: SessionListItem = {
  id: "session-1",
  artistName: "Lior Tansky",
  artistEmail: "lior@example.com",
  startsAt: "2026-08-11T07:00:00.000Z",
  durationMin: 240,
  title: "Full production",
  packageName: "Full production",
  status: "confirmed",
  billingTreatment: "included",
  artistRsvpStatus: "accepted",
};

const availabilityResult = {
  ok: true as const,
  availability: {
    studioTimeZone: "Asia/Jerusalem",
    durationMin: 240,
    today: "2026-08-10",
    googleCalendarProtection: "active" as const,
    days: [
      {
        date: "2026-08-13",
        slots: [
          {
            startsAt: "2026-08-13T11:30:00.000Z",
            endsAt: "2026-08-13T15:30:00.000Z",
            studioDate: "2026-08-13",
            studioStartMin: 870,
          },
          {
            startsAt: "2026-08-13T12:00:00.000Z",
            endsAt: "2026-08-13T16:00:00.000Z",
            studioDate: "2026-08-13",
            studioStartMin: 900,
          },
        ],
      },
      { date: "2026-08-14", slots: [] },
    ],
  },
};

const warningPreview = {
  ok: true as const,
  preview: {
    hardConflicts: [],
    warnings: [{ code: "OUTSIDE_AVAILABILITY", message: "Outside normal hours." }],
    googleCalendarProtection: "active" as const,
  },
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-10T12:00:00.000Z").getTime());
  installMatchMedia(false);
  mocks.cancelSession.mockReset().mockResolvedValue({ ok: true });
  mocks.getSessionRescheduleAvailability.mockReset().mockResolvedValue(availabilityResult);
  mocks.previewSessionReschedule.mockReset().mockResolvedValue(warningPreview);
  mocks.refresh.mockReset();
  mocks.rescheduleSession
    .mockReset()
    .mockResolvedValue({ ok: true, googleCalendarProtection: "active" });
  mocks.setSessionTitle.mockReset().mockResolvedValue({ ok: true });
  mocks.toast.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installMatchMedia(desktop: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(min-width: 640px)" ? desktop : false,
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

function renderSheet(
  onOpenChange = vi.fn(),
  initialStep: "summary" | "reschedule" | "cancel" = "summary",
  sessionOverride: SessionListItem = session,
) {
  return render(
    <SessionManagementSheet
      open
      onOpenChange={onOpenChange}
      session={sessionOverride}
      initialStep={initialStep}
      timeZone="Asia/Jerusalem"
    />,
  );
}

describe("SessionManagementSheet", () => {
  it("reschedules from the mobile summary with exact slots, warning review, back, and save", async () => {
    const onOpenChange = vi.fn();
    renderSheet(onOpenChange);

    expect(document.querySelector('[data-native-sheet="bottom"]')).not.toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getAllByText("Full production")).toHaveLength(2);
    expect(screen.getByText("Included session")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    await screen.findByRole("listbox", { name: "Date" });
    expect(screen.getByRole("heading", { name: "Reschedule session" }).className).toContain(
      "whitespace-nowrap",
    );
    expect(screen.getByRole("heading", { name: "Reschedule session" }).className).toContain(
      "text-[21px]",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Reschedule session" }),
    );

    expect(mocks.getSessionRescheduleAvailability).toHaveBeenCalledWith({ id: "session-1" });
    expect(
      screen.getByRole("option", { name: /Fri 14 Aug, unavailable/ }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "15:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Reschedule session" }));

    await waitFor(() => {
      expect(mocks.previewSessionReschedule).toHaveBeenCalledWith({
        id: "session-1",
        studioDate: "2026-08-13",
        studioStartMin: 900,
        startsAtIso: "2026-08-13T12:00:00.000Z",
      });
    });
    expect(await screen.findByText("Outside normal hours.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Review new time" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    const backToTime = screen.getByRole<HTMLButtonElement>("button", {
      name: "Back to time selection",
    });
    await waitFor(() => {
      expect(backToTime.disabled).toBe(false);
    });
    fireEvent.click(backToTime);
    expect(screen.getByRole("listbox", { name: "Start" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Reschedule session" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reschedule session" }));
    expect(await screen.findByText("Outside normal hours.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Reschedule anyway" }));

    await waitFor(() => {
      expect(mocks.rescheduleSession).toHaveBeenCalledTimes(1);
    });
    expect(mocks.rescheduleSession.mock.calls[0]?.[0]).toMatchObject({
      id: "session-1",
      studioDate: "2026-08-13",
      studioStartMin: 900,
      startsAtIso: "2026-08-13T12:00:00.000Z",
      acknowledgedWarnings: ["OUTSIDE_AVAILABILITY"],
      acknowledgedReducedGoogleProtection: false,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps cancellation inline in the desktop sheet and recovers from a transport failure", async () => {
    installMatchMedia(true);
    const onOpenChange = vi.fn();
    mocks.cancelSession
      .mockRejectedValueOnce(new Error("connection dropped"))
      .mockResolvedValueOnce({ ok: true });
    renderSheet(onOpenChange);

    expect(document.querySelector('[data-native-sheet="right"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Cancel session" }));
    expect(screen.getByText(/This frees the slot/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Schedule conflict" }));
    fireEvent.change(screen.getByLabelText("Note for the artist (optional)"), {
      target: { value: "Please choose another day." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not cancel this session. Please try again.",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel session" }));

    await waitFor(() => {
      expect(mocks.cancelSession).toHaveBeenCalledTimes(2);
    });
    expect(mocks.cancelSession).toHaveBeenLastCalledWith({
      id: "session-1",
      reason: "Schedule conflict",
      note: "Please choose another day.",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("updates the stored title from the session sheet", async () => {
    const onOpenChange = vi.fn();
    renderSheet(onOpenChange);

    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Edit session title" }),
    );
    fireEvent.change(screen.getByLabelText("Session title"), {
      target: { value: "  Updated mix review  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save title" }));

    await waitFor(() => {
      expect(mocks.setSessionTitle).toHaveBeenCalledWith({
        id: "session-1",
        title: "Updated mix review",
      });
    });
    expect(mocks.toast).toHaveBeenCalledWith("Session title updated.", "success");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows recoverable inline errors for availability, preview, and save transport failures", async () => {
    mocks.getSessionRescheduleAvailability
      .mockRejectedValueOnce(new Error("availability transport"))
      .mockResolvedValueOnce(availabilityResult);
    mocks.previewSessionReschedule
      .mockRejectedValueOnce(new Error("preview transport"))
      .mockResolvedValueOnce({
        ok: true,
        preview: {
          hardConflicts: [],
          warnings: [],
          googleCalendarProtection: "active",
        },
      });
    mocks.rescheduleSession.mockRejectedValueOnce(new Error("save transport"));
    renderSheet(vi.fn(), "reschedule");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load available times. Please try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to session details" }));
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    await screen.findByRole("listbox", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: "Reschedule session" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not check this new time. Please try again.",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reschedule session" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not reschedule this session. Please try again.",
    );
    expect(screen.getByRole("listbox", { name: "Date" })).toBeTruthy();
  });

  it("keeps ended confirmed sessions view-only, including a direct reschedule entry", () => {
    const endedSession: SessionListItem = {
      ...session,
      startsAt: "2020-08-11T07:00:00.000Z",
    };
    renderSheet(vi.fn(), "reschedule", endedSession);

    expect(screen.getByRole("heading", { name: "Session details" })).toBeTruthy();
    expect(screen.getByText("This session has ended. Its details are view-only.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reschedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel session" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(mocks.getSessionRescheduleAvailability).not.toHaveBeenCalled();
  });

  it("locks dismissal and wheels during preview, then saves the immutable reviewed time", async () => {
    const onOpenChange = vi.fn();
    let resolvePreview!: (value: typeof warningPreview) => void;
    const previewPromise = new Promise<typeof warningPreview>((resolve) => {
      resolvePreview = resolve;
    });
    mocks.previewSessionReschedule.mockReturnValue(previewPromise);
    renderSheet(onOpenChange, "reschedule");
    await screen.findByRole("listbox", { name: "Start" });
    expect(screen.getByRole("listbox", { name: "Date" }).dataset.emphasis).toBe("prominent");
    expect(screen.getByRole("listbox", { name: "Start" }).dataset.emphasis).toBe("prominent");

    fireEvent.click(screen.getByRole("option", { name: "15:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Reschedule session" }));
    await waitFor(() => {
      expect(screen.getByTestId("session-management-controls").hasAttribute("inert")).toBe(true);
    });
    fireEvent.click(screen.getByRole("option", { name: "14:30" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolvePreview(warningPreview);
      await previewPromise;
    });
    fireEvent.click(await screen.findByRole("button", { name: "Reschedule anyway" }));
    await waitFor(() => {
      expect(mocks.rescheduleSession).toHaveBeenCalledTimes(1);
    });
    expect(mocks.rescheduleSession.mock.calls[0]?.[0]).toMatchObject({
      studioStartMin: 900,
      startsAtIso: "2026-08-13T12:00:00.000Z",
      acknowledgedReducedGoogleProtection: false,
    });
  });

  it("requires an explicit second review when final Google protection becomes reduced", async () => {
    mocks.previewSessionReschedule.mockResolvedValue({
      ok: true,
      preview: {
        hardConflicts: [],
        warnings: [],
        googleCalendarProtection: "active",
      },
    });
    mocks.rescheduleSession
      .mockResolvedValueOnce({
        ok: false,
        error: "Google availability changed. Review reduced protection before continuing.",
        requiresReducedGoogleProtectionReview: true,
      })
      .mockResolvedValueOnce({ ok: true, googleCalendarProtection: "reduced" });
    renderSheet(vi.fn(), "reschedule");
    await screen.findByRole("listbox", { name: "Start" });
    fireEvent.click(screen.getByRole("button", { name: "Reschedule session" }));

    expect(await screen.findByRole("heading", { name: "Review new time" })).toBeTruthy();
    expect(screen.getByText(/Google busy-time check is limited/i)).toBeTruthy();
    expect(mocks.rescheduleSession.mock.calls[0]?.[0]).toMatchObject({
      acknowledgedReducedGoogleProtection: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Save new time" }));
    await waitFor(() => {
      expect(mocks.rescheduleSession).toHaveBeenCalledTimes(2);
    });
    expect(mocks.rescheduleSession.mock.calls[1]?.[0]).toMatchObject({
      acknowledgedReducedGoogleProtection: true,
    });
  });
});
