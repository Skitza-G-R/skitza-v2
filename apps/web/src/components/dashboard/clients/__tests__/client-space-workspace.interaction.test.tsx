// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterOfferCreated: vi.fn(),
  loadOffers: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/clients-actions", () => ({
  sendClientInviteAction: vi.fn(),
}));

vi.mock("~/app/(producer)/dashboard/store/private-offer-actions", () => ({
  loadClientPrivateOffersAction: mocks.loadOffers,
}));

vi.mock("~/components/dashboard/offers/private-offer-composer", () => ({
  PrivateOfferComposer: ({
    open,
    onOpenChange,
    onCreated,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onCreated?: (offerId: string) => void;
  }) =>
    open ? (
      <section role="dialog" aria-label="Private offer composer">
        <button
          type="button"
          onClick={() => {
            onOpenChange?.(false);
          }}
        >
          Cancel offer
        </button>
        <button
          type="button"
          onClick={() => {
            onCreated?.("offer-created");
            mocks.afterOfferCreated();
            onOpenChange?.(false);
          }}
        >
          Save offer
        </button>
      </section>
    ) : null,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("~/components/ui/sheet", () => ({
  Sheet: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SheetContent: ({
    children,
    "data-testid": testId,
  }: {
    children?: ReactNode;
    "data-testid"?: string;
  }) => <section data-testid={testId}>{children}</section>,
  SheetDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  SheetTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
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

import { ClientSpaceWorkspace } from "../client-space-workspace";

type OfferResult =
  | {
      ok: true;
      data: Array<{
        id: string;
        status: "sent";
        name: string;
        totalCents: number;
        currency: string;
        targetProjectTitle: string | null;
        expiresAtIso: string;
      }>;
    }
  | { ok: false; error: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function offer(
  name: string,
  targetProjectTitle = "Release project",
): Extract<OfferResult, { ok: true }>["data"][number] {
  return {
    id: `offer-${name.slice(0, 12)}`,
    status: "sent",
    name,
    totalCents: 125_000,
    currency: "USD",
    targetProjectTitle,
    expiresAtIso: "2026-09-01T00:00:00.000Z",
  };
}

function workspaceElement({
  clientId = "client-1",
  clientName = "Maya Stone",
  initialTab,
  tags = [],
}: {
  clientId?: string;
  clientName?: string;
  initialTab?: "projects" | "payments" | "details";
  tags?: string[];
} = {}) {
  return (
    <ClientSpaceWorkspace
      client={{
        id: clientId,
        name: clientName,
        email: "maya@example.test",
        phone: "+1 555 0100",
        notes: "Private note",
        tags,
        archived: false,
        archiveBlockedReason: null,
        canPermanentlyDelete: false,
        linkState: "active",
        joinedAtIso: "2026-01-01T00:00:00.000Z",
      }}
      projects={[]}
      payments={{ status: "error", message: "Payments unavailable." }}
      producerSlug="maya-produces"
      offerConfig={{
        defaultCurrency: "USD",
        taxMode: "tax_added",
        taxRatePct: 18,
      }}
      {...(initialTab ? { initialTab } : {})}
    />
  );
}

function renderWorkspace(tags: string[] = []) {
  return render(workspaceElement({ tags }));
}

async function openDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Details" }));
  await waitFor(() => {
    expect(mocks.loadOffers).toHaveBeenCalledTimes(1);
  });
}

async function openOfferComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^New Offer/ }));
  return screen.findByRole("dialog", { name: "Private offer composer" });
}

beforeEach(() => {
  mocks.afterOfferCreated.mockReset();
  mocks.loadOffers.mockReset();
  mocks.toast.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return window.setTimeout(() => {
      callback(performance.now());
    }, 0);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClientSpaceWorkspace offer refresh state", () => {
  it("does not refetch producer offers when the composer is canceled", async () => {
    mocks.loadOffers.mockResolvedValue({
      ok: true,
      data: [offer("Existing offer")],
    } satisfies OfferResult);
    const user = userEvent.setup();
    renderWorkspace();

    await openDetails(user);
    expect(await screen.findByText("Existing offer")).not.toBeNull();
    await openOfferComposer(user);
    await user.click(screen.getByRole("button", { name: "Cancel offer" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Private offer composer" })).toBeNull();
    });
    expect(mocks.loadOffers).toHaveBeenCalledTimes(1);
  });

  it("refreshes exactly once after a successful offer creation", async () => {
    const refresh = deferred<OfferResult>();
    mocks.loadOffers
      .mockResolvedValueOnce({
        ok: true,
        data: [offer("Existing offer")],
      } satisfies OfferResult)
      .mockReturnValueOnce(refresh.promise);
    const user = userEvent.setup();
    renderWorkspace();

    await openDetails(user);
    expect(await screen.findByText("Existing offer")).not.toBeNull();
    await openOfferComposer(user);
    await user.click(screen.getByRole("button", { name: "Save offer" }));

    await waitFor(() => {
      expect(mocks.loadOffers).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      refresh.resolve({
        ok: true,
        data: [offer("Created offer")],
      });
      await refresh.promise;
    });
    expect(await screen.findByText("Created offer")).not.toBeNull();
    expect(mocks.loadOffers).toHaveBeenCalledTimes(2);
  });

  it("invalidates synchronously so a stale completion cannot overwrite the new generation", async () => {
    const stale = deferred<OfferResult>();
    const fresh = deferred<OfferResult>();
    mocks.loadOffers.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    mocks.afterOfferCreated.mockImplementation(() => {
      stale.resolve({
        ok: true,
        data: [offer("Stale offer")],
      });
    });
    const user = userEvent.setup();
    renderWorkspace();

    await openDetails(user);
    await openOfferComposer(user);
    await user.click(screen.getByRole("button", { name: "Save offer" }));

    await waitFor(() => {
      expect(mocks.loadOffers).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Stale offer")).toBeNull();

    await act(async () => {
      fresh.resolve({
        ok: true,
        data: [offer("Fresh offer")],
      });
      await fresh.promise;
    });
    expect(await screen.findByText("Fresh offer")).not.toBeNull();
    expect(screen.queryByText("Stale offer")).toBeNull();
  });

  it("keeps existing offers visible and exposes retry when refresh fails", async () => {
    mocks.loadOffers
      .mockResolvedValueOnce({
        ok: true,
        data: [offer("Existing offer")],
      } satisfies OfferResult)
      .mockResolvedValueOnce({
        ok: false,
        error: "Could not refresh private offers.",
      } satisfies OfferResult)
      .mockResolvedValueOnce({
        ok: true,
        data: [offer("Recovered offer")],
      } satisfies OfferResult);
    const user = userEvent.setup();
    renderWorkspace();

    await openDetails(user);
    expect(await screen.findByText("Existing offer")).not.toBeNull();
    await openOfferComposer(user);
    await user.click(screen.getByRole("button", { name: "Save offer" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not refresh private offers.",
    );
    expect(screen.getByText("Existing offer")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(mocks.loadOffers).toHaveBeenCalledTimes(3);
    });
    expect(await screen.findByText("Recovered offer")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("resets client-owned state and rejects a stale generation when the client id changes", async () => {
    const staleClientRefresh = deferred<OfferResult>();
    const nextClientLoad = deferred<OfferResult>();
    mocks.loadOffers
      .mockResolvedValueOnce({
        ok: true,
        data: [offer("First client offer")],
      } satisfies OfferResult)
      .mockReturnValueOnce(staleClientRefresh.promise)
      .mockReturnValueOnce(nextClientLoad.promise);
    const user = userEvent.setup();
    const view = renderWorkspace();

    await openDetails(user);
    expect(await screen.findByText("First client offer")).not.toBeNull();
    await openOfferComposer(user);
    await user.click(screen.getByRole("button", { name: "Save offer" }));
    await waitFor(() => {
      expect(mocks.loadOffers).toHaveBeenCalledTimes(2);
    });

    view.rerender(
      workspaceElement({
        clientId: "client-2",
        clientName: "Nora Vale",
      }),
    );

    await waitFor(() => {
      expect(mocks.loadOffers).toHaveBeenCalledTimes(3);
      expect(mocks.loadOffers).toHaveBeenLastCalledWith("client-2");
    });
    expect(screen.queryByText("First client offer")).toBeNull();

    await act(async () => {
      staleClientRefresh.resolve({
        ok: true,
        data: [offer("Stale first-client refresh")],
      });
      await staleClientRefresh.promise;
    });
    expect(screen.queryByText("Stale first-client refresh")).toBeNull();

    await act(async () => {
      nextClientLoad.resolve({
        ok: true,
        data: [offer("Second client offer")],
      });
      await nextClientLoad.promise;
    });
    expect(await screen.findByText("Second client offer")).not.toBeNull();
    expect(screen.queryByText("First client offer")).toBeNull();
    expect(screen.queryByText("Stale first-client refresh")).toBeNull();
  });
});

describe("ClientSpaceWorkspace rendered containment and focus", () => {
  it("renders the locked Payments tab on the first frame", () => {
    render(workspaceElement({ initialTab: "payments" }));

    expect(screen.getByRole("tab", { name: "Payments" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "client-space-tab-payments",
    );
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t load payments.");
    expect(screen.queryByText("No active projects")).toBeNull();
  });

  it.each([360, 390])(
    "contains unbroken Details tokens without clipping at %ipx",
    async (width) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      const longTag = "T".repeat(80);
      const longOfferName = "N".repeat(80);
      const longProjectTitle = "P".repeat(80);
      mocks.loadOffers.mockResolvedValue({
        ok: true,
        data: [offer(longOfferName, longProjectTitle)],
      } satisfies OfferResult);
      const user = userEvent.setup();
      renderWorkspace([longTag]);

      await openDetails(user);
      const tag = await screen.findByTestId("client-detail-tag");
      const offerName = screen.getByText(longOfferName);
      const metadata = screen.getByTestId("client-offer-metadata");

      for (const element of [tag, offerName, metadata]) {
        const classes = element.className.split(/\s+/);
        expect(classes).toEqual(
          expect.arrayContaining([
            "max-w-full",
            "min-w-0",
            "whitespace-normal",
            "[overflow-wrap:anywhere]",
          ]),
        );
        expect(classes).not.toEqual(
          expect.arrayContaining(["truncate", "whitespace-nowrap", "overflow-hidden"]),
        );
      }
      expect(tag.textContent).toBe(longTag);
      expect(offerName.textContent).toBe(longOfferName);
      expect(metadata.textContent).toContain(longProjectTitle);
    },
  );

  it("gives the keyboard-focusable tabpanel a visible token focus ring", () => {
    mocks.loadOffers.mockResolvedValue({ ok: true, data: [] } satisfies OfferResult);
    renderWorkspace();

    const panel = screen.getByRole("tabpanel");
    act(() => {
      panel.focus();
    });

    expect(document.activeElement).toBe(panel);
    expect(panel.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-[rgb(var(--focus-ring))]",
        "focus-visible:ring-inset",
      ]),
    );
  });
});
