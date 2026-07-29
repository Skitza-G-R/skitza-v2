// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyStatus: null as ((status: "active" | "completed" | "canceled") => void) | null,
  cancelProject: vi.fn(),
  completeProject: vi.fn(),
  deleteProject: vi.fn(),
  loadOffers: vi.fn(),
  nextStatus: null as "active" | "completed" | "canceled" | null,
  refresh: vi.fn(),
  reopenProject: vi.fn(),
  sendInvite: vi.fn(),
  toast: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/actions", () => ({
  cancelProjectAction: mocks.cancelProject,
  completeProjectAction: mocks.completeProject,
  deleteEmptyDraftProjectAction: mocks.deleteProject,
  reopenProjectAction: mocks.reopenProject,
  updateProjectAction: mocks.updateProject,
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/clients-actions", () => ({
  sendClientInviteAction: mocks.sendInvite,
}));

vi.mock("~/app/(producer)/dashboard/store/private-offer-actions", () => ({
  loadClientPrivateOffersAction: mocks.loadOffers,
}));

vi.mock("~/components/dashboard/offers/private-offer-composer", () => ({
  PrivateOfferComposer: () => null,
}));

vi.mock("~/components/dashboard/clients/client-actions-menu", () => ({
  ClientActionsMenu: () => null,
}));

vi.mock("~/components/dashboard/clients/client-archive-confirm-modal", () => ({
  ClientArchiveConfirmModal: () => null,
}));

vi.mock("~/components/dashboard/clients/edit-client-modal", () => ({
  EditClientModal: () => null,
}));

vi.mock("~/components/dashboard/clients/invite-modal", () => ({
  InviteToAppModal: () => null,
}));

vi.mock("~/components/dashboard/clients/new-project-modal", () => ({
  NewProjectModal: () => null,
}));

vi.mock("~/components/dashboard/clients/remove-client-confirm-modal", () => ({
  RemoveClientConfirmModal: () => null,
}));

vi.mock("~/components/native/use-tab-swipe", () => ({
  useTabSwipe: () => ({}),
}));

vi.mock("~/components/payments/producer-payment-workspace", () => ({
  ProducerPaymentWorkspace: () => null,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <>{children}</> : null,
  SheetContent: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  SheetDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  SheetTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import type { ProjectLifecycleStatus } from "~/components/dashboard/projects/project-action-types";

import { ClientSpaceWorkspace } from "../client-space-workspace";

const PROJECT_LABELS: Record<
  ProjectLifecycleStatus,
  { statusLabel: string; statusTone: "active" | "warning" | "success" | "neutral" }
> = {
  waiting_for_payment: { statusLabel: "Waiting for payment", statusTone: "warning" },
  active: { statusLabel: "Active", statusTone: "active" },
  paused: { statusLabel: "Paused", statusTone: "warning" },
  completed: { statusLabel: "Completed", statusTone: "success" },
  canceled: { statusLabel: "Canceled", statusTone: "neutral" },
};

function WorkspaceHarness({ initialStatus }: { initialStatus: ProjectLifecycleStatus }) {
  const [status, setStatus] = useState(initialStatus);
  mocks.applyStatus = (nextStatus) => {
    setStatus(nextStatus);
  };

  return (
    <ClientSpaceWorkspace
      client={{
        id: "client-focus",
        name: "Maya Stone",
        email: "maya@example.test",
        phone: null,
        notes: null,
        tags: [],
        archived: false,
        archiveBlockedReason: null,
        canPermanentlyDelete: false,
        linkState: "active",
        joinedAtIso: "2026-01-01T00:00:00.000Z",
      }}
      projects={[
        {
          id: "project-focus",
          title: "Focus project",
          clientName: "Maya Stone",
          lifecycleStatus: status,
          workflowStage: "production",
          deadlineAtIso: null,
          canDeleteEmptyDraft: false,
          ...PROJECT_LABELS[status],
          nextAction: "Review the next milestone",
        },
      ]}
      paymentBuckets={[]}
      paymentTotals={[]}
      needsReviewCount={0}
      producerSlug="maya-produces"
      offerConfig={null}
    />
  );
}

beforeEach(() => {
  mocks.applyStatus = null;
  mocks.nextStatus = null;
  mocks.cancelProject.mockReset();
  mocks.completeProject.mockReset();
  mocks.deleteProject.mockReset();
  mocks.loadOffers.mockReset();
  mocks.refresh.mockReset();
  mocks.reopenProject.mockReset();
  mocks.sendInvite.mockReset();
  mocks.toast.mockReset();
  mocks.updateProject.mockReset();

  mocks.completeProject.mockImplementation(() => {
    mocks.nextStatus = "completed";
    return Promise.resolve({ ok: true });
  });
  mocks.cancelProject.mockImplementation(() => {
    mocks.nextStatus = "canceled";
    return Promise.resolve({ ok: true });
  });
  mocks.reopenProject.mockImplementation(() => {
    mocks.nextStatus = "active";
    return Promise.resolve({ ok: true });
  });
  mocks.refresh.mockImplementation(() => {
    if (mocks.nextStatus) {
      mocks.applyStatus?.(mocks.nextStatus);
    }
  });
  mocks.loadOffers.mockResolvedValue({ ok: true, data: [] });

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return window.setTimeout(() => {
      callback(performance.now());
    }, 0);
  });
});

afterEach(async () => {
  cleanup();
  mocks.applyStatus = null;
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  vi.unstubAllGlobals();
});

describe("ClientSpaceWorkspace project lifecycle focus", () => {
  it.each([
    {
      action: "Complete",
      actionMock: "completeProject",
      confirm: "Complete project",
      destination: "Archived",
      initialStatus: "active",
    },
    {
      action: "Cancel",
      actionMock: "cancelProject",
      confirm: "Cancel project",
      destination: "Archived",
      initialStatus: "active",
    },
    {
      action: "Reopen",
      actionMock: "reopenProject",
      confirm: "Reopen project",
      destination: "Active",
      initialStatus: "completed",
    },
  ] as const)(
    "$action moves focus to the stable $destination filter and keeps keyboard flow usable",
    async ({ action, actionMock, confirm, destination, initialStatus }) => {
      const user = userEvent.setup();
      render(<WorkspaceHarness initialStatus={initialStatus} />);

      if (initialStatus === "completed") {
        await user.click(screen.getByRole("button", { name: /^Archived / }));
      }

      expect(screen.getByRole("link", { name: "Open project Focus project" })).not.toBeNull();
      const destinationFilter = screen.getByRole("button", {
        name: new RegExp(`^${destination} `),
      });

      await user.click(screen.getByLabelText("Project actions for Focus project"));
      await user.click(screen.getByRole("button", { name: action }));

      const dialog = await screen.findByRole("dialog", {
        name: `${action} Focus project?`,
      });

      await user.click(within(dialog).getByRole("button", { name: confirm }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("link", { name: "Open project Focus project" })).toBeNull();
        expect(document.activeElement).toBe(destinationFilter);
        expect(document.activeElement).not.toBe(document.body);
      });
      expect(mocks[actionMock]).toHaveBeenCalledOnce();
      expect(mocks[actionMock]).toHaveBeenCalledWith({ id: "project-focus" });

      await user.keyboard("{Enter}");

      expect(
        await screen.findByRole("link", { name: "Open project Focus project" }),
      ).not.toBeNull();
      expect(destinationFilter.getAttribute("aria-pressed")).toBe("true");
    },
  );

  it("keeps the original action trigger as the return target after a failed lifecycle change", async () => {
    mocks.completeProject.mockResolvedValueOnce({
      ok: false,
      error: "Could not complete this project.",
    });
    const user = userEvent.setup();
    render(<WorkspaceHarness initialStatus="active" />);

    const activeFilter = screen.getByRole("button", { name: /^Active / });
    const fallbackFilter = screen.getByRole("button", { name: /^Archived / });
    await user.click(screen.getByLabelText("Project actions for Focus project"));
    const actionTrigger = screen.getByRole("button", { name: "Complete" });
    await user.click(actionTrigger);

    const dialog = await screen.findByRole("dialog", {
      name: "Complete Focus project?",
    });
    const confirmButton = within(dialog).getByRole("button", {
      name: "Complete project",
    });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mocks.completeProject).toHaveBeenCalledOnce();
      expect(confirmButton.hasAttribute("disabled")).toBe(false);
    });
    expect(mocks.toast).toHaveBeenCalledWith("Could not complete this project.", "error");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.nextStatus).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Keep as is" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(actionTrigger.isConnected).toBe(true);
      expect(document.activeElement).toBe(actionTrigger);
      expect(document.activeElement).not.toBe(fallbackFilter);
      expect(document.activeElement).not.toBe(document.body);
    });
    expect(activeFilter.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Open project Focus project" })).not.toBeNull();

    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog", { name: "Complete Focus project?" })).not.toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("returns focus to the original action trigger when the lifecycle dialog is dismissed", async () => {
    const user = userEvent.setup();
    render(<WorkspaceHarness initialStatus="active" />);

    const activeFilter = screen.getByRole("button", { name: /^Active / });
    const fallbackFilter = screen.getByRole("button", { name: /^Archived / });
    await user.click(screen.getByLabelText("Project actions for Focus project"));
    const actionTrigger = screen.getByRole("button", { name: "Cancel" });
    await user.click(actionTrigger);
    expect(await screen.findByRole("dialog", { name: "Cancel Focus project?" })).not.toBeNull();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(actionTrigger.isConnected).toBe(true);
      expect(document.activeElement).toBe(actionTrigger);
      expect(document.activeElement).not.toBe(fallbackFilter);
      expect(document.activeElement).not.toBe(document.body);
    });
    expect(mocks.cancelProject).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.nextStatus).toBeNull();
    expect(activeFilter.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Open project Focus project" })).not.toBeNull();

    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog", { name: "Cancel Focus project?" })).not.toBeNull();
    expect(mocks.cancelProject).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
