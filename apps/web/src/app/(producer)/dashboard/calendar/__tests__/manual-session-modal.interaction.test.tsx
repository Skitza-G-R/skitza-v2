// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProducerManualSessionOptions } from "~/server/domain/session-booking/manual";

import type { ManualSessionDraft } from "../calendar-slot";
import { ManualSessionModal } from "../manual-session-modal";

const actionMocks = vi.hoisted(() => ({
  createManualSession: vi.fn(),
  getManualSessionAvailability: vi.fn(),
  previewManualSession: vi.fn(),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("../calendar-actions", () => ({
  createManualSession: actionMocks.createManualSession,
  getManualSessionAvailability: actionMocks.getManualSessionAvailability,
  previewManualSession: actionMocks.previewManualSession,
}));

const options: ProducerManualSessionOptions = {
  studioTimeZone: "Asia/Jerusalem",
  clients: [
    {
      id: "client-1",
      name: "Lior Tansky",
      email: "lior@example.com",
      projects: [
        {
          id: "project-included",
          title: "Album production",
          eligibility: "eligible",
          productName: "Full production",
          defaultTitle: "Album production",
          durationMin: 240,
          remainingIncluded: null,
          defaultTreatment: "included",
          allowedTreatments: ["included", "complimentary"],
        },
        {
          id: "project-exhausted",
          title: "Single production",
          eligibility: "eligible",
          productName: "Single production",
          defaultTitle: "Single production",
          durationMin: 120,
          remainingIncluded: 0,
          defaultTreatment: null,
          allowedTreatments: ["complimentary", "billable_extra"],
        },
      ],
    },
  ],
};

function exactAvailability(durationMin = 240, protection: "active" | "reduced" = "active") {
  return {
    ok: true as const,
    availability: {
      studioTimeZone: "Asia/Jerusalem",
      durationMin,
      today: "2026-08-10",
      googleCalendarProtection: protection,
      days: [
        {
          date: "2026-08-13",
          slots: [
            {
              startsAt: "2026-08-13T11:30:00.000Z",
              endsAt: new Date(
                new Date("2026-08-13T11:30:00.000Z").getTime() + durationMin * 60_000,
              ).toISOString(),
              studioDate: "2026-08-13",
              studioStartMin: 870,
            },
            {
              startsAt: "2026-08-13T12:00:00.000Z",
              endsAt: new Date(
                new Date("2026-08-13T12:00:00.000Z").getTime() + durationMin * 60_000,
              ).toISOString(),
              studioDate: "2026-08-13",
              studioStartMin: 900,
            },
          ],
        },
        { date: "2026-08-14", slots: [] },
      ],
    },
  };
}

beforeEach(() => {
  actionMocks.createManualSession.mockReset();
  actionMocks.getManualSessionAvailability.mockReset();
  actionMocks.previewManualSession.mockReset();
  actionMocks.getManualSessionAvailability.mockResolvedValue(exactAvailability());
  installMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function installMatchMedia(isDesktop: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(min-width: 640px)" ? isDesktop : false,
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

async function chooseClientAndProject(projectName = "Album production"): Promise<void> {
  fireEvent.click(screen.getByRole("option", { name: "Lior Tansky" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("option", { name: projectName }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("listbox", { name: "Date" });
}

function finishDateTimeStep(): void {
  const button = screen
    .getAllByRole("button", { name: "Done" })
    .find((candidate) => !candidate.hasAttribute("aria-expanded"));
  if (!button) throw new Error("Date and time Done button was not rendered");
  fireEvent.click(button);
}

describe("ManualSessionModal", () => {
  it("keeps the client prompt readable and preserves search focus when filtering a selection", async () => {
    const searchableOptions: ProducerManualSessionOptions = {
      ...options,
      clients: [
        ...(options.clients[0] ? [options.clients[0]] : []),
        ...Array.from({ length: 8 }, (_, index) => ({
          id: `client-${String(index + 2)}`,
          name: `Client ${String(index + 2)}`,
          email: `client-${String(index + 2)}@example.com`,
          projects: [],
        })),
      ],
    };
    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={searchableOptions}
        initialSlot={null}
      />,
    );

    const prompt = screen.getByRole("option", { name: "Choose a client" });
    expect(prompt.getAttribute("aria-disabled")).toBe("true");
    expect(prompt.className).not.toContain("opacity-45");

    fireEvent.click(screen.getByRole("option", { name: "Lior Tansky" }));
    const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search clients" });
    search.focus();
    fireEvent.change(search, { target: { value: "Client 2" } });

    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Continue" }).disabled).toBe(true);
  });

  it("uses progressive, separate client/project wheels and exact duration-aware time wheels", async () => {
    const drafts: Array<ManualSessionDraft | null> = [];
    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
        onDraftChange={(draft) => {
          drafts.push(draft);
        }}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Client" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Project" })).toBeNull();

    await chooseClientAndProject();

    expect(actionMocks.getManualSessionAvailability).toHaveBeenCalledWith({
      clientId: "client-1",
      projectId: "project-included",
    });
    expect(screen.getByRole("listbox", { name: "Date" })).not.toBe(
      screen.getByRole("listbox", { name: "Start" }),
    );
    expect(screen.getByRole("option", { name: "14:30" })).toBeTruthy();
    expect(drafts.at(-1)).toEqual({
      studioDate: "2026-08-13",
      studioStartMin: 870,
      durationMin: 240,
    });
  });

  it("shows the whole mobile accordion from step one and opens one section at a time", async () => {
    render(<ManualSessionModal open onOpenChange={vi.fn()} options={options} initialSlot={null} />);

    expect(screen.getByText("1 · Client")).toBeTruthy();
    expect(screen.getByText("2 · Project")).toBeTruthy();
    expect(screen.getByText("3 · Date & time")).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Client" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Project" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Choose project" }).disabled).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Choose date & time" }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("option", { name: "Lior Tansky" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("button", { name: "Change client" })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Project" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Client" })).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Choose date & time" }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("option", { name: "Album production" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("listbox", { name: "Date" });

    expect(screen.getByRole("button", { name: "Change client" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change project" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Project" })).toBeNull();
    expect(screen.getByRole("listbox", { name: "Start" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change project" }));

    expect(screen.getByRole("listbox", { name: "Project" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Client" })).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Date" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change client" }));

    expect(screen.getByRole("listbox", { name: "Client" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Project" })).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Date" })).toBeNull();
  });

  it("keeps date and time side by side, centered, and greys full dates on mobile", async () => {
    render(<ManualSessionModal open onOpenChange={vi.fn()} options={options} initialSlot={null} />);
    const mobileSheet = document.querySelector('[data-native-sheet="bottom"]');
    expect(mobileSheet).not.toBeNull();
    expect(mobileSheet?.className).toContain("!h-[calc(var(--sk-viewport-height,100dvh)-12px)]");
    expect(screen.queryByRole("button", { name: "Book session" })).toBeNull();

    await chooseClientAndProject();

    const dateWheel = screen.getByRole("listbox", { name: "Date" });
    const timeWheel = screen.getByRole("listbox", { name: "Start" });
    expect(dateWheel.parentElement?.parentElement?.parentElement?.className).toContain(
      "grid-cols-2",
    );
    expect(timeWheel.className).toContain("text-center");
    expect(dateWheel.dataset.emphasis).toBe("prominent");
    expect(timeWheel.dataset.emphasis).toBe("prominent");
    expect(screen.getByRole("option", { name: "14:30" }).className).toContain("text-center");
    expect(
      screen.getByRole("option", { name: /Fri 14 Aug, unavailable/ }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.queryByRole("option", { name: "00:00" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Book session" })).toBeNull();
    finishDateTimeStep();
    expect(screen.getByRole("button", { name: "Book session" })).toBeTruthy();
  });

  it("restores the legacy desktop drawer layout while keeping exact availability", async () => {
    installMatchMedia(true);
    render(<ManualSessionModal open onOpenChange={vi.fn()} options={options} initialSlot={null} />);
    await waitFor(() => {
      expect(document.querySelector('[data-native-sheet="right"]')).not.toBeNull();
    });
    expect(screen.getByTestId("manual-session-controls").dataset.desktopCalendarLayout).toBe(
      "legacy",
    );
    expect(screen.queryByText("1 · Client")).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Client" })).toBeNull();

    const client = screen.getByLabelText<HTMLSelectElement>("Client");
    const project = screen.getByLabelText<HTMLSelectElement>("Project");
    expect(project.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Book session" })).toBeTruthy();

    fireEvent.change(client, { target: { value: "client-1" } });
    expect(project.disabled).toBe(false);
    fireEvent.change(project, { target: { value: "project-included" } });

    const date = await screen.findByLabelText<HTMLSelectElement>("Date");
    const start = screen.getByLabelText<HTMLSelectElement>("Start");
    expect(actionMocks.getManualSessionAvailability).toHaveBeenCalledWith({
      clientId: "client-1",
      projectId: "project-included",
    });
    expect(date).not.toBe(start);
    expect(date.closest("#manual-time-editor")?.className).toContain("grid-cols-2");
    expect(start.value).toBe("2026-08-13T11:30:00.000Z");
    expect(screen.getByText("Session title")).toBeTruthy();
    expect(screen.getByText("Booking treatment")).toBeTruthy();
  });

  it("keeps title and billing progressive and requires a zero-credit choice", async () => {
    actionMocks.getManualSessionAvailability.mockResolvedValue(exactAvailability(120));
    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
      />,
    );
    await chooseClientAndProject("Single production");

    expect(screen.queryByRole("button", { name: "Book session" })).toBeNull();
    expect(screen.getByRole("radio", { name: /Complimentary/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Payment due/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Payment due/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const bookButton = screen.getByRole<HTMLButtonElement>("button", { name: "Book session" });
    expect(bookButton.disabled).toBe(false);

    expect(screen.queryByLabelText("Session title (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    expect(screen.getByLabelText("Session title (optional)")).toBeTruthy();
  });

  it("returns to the exact time wheels when final preview finds a hard conflict", async () => {
    actionMocks.previewManualSession.mockResolvedValue({
      ok: true,
      preview: {
        hardConflicts: [{ message: "This time overlaps another session." }],
        warnings: [],
        googleCalendarProtection: "active",
      },
    });
    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
      />,
    );
    await chooseClientAndProject();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(await screen.findByRole("button", { name: "Book session" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This time overlaps another session.",
    );
    expect(screen.getByRole("listbox", { name: "Date" })).toBeTruthy();
  });

  it("preserves the exact UTC slot through warning review and create", async () => {
    const onOpenChange = vi.fn();
    actionMocks.previewManualSession.mockResolvedValue({
      ok: true,
      preview: {
        hardConflicts: [],
        warnings: [{ code: "OUTSIDE_AVAILABILITY", message: "Outside normal hours." }],
        googleCalendarProtection: "active",
      },
    });
    actionMocks.createManualSession.mockResolvedValue({
      ok: true,
      session: { googleCalendarProtection: "active" },
    });
    render(
      <ManualSessionModal
        open
        onOpenChange={onOpenChange}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
      />,
    );
    await chooseClientAndProject();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Book session" }));
    expect(await screen.findByRole("heading", { name: "Check these warnings" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Create anyway" }));

    await waitFor(() => {
      expect(actionMocks.createManualSession).toHaveBeenCalledTimes(1);
    });
    expect(actionMocks.createManualSession.mock.calls[0]?.[0]).toMatchObject({
      clientId: "client-1",
      projectId: "project-included",
      studioDate: "2026-08-13",
      studioStartMin: 870,
      startsAtIso: "2026-08-13T11:30:00.000Z",
      title: "Album production",
      billingTreatment: "included",
      acknowledgedWarnings: ["OUTSIDE_AVAILABILITY"],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("locks and keeps the sheet open while previewing, then saves the immutable reviewed slot", async () => {
    const onOpenChange = vi.fn();
    let resolvePreview!: (value: {
      ok: true;
      preview: {
        hardConflicts: never[];
        warnings: { code: "OUTSIDE_AVAILABILITY"; message: string }[];
        googleCalendarProtection: "active";
      };
    }) => void;
    const previewPromise = new Promise<Parameters<typeof resolvePreview>[0]>((resolve) => {
      resolvePreview = resolve;
    });
    actionMocks.previewManualSession.mockReturnValue(previewPromise);
    actionMocks.createManualSession.mockResolvedValue({
      ok: true,
      session: { googleCalendarProtection: "active" },
    });
    render(
      <ManualSessionModal
        open
        onOpenChange={onOpenChange}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
      />,
    );
    await chooseClientAndProject();
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Session title (optional)"), {
      target: { value: "Reviewed title" },
    });
    finishDateTimeStep();

    fireEvent.click(screen.getByRole("button", { name: "Book session" }));
    await waitFor(() => {
      expect(screen.getByTestId("manual-session-controls").hasAttribute("inert")).toBe(true);
    });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Session title (optional)"), {
      target: { value: "Mutated title" },
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolvePreview({
        ok: true,
        preview: {
          hardConflicts: [],
          warnings: [{ code: "OUTSIDE_AVAILABILITY", message: "Outside normal hours." }],
          googleCalendarProtection: "active",
        },
      });
      await previewPromise;
    });
    fireEvent.click(await screen.findByRole("button", { name: "Create anyway" }));

    await waitFor(() => {
      expect(actionMocks.createManualSession).toHaveBeenCalledTimes(1);
    });
    expect(actionMocks.createManualSession.mock.calls[0]?.[0]).toMatchObject({
      studioStartMin: 870,
      startsAtIso: "2026-08-13T11:30:00.000Z",
      title: "Reviewed title",
      acknowledgedReducedGoogleProtection: false,
    });
  });

  it("requires a visible second review if Google protection degrades during the final check", async () => {
    const onOpenChange = vi.fn();
    actionMocks.previewManualSession.mockResolvedValue({
      ok: true,
      preview: {
        hardConflicts: [],
        warnings: [],
        googleCalendarProtection: "active",
      },
    });
    actionMocks.createManualSession
      .mockResolvedValueOnce({
        ok: false,
        error: "Google availability changed. Review reduced protection before continuing.",
        requiresReducedGoogleProtectionReview: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        session: { googleCalendarProtection: "reduced" },
      });
    render(
      <ManualSessionModal
        open
        onOpenChange={onOpenChange}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
      />,
    );
    await chooseClientAndProject();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Book session" }));

    expect(await screen.findByRole("heading", { name: "Review this booking" })).toBeTruthy();
    expect(screen.getByText(/Google busy-time check is limited/i)).toBeTruthy();
    expect(actionMocks.createManualSession.mock.calls[0]?.[0]).toMatchObject({
      acknowledgedReducedGoogleProtection: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Book session" }));
    await waitFor(() => {
      expect(actionMocks.createManualSession).toHaveBeenCalledTimes(2);
    });
    expect(actionMocks.createManualSession.mock.calls[1]?.[0]).toMatchObject({
      acknowledgedReducedGoogleProtection: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows reduced Google protection without inventing busy or event details", async () => {
    actionMocks.getManualSessionAvailability.mockResolvedValue(exactAvailability(240, "reduced"));
    const reduced = vi.fn();
    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={options}
        onGoogleBusyProtectionReduced={reduced}
      />,
    );
    await chooseClientAndProject();
    expect(reduced).toHaveBeenCalled();
    const warning = screen.getByText(/Google busy-time check is limited/i);
    expect(within(warning.closest("div") ?? document.body).queryByText(/event title/i)).toBeNull();
  });
});
