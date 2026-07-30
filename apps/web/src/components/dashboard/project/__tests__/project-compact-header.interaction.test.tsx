// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

  it("uses the + as the direct Add Song action without opening a menu", async () => {
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

    const trigger = screen.getByRole("button", { name: "Add song to First Album" });
    expect(trigger.getAttribute("aria-haspopup")).toBeNull();
    await user.click(trigger);
    expect(onAddSong).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
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

    const trigger = screen.getByRole("button", { name: "Add song to First Album" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.getAttribute("title")).toBe("New work requires an active project.");
  });
});
