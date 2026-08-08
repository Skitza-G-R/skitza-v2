// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseRequestReview } from "../purchase-request-review";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  correctTarget: vi.fn(),
  decline: vi.fn(),
  online: true,
  push: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("~/app/(producer)/dashboard/requests/actions", () => ({
  approvePurchaseRequest: mocks.approve,
  correctPurchaseTarget: mocks.correctTarget,
  declinePurchaseRequest: mocks.decline,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => mocks.online,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const LONG_NOTE =
  "Keep the lead vocal intimate and leave space for a live string overdub. The chorus should feel wider without losing the close quality of the verses. Please keep the instrumental clean for a live vocal performance and leave the string arrangement editable until final review.";

const baseProps = {
  id: "00000000-0000-4000-8000-000000000001",
  initialStatus: "pending" as const,
  initialProjectId: null,
  targetProjects: [
    {
      id: "00000000-0000-4000-8000-000000000021",
      title: "Maya Cohen — Debut EP",
      lifecycleStatus: "active" as const,
      workflowStage: "production" as const,
      updatedAtIso: "2026-07-19T10:00:00.000Z",
    },
  ],
  artistName: "Maya Cohen",
  artistEmail: "maya@example.com",
  productName: "Three-song production",
  total: "₪2,832",
  totalCaption: "Proposal total",
  submittedAt: "Jul 20, 2026, 11:00 AM",
  reference: "SK-72QA",
  brief: LONG_NOTE,
};

function renderReview(
  overrides: Partial<Omit<ComponentProps<typeof PurchaseRequestReview>, "children">> = {},
) {
  return render(
    <PurchaseRequestReview {...baseProps} {...overrides}>
      <div>Commercial details</div>
    </PurchaseRequestReview>,
  );
}

function getDecisionButton(name: "Approve" | "Decline") {
  const [button] = screen.getAllByRole("button", { name });
  if (!button) {
    throw new Error(`Expected a visible ${name} decision button.`);
  }
  return button;
}

beforeEach(() => {
  mocks.online = true;
  mocks.approve.mockReset();
  mocks.approve.mockResolvedValue({ ok: true, status: "approved" });
  mocks.correctTarget.mockReset();
  mocks.correctTarget.mockResolvedValue({
    ok: true,
    projectId: "00000000-0000-4000-8000-000000000021",
  });
  mocks.decline.mockReset();
  mocks.decline.mockResolvedValue({ ok: true, status: "declined" });
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.toast.mockReset();
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

describe("producer purchase request decision screen", () => {
  it("changes the compact Project choice and repeats it in approval confirmation", async () => {
    const user = userEvent.setup();
    renderReview();

    expect(screen.getByText("Start a new project")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Change" }));

    const chooser = await screen.findByRole("dialog", { name: "Choose a project" });
    await waitFor(() => {
      expect(document.activeElement).toBe(within(chooser).getByRole("button", { name: "Cancel" }));
    });
    await user.click(within(chooser).getByRole("radio", { name: /Maya Cohen — Debut EP/ }));
    await user.click(within(chooser).getByRole("button", { name: "Use this project" }));

    await waitFor(() => {
      expect(mocks.correctTarget).toHaveBeenCalledWith({
        purchaseRequestId: baseProps.id,
        projectId: "00000000-0000-4000-8000-000000000021",
      });
    });
    expect(screen.queryByRole("dialog", { name: "Choose a project" })).toBeNull();

    await user.click(getDecisionButton("Approve"));
    const confirmation = await screen.findByRole("dialog", { name: "Approve this request?" });
    expect(within(confirmation).getByText("Maya Cohen — Debut EP")).not.toBeNull();
    expect(within(confirmation).getByText(/No payment happens yet/)).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(confirmation).getByRole("button", { name: "Cancel" }),
      );
    });
  });

  it("opens a decline confirmation with no private-note field or Undo", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(getDecisionButton("Decline"));
    const dialog = await screen.findByRole("dialog", { name: "Decline this request?" });

    expect(within(dialog).getByText(/receives a simple decline message/)).not.toBeNull();
    expect(within(dialog).getByText(/cannot be undone/)).not.toBeNull();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/private note/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("returns to the dashboard with concise feedback after approval", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(getDecisionButton("Approve"));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Approve this request?" })).getByRole(
        "button",
        { name: "Approve request" },
      ),
    );

    await waitFor(() => {
      expect(mocks.approve).toHaveBeenCalledWith({ id: baseProps.id });
      expect(mocks.toast).toHaveBeenCalledWith("Request approved.", "success");
      expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("returns to the dashboard with concise feedback after decline", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(getDecisionButton("Decline"));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Decline this request?" })).getByRole(
        "button",
        { name: "Decline request" },
      ),
    );

    await waitFor(() => {
      expect(mocks.decline).toHaveBeenCalledWith({ id: baseProps.id });
      expect(mocks.toast).toHaveBeenCalledWith("Request declined.", "success");
      expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("keeps a failed decision on the request and shows the useful error", async () => {
    mocks.approve.mockResolvedValue({ ok: false, error: "Approval could not be saved." });
    const user = userEvent.setup();
    renderReview();

    await user.click(getDecisionButton("Approve"));
    const dialog = await screen.findByRole("dialog", { name: "Approve this request?" });
    await user.click(within(dialog).getByRole("button", { name: "Approve request" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Approval could not be saved.",
    );
    expect(screen.getByRole("dialog", { name: "Approve this request?" })).not.toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("renders decided requests as read-only summaries", () => {
    renderReview({ initialStatus: "approved" });

    expect(screen.getByText("Request approved")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("previews long Artist notes and omits an empty note area", async () => {
    const user = userEvent.setup();
    renderReview();

    expect(screen.getByRole("button", { name: "Read full note" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Read full note" }));
    expect(await screen.findByRole("dialog", { name: "Artist note" })).not.toBeNull();

    cleanup();
    renderReview({ brief: "   " });
    expect(screen.queryByText("Artist note")).toBeNull();
    expect(screen.queryByRole("button", { name: "Read full note" })).toBeNull();
  });
});
