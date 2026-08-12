// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleCalendarControl } from "../google-calendar-control";
import type {
  GoogleCalendarActionResult,
  GoogleCalendarControlActions,
  GoogleCalendarOption,
  GoogleCalendarUiModel,
} from "../google-calendar-ui-model";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const calendars: readonly GoogleCalendarOption[] = [
  {
    selectionKey: "safe-primary",
    name: "Studio sessions",
    timeZone: "Asia/Jerusalem",
    accessRole: "owner",
    primary: true,
  },
  {
    selectionKey: "safe-writer",
    name: "Writer calendar",
    timeZone: "Europe/London",
    accessRole: "writer",
    primary: false,
  },
  {
    selectionKey: "safe-limited",
    name: "Limited writer calendar",
    timeZone: "America/New_York",
    accessRole: "writer_without_private_access",
    primary: false,
  },
  {
    selectionKey: "safe-reader",
    name: "Reader calendar",
    timeZone: "Europe/Paris",
    accessRole: "reader",
    primary: false,
  },
  {
    selectionKey: "safe-free-busy",
    name: "Free busy calendar",
    timeZone: "UTC",
    accessRole: "free_busy_reader",
    primary: false,
  },
];
const syncSummary = {
  syncing: 0,
  notSynced: 0,
  missing: 0,
  conflicts: 0,
  issues: [],
} as const;

function success(): Promise<GoogleCalendarActionResult> {
  return Promise.resolve({ ok: true });
}

function actionSet(
  overrides: Partial<GoogleCalendarControlActions> = {},
): GoogleCalendarControlActions {
  return {
    connect: vi.fn(success),
    refreshCalendars: vi.fn(success),
    saveSelection: vi.fn(success),
    reconnect: vi.fn(success),
    confirmAccountSwitch: vi.fn(success),
    disconnect: vi.fn(success),
    repairSync: vi.fn(success),
    ...overrides,
  };
}

function connectedModel(): Extract<GoogleCalendarUiModel, { status: "connected" }> {
  return {
    status: "connected",
    accountLabel: "producer@example.test",
    syncSummary,
    calendars,
    selection: {
      destinationSelectionKey: "safe-primary",
      busySelectionKeys: ["safe-primary", "safe-free-busy"],
    },
  };
}

afterEach(() => {
  cleanup();
  mocks.toast.mockReset();
});

describe("GoogleCalendarControl", () => {
  it("opens the not-connected explanation and keeps connect single-flight", async () => {
    let resolveConnect: ((result: GoogleCalendarActionResult) => void) | undefined;
    const connect = vi.fn(
      () =>
        new Promise<GoogleCalendarActionResult>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const actions = actionSet({ connect });
    render(<GoogleCalendarControl model={{ status: "not_connected" }} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Google Calendar" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("How Skitza uses your Google data")).not.toBeNull();
    expect(within(dialog).getByText(/reads your Google account email/i)).not.toBeNull();
    expect(within(dialog).getByText(/checks only busy and free times/i)).not.toBeNull();
    expect(within(dialog).getByText(/create, update, read, and delete/i)).not.toBeNull();
    expect(within(dialog).getByText(/stores encrypted Google tokens/i)).not.toBeNull();
    expect(
      within(dialog).getByRole<HTMLAnchorElement>("link", { name: "Privacy Notice" }).getAttribute(
        "href",
      ),
    ).toBe("/privacy");

    const connectButton = within(dialog).getByRole("button", {
      name: "Connect Google Calendar",
    });
    fireEvent.click(connectButton);
    fireEvent.click(connectButton);

    expect(connect).toHaveBeenCalledTimes(1);
    expect((connectButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByRole("status").textContent).toContain("Connecting");

    await act(async () => {
      resolveConnect?.({ ok: true });
      await Promise.resolve();
    });
  });

  it("shows name, timezone, and role while allowing only owner or writer destinations", async () => {
    const saveSelection = vi.fn(success);
    const actions = actionSet({ saveSelection });
    const model: GoogleCalendarUiModel = {
      status: "selection_required",
      accountLabel: "producer@example.test",
      calendars,
      syncSummary,
      selection: { destinationSelectionKey: null, busySelectionKeys: [] },
    };
    render(<GoogleCalendarControl model={model} actions={actions} />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("Asia/Jerusalem").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Owner").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Writer (limited)").length).toBeGreaterThan(0);

    expect(
      within(dialog).getByRole<HTMLInputElement>("radio", { name: /Studio sessions/ }).disabled,
    ).toBe(false);
    expect(
      within(dialog).getByRole<HTMLInputElement>("radio", { name: /Writer calendar/ }).disabled,
    ).toBe(false);
    expect(
      within(dialog).getByRole<HTMLInputElement>("radio", {
        name: /Limited writer calendar/,
      }).disabled,
    ).toBe(true);
    expect(
      within(dialog).getByRole<HTMLInputElement>("radio", { name: /Reader calendar/ }).disabled,
    ).toBe(true);
    expect(
      within(dialog).getByRole<HTMLInputElement>("radio", { name: /Free busy calendar/ }).disabled,
    ).toBe(true);

    const saveButton = within(dialog).getByRole("button", { name: "Save calendars" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole("radio", { name: /Writer calendar/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Limited writer calendar/ }));
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    await act(() => Promise.resolve());
    expect(saveSelection).toHaveBeenCalledWith({
      destinationSelectionKey: "safe-writer",
      busySelectionKeys: ["safe-limited"],
    });
    expect(mocks.toast).toHaveBeenCalledWith("Calendar choices saved.", "success");
  });

  it("offers retry and reconnect when the saved connection has no calendars", async () => {
    const refreshCalendars = vi.fn(success);
    const reconnect = vi.fn(success);
    render(
      <GoogleCalendarControl
        model={{
          status: "selection_required",
          accountLabel: "producer@example.test",
          calendars: [],
          syncSummary,
          selection: { destinationSelectionKey: null, busySelectionKeys: [] },
        }}
        actions={actionSet({ refreshCalendars, reconnect })}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Calendars could not load" }),
    ).not.toBeNull();
    expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
    expect(within(dialog).getByText(/Your Google connection is saved/i)).not.toBeNull();
    expect(within(dialog).getByText("How Skitza uses your Google data")).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Try loading again" }));
    await act(() => Promise.resolve());
    expect(refreshCalendars).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith("Calendar list refreshed.", "success");

    fireEvent.click(within(dialog).getByRole("button", { name: "Reconnect Google" }));
    await act(() => Promise.resolve());
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("shows the configured destination and busy calendars before editing", () => {
    render(<GoogleCalendarControl model={connectedModel()} actions={actionSet()} defaultOpen />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Google Calendar" })).not.toBeNull();
    expect(within(dialog).getByText("producer@example.test")).not.toBeNull();
    expect(within(dialog).getByRole("heading", { name: "Calendar setup" })).not.toBeNull();
    expect(within(dialog).getByText("Events go to")).not.toBeNull();
    expect(within(dialog).getByText("Busy time comes from")).not.toBeNull();
    expect(within(dialog).getAllByText("Studio sessions").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Studio sessions, Free busy calendar/)).not.toBeNull();
    expect(within(dialog).getByText("Calendar sync is up to date")).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit calendars" }));
    expect(within(dialog).getByRole("heading", { name: "Choose calendars" })).not.toBeNull();
    expect(
      within(dialog).getByRole<HTMLInputElement>("radio", { name: /Studio sessions/ }).checked,
    ).toBe(true);
  });

  it("shows the affected session in plain language and lets the producer retry", async () => {
    const repairSync = vi.fn(success);
    render(
      <GoogleCalendarControl
        model={{
          ...connectedModel(),
          syncSummary: {
            syncing: 1,
            notSynced: 1,
            missing: 2,
            conflicts: 1,
            issues: [
              {
                bookingId: "00000000-0000-4000-8000-000000000201",
                syncState: "missing",
                bookingStatus: "cancelled",
                artistName: "Lior Tansky",
                startsAtIso: "2026-08-16T07:00:00.000Z",
                durationMin: 240,
              },
            ],
          },
        }}
        actions={actionSet({ repairSync })}
        timeZone="Asia/Jerusalem"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "4 sync issues" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("4 sessions need attention")).not.toBeNull();
    expect(within(dialog).getByText("1 syncing")).not.toBeNull();
    expect(
      within(dialog).getByText("Skitza keeps trying automatically. Your session times are safe."),
    ).not.toBeNull();
    expect(within(dialog).getByText("Lior Tansky")).not.toBeNull();
    expect(within(dialog).getByText(/Cancelled session cleanup is waiting/)).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Try sync again" }));
    await act(() => Promise.resolve());
    expect(repairSync).toHaveBeenCalledTimes(1);
  });

  it("renders reconnect safely without any configured calendar", async () => {
    const reconnect = vi.fn(success);
    render(
      <GoogleCalendarControl
        model={{
          status: "reconnect_required",
          accountLabel: "producer@example.test",
          syncSummary,
        }}
        actions={actionSet({ reconnect })}
        defaultOpen
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Google needs permission again. Your Skitza sessions are safe."),
    ).not.toBeNull();
    expect(within(dialog).getByText("How Skitza uses your Google data")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reconnect Google Calendar" }));
    await act(() => Promise.resolve());
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("confirms account switching locally and keeps cancellation inert", async () => {
    const confirmAccountSwitch = vi.fn(success);
    render(
      <GoogleCalendarControl
        model={connectedModel()}
        actions={actionSet({ confirmAccountSwitch })}
        defaultOpen
      />,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch account" }));
    expect(within(dialog).getByRole("heading", { name: "Switch Google account?" })).not.toBeNull();
    expect(within(dialog).getByText("Choose in Google")).not.toBeNull();
    expect(within(dialog).getByText("How Skitza uses your Google data")).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep current account" }));
    expect(confirmAccountSwitch).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Switch account" })).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Switch account" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch and choose calendars" }));
    await act(() => Promise.resolve());
    expect(confirmAccountSwitch).toHaveBeenCalledTimes(1);
  });

  it("lets a disconnected account reconnect or explicitly confirm a different account", async () => {
    const connect = vi.fn(success);
    const confirmAccountSwitch = vi.fn(success);
    render(
      <GoogleCalendarControl
        model={{ status: "disconnected", accountLabel: "producer@example.test", syncSummary }}
        actions={actionSet({ connect, confirmAccountSwitch })}
        defaultOpen
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Google Calendar is disconnected" }),
    ).not.toBeNull();
    expect(within(dialog).getByText("Previous account")).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reconnect previous account" }));
    await act(() => Promise.resolve());
    expect(connect).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Switch account" }));
    expect(within(dialog).getByText("Previous")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch and choose calendars" }));
    await act(() => Promise.resolve());
    expect(confirmAccountSwitch).toHaveBeenCalledTimes(1);
  });

  it("requires a separate disconnect confirmation and leaves existing work clear", async () => {
    const disconnect = vi.fn(success);
    render(
      <GoogleCalendarControl
        model={connectedModel()}
        actions={actionSet({ disconnect })}
        defaultOpen
      />,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    expect(within(dialog).getByText(/Disconnecting stops future Google access/i)).not.toBeNull();
    expect(within(dialog).getByText(/removes its saved Google access tokens/i)).not.toBeNull();
    expect(within(dialog).getByText(/keeps the connected account email/i)).not.toBeNull();
    expect(
      within(dialog)
        .getByRole<HTMLAnchorElement>("link", { name: "privacy@skitza.app" })
        .getAttribute("href"),
    ).toBe("mailto:privacy@skitza.app");
    expect(
      within(dialog)
        .getByRole<HTMLAnchorElement>("link", {
          name: /Google Account's third-party connections/i,
        })
        .getAttribute("href"),
    ).toBe("https://myaccount.google.com/connections");

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep connected" }));
    expect(disconnect).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await act(() => Promise.resolve());
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith("Google Calendar disconnected.", "success");
  });

  it("maps action failures to fixed safe copy", async () => {
    const reconnect = vi.fn(() => Promise.reject(new Error("raw provider response")));
    render(
      <GoogleCalendarControl
        model={{
          status: "reconnect_required",
          accountLabel: "producer@example.test",
          syncSummary,
        }}
        actions={actionSet({ reconnect })}
        defaultOpen
      />,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reconnect Google Calendar" }));
    await act(() => Promise.resolve());

    expect(within(dialog).getByRole("status").textContent).toBe(
      "Could not reconnect Google Calendar. Try again.",
    );
    expect(dialog.textContent).not.toContain("raw provider response");
  });
});
