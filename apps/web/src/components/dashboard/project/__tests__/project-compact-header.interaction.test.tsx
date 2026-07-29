// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectCompactHeader } from "../project-compact-header";

const BASE_PROPS = {
  name: "First Album",
  clientName: "Maya Cohen",
  workflowStage: "mixing" as const,
  deadline: "Aug 12",
  isOverdue: false,
  paymentAttention: {
    needsReviewPurchaseCount: 1,
    dueOrOverduePurchaseCount: 2,
  },
  canAddSong: true,
  blockedReason: "New work requires an active project.",
};

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return window.setTimeout(() => {
      callback(performance.now());
    }, 0);
  });
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  vi.unstubAllGlobals();
});

describe("ProjectCompactHeader interactions", () => {
  it("shows only compact project facts and routes its conditional alert to Payments", async () => {
    const onOpenPayments = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectCompactHeader {...BASE_PROPS} onOpenPayments={onOpenPayments} onAddSong={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "First Album", level: 1 })).not.toBeNull();
    expect(screen.getByText("Maya Cohen")).not.toBeNull();
    expect(screen.getByText("Mixing")).not.toBeNull();
    expect(screen.getByText("Aug 12")).not.toBeNull();
    expect(screen.queryByText("Project Space")).toBeNull();
    expect(
      screen.getByText(
        "1 purchase awaiting proof review · 2 purchases with due or overdue payments",
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Payment needs attention/i }));
    expect(onOpenPayments).toHaveBeenCalledOnce();
  });

  it("opens one Add Song-only bottom sheet and returns focus after Escape", async () => {
    const onAddSong = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectCompactHeader
        {...BASE_PROPS}
        paymentAttention={null}
        onOpenPayments={vi.fn()}
        onAddSong={onAddSong}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Add to First Album" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Add to First Album" });
    expect(within(dialog).getByRole("button", { name: "Add song" })).not.toBeNull();
    expect(within(dialog).queryByText(/Add Session/i)).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add to First Album" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    await user.click(trigger);
    await user.click(
      within(await screen.findByRole("dialog", { name: "Add to First Album" })).getByRole(
        "button",
        { name: "Add song" },
      ),
    );
    expect(onAddSong).toHaveBeenCalledOnce();
  });

  it("keeps the + visible but disabled when the project cannot accept new work", () => {
    render(
      <ProjectCompactHeader
        {...BASE_PROPS}
        canAddSong={false}
        paymentAttention={null}
        onOpenPayments={vi.fn()}
        onAddSong={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Add to First Album" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.getAttribute("title")).toBe("New work requires an active project.");
  });
});
