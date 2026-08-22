// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadOffers: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/clients-actions", () => ({
  sendClientInviteAction: vi.fn(),
}));

vi.mock("~/app/(producer)/dashboard/store/private-offer-actions", () => ({
  loadClientPrivateOffersAction: mocks.loadOffers,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
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
  InviteToAppModal: ({ open, invitationState }: { open?: boolean; invitationState?: string }) =>
    open ? (
      <section role="dialog" aria-label="Individual invitation" data-state={invitationState} />
    ) : null,
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
  linkState = "active",
  tags = [],
}: {
  clientId?: string;
  clientName?: string;
  initialTab?: "projects" | "payments" | "details";
  linkState?: "none" | "sending" | "failed" | "pending" | "active";
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
        linkState,
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

beforeEach(() => {
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
  it("shows existing private-offer history without exposing a creation action", async () => {
    mocks.loadOffers.mockResolvedValue({
      ok: true,
      data: [offer("Existing offer")],
    } satisfies OfferResult);
    const user = userEvent.setup();
    renderWorkspace();

    await openDetails(user);
    expect(await screen.findByText("Existing offer")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /New Offer/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /New Project/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add for/i })).toBeNull();
    expect(mocks.loadOffers).toHaveBeenCalledTimes(1);
  });

  it("retries a failed private-offer history read without adding creation UI", async () => {
    mocks.loadOffers
      .mockResolvedValueOnce({
        ok: false,
        error: "Could not load private offers.",
      } satisfies OfferResult)
      .mockResolvedValueOnce({
        ok: true,
        data: [offer("Recovered offer")],
      } satisfies OfferResult);
    const user = userEvent.setup();
    renderWorkspace();

    await openDetails(user);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load private offers.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(mocks.loadOffers).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Recovered offer")).not.toBeNull();
    expect(mocks.loadOffers).toHaveBeenCalledTimes(2);
  });

  it("resets client-owned state and rejects a stale generation when the client id changes", async () => {
    const staleClientLoad = deferred<OfferResult>();
    const nextClientLoad = deferred<OfferResult>();
    mocks.loadOffers
      .mockReturnValueOnce(staleClientLoad.promise)
      .mockReturnValueOnce(nextClientLoad.promise);
    const user = userEvent.setup();
    const view = renderWorkspace();

    await openDetails(user);

    view.rerender(
      workspaceElement({
        clientId: "client-2",
        clientName: "Nora Vale",
      }),
    );

    await waitFor(() => {
      expect(mocks.loadOffers).toHaveBeenCalledTimes(2);
      expect(mocks.loadOffers).toHaveBeenLastCalledWith("client-2");
    });

    await act(async () => {
      staleClientLoad.resolve({
        ok: true,
        data: [offer("Stale first-client load")],
      });
      await staleClientLoad.promise;
    });
    expect(screen.queryByText("Stale first-client load")).toBeNull();

    await act(async () => {
      nextClientLoad.resolve({
        ok: true,
        data: [offer("Second client offer")],
      });
      await nextClientLoad.promise;
    });
    expect(await screen.findByText("Second client offer")).not.toBeNull();
    expect(screen.queryByText("Stale first-client load")).toBeNull();
  });
});

describe("ClientSpaceWorkspace rendered containment and focus", () => {
  it("opens the individual invitation modal after provider acceptance", async () => {
    const user = userEvent.setup();
    const view = render(workspaceElement({ linkState: "pending" }));

    await user.click(screen.getByRole("button", { name: "Invited" }));

    expect(screen.getByRole("dialog", { name: "Individual invitation" }).dataset.state).toBe(
      "pending",
    );

    view.rerender(workspaceElement({ linkState: "active" }));
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connected" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Individual invitation" })).toBeNull();
  });

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
