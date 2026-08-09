// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProducerManualSessionOptions } from "~/server/domain/session-booking/manual";

import type { ManualSessionDraft } from "../calendar-slot";
import { ManualSessionModal } from "../manual-session-modal";

const actionMocks = vi.hoisted(() => ({
  createManualSession: vi.fn(),
  previewManualSession: vi.fn(),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("../calendar-actions", () => ({
  createManualSession: actionMocks.createManualSession,
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
          defaultTitle: "Full production",
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

beforeEach(() => {
  actionMocks.createManualSession.mockReset();
  actionMocks.previewManualSession.mockReset();
});

afterEach(() => {
  cleanup();
});

function chooseClientAndProject(projectId: string): void {
  fireEvent.change(screen.getByLabelText("Client"), { target: { value: "client-1" } });
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: projectId } });
}

describe("ManualSessionModal", () => {
  it("starts from the calendar slot and publishes the server-derived duration", () => {
    const drafts: Array<ManualSessionDraft | null> = [];

    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 14 * 60 + 30 }}
        onDraftChange={(draft) => {
          drafts.push(draft);
        }}
      />,
    );

    expect(screen.getByText("Thu 13 Aug")).toBeTruthy();
    expect(screen.getByText("14:30")).toBeTruthy();
    expect(screen.queryByLabelText("Date")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText<HTMLInputElement>("Date").value).toBe("2026-08-13");
    expect(screen.getByLabelText<HTMLInputElement>("Start").value).toBe("14:30");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Date")).toBeNull();

    chooseClientAndProject("project-included");

    expect(screen.getByText("14:30–18:30")).toBeTruthy();
    expect(drafts.at(-1)).toEqual({
      studioDate: "2026-08-13",
      studioStartMin: 870,
      durationMin: 240,
    });
  });

  it("keeps client and project separate and reveals optional details on demand", () => {
    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
      />,
    );

    const client = screen.getByLabelText("Client");
    const project = screen.getByLabelText("Project");
    expect(client).not.toBe(project);
    expect((project as HTMLSelectElement).disabled).toBe(true);

    chooseClientAndProject("project-included");

    expect(screen.queryByLabelText("Session title (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    expect(screen.getByLabelText("Session title (optional)")).toBeTruthy();

    const details = screen.getByText("Booking treatment").closest("section");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).queryByRole("radio")).toBeNull();
    fireEvent.click(within(details as HTMLElement).getByRole("button", { name: "Change" }));
    expect(within(details as HTMLElement).getAllByRole("radio")).toHaveLength(2);
  });

  it("requires an explicit complimentary or payment-due choice when credits are exhausted", () => {
    render(
      <ManualSessionModal
        open
        onOpenChange={vi.fn()}
        options={options}
        initialSlot={{ studioDate: "2026-08-13", studioStartMin: 870 }}
      />,
    );

    chooseClientAndProject("project-exhausted");

    const bookButton = screen.getByRole("button", { name: "Book session" });
    expect((bookButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("radio", { name: /Complimentary/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Payment due/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Payment due/ }));
    expect((bookButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Payment due is recorded; no charge is created.")).toBeTruthy();
  });

  it("reopens the time editor when preview finds a hard conflict", async () => {
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

    chooseClientAndProject("project-included");
    expect(screen.queryByLabelText("Date")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Book session" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This time overlaps another session.",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Date").value).toBe("2026-08-13");
  });

  it("preserves the draft through warning review and acknowledges warnings on create", async () => {
    const drafts: Array<ManualSessionDraft | null> = [];
    const onOpenChange = vi.fn();
    actionMocks.previewManualSession.mockResolvedValue({
      ok: true,
      preview: {
        hardConflicts: [],
        warnings: [
          {
            code: "OUTSIDE_AVAILABILITY",
            message: "This time is outside your availability.",
          },
        ],
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
        onDraftChange={(draft) => {
          drafts.push(draft);
        }}
      />,
    );

    chooseClientAndProject("project-included");
    fireEvent.click(screen.getByRole("button", { name: "Book session" }));

    expect(await screen.findByRole("heading", { name: "Check these warnings" })).toBeTruthy();
    expect(screen.getByText("This time is outside your availability.")).toBeTruthy();

    const backButton = screen.getByRole<HTMLButtonElement>("button", { name: "Back" });
    await waitFor(() => {
      expect(backButton.disabled).toBe(false);
    });
    fireEvent.click(backButton);
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>("Client").value).toBe("client-1");
      expect(screen.getByLabelText<HTMLSelectElement>("Project").value).toBe("project-included");
    });

    fireEvent.click(screen.getByRole("button", { name: "Book session" }));
    expect(await screen.findByRole("heading", { name: "Check these warnings" })).toBeTruthy();
    const createAnywayButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Create anyway",
    });
    await waitFor(() => {
      expect(createAnywayButton.disabled).toBe(false);
    });
    fireEvent.click(createAnywayButton);

    await waitFor(() => {
      expect(actionMocks.createManualSession).toHaveBeenCalledTimes(1);
    });
    const createInput: unknown = actionMocks.createManualSession.mock.calls[0]?.[0];
    expect(createInput).toMatchObject({
      clientId: "client-1",
      projectId: "project-included",
      studioDate: "2026-08-13",
      studioStartMin: 870,
      title: "Full production",
      billingTreatment: "included",
      acknowledgedWarnings: ["OUTSIDE_AVAILABILITY"],
    });
    expect(
      typeof createInput === "object" &&
        createInput !== null &&
        "operationKey" in createInput &&
        typeof createInput.operationKey === "string" &&
        createInput.operationKey.startsWith("producer-manual:"),
    ).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(drafts.at(-1)).toBeNull();
  });
});
