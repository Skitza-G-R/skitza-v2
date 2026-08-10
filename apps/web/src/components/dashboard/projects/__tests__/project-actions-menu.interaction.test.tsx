// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onActionStart: vi.fn(),
}));

vi.mock("../project-action-controls", () => ({
  ProjectActionControls: ({
    project,
    onActionStart,
  }: {
    project: { title: string };
    onActionStart?: (trigger: HTMLButtonElement) => void;
  }) => (
    <button
      type="button"
      data-project-action="edit"
      onClick={(event) => {
        mocks.onActionStart();
        onActionStart?.(event.currentTarget);
      }}
    >
      Edit {project.title}
    </button>
  ),
}));

import { ProjectActionsMenu } from "../project-actions-menu";

const PROJECT = {
  id: "project-1",
  title: "Morning tapes",
  clientName: "Lior",
  lifecycleStatus: "active" as const,
  workflowStage: "production" as const,
  deadlineAtIso: null,
  canDeleteEmptyDraft: false,
};

beforeEach(() => {
  mocks.onActionStart.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(performance.now());
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProjectActionsMenu interactions", () => {
  it("closes when the producer clicks outside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ProjectActionsMenu project={PROJECT} />
        <button type="button">Outside control</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Actions for Morning tapes" }));
    const popover = screen.getByTestId("project-actions-popover");
    expect(popover.hidden).toBe(false);

    await user.click(screen.getByRole("button", { name: "Outside control" }));
    await waitFor(() => {
      expect(popover.hidden).toBe(true);
    });
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<ProjectActionsMenu project={PROJECT} />);

    const trigger = screen.getByRole("button", { name: "Actions for Morning tapes" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.getByTestId("project-actions-popover").hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes before handing the selected action to its confirmation flow", () => {
    render(<ProjectActionsMenu project={PROJECT} />);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Morning tapes" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Morning tapes" }));

    expect(mocks.onActionStart).toHaveBeenCalledOnce();
    expect(screen.getByTestId("project-actions-popover").hidden).toBe(true);
  });
});
