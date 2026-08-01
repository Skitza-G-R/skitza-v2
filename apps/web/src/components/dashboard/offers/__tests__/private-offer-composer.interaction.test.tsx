// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadProjects: vi.fn(),
  refresh: vi.fn(),
  sendOffer: vi.fn(),
  toast: vi.fn(),
  updateOffer: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("~/app/(producer)/dashboard/store/private-offer-actions", () => ({
  loadPrivateOfferProjectOptionsAction: mocks.loadProjects,
  sendPrivateOfferAction: mocks.sendOffer,
  updatePrivateOfferAction: mocks.updateOffer,
}));

vi.mock("~/components/dashboard/tax-mode-segmented", () => ({
  TaxModeSegmented: () => null,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import {
  PrivateOfferComposer,
  type PrivateOfferComposerInitialOffer,
  type PrivateOfferComposerRecipient,
} from "../private-offer-composer";

const RECIPIENTS: PrivateOfferComposerRecipient[] = [
  {
    id: "client-1",
    name: "Maya Stone",
    email: "maya@example.test",
    projects: [],
  },
];

const INITIAL_OFFER: PrivateOfferComposerInitialOffer = {
  id: "offer-existing",
  clientContactId: "client-1",
  targetProjectId: null,
  terms: {
    name: "Existing private offer",
    service: "Production",
    deliverables: ["Final mix"],
    cashPriceCents: 0,
    currency: "USD",
    taxMode: "tax_added",
    taxRatePct: 18,
    includedSongSpaces: 1,
    session: null,
    revisionRule: { kind: "fixed", count: 1 },
    royaltyTerms: {
      master: { mode: "none" },
      composition: { mode: "none" },
    },
    rights: ["Artist may release the final master."],
    enabledPaymentPlans: [],
    agreementText: "These are the complete private-offer terms.",
  },
  expiresAt: "2099-09-01T00:00:00.000Z",
  expectedUpdatedAt: "2026-07-01T00:00:00.000Z",
};

function composerProps() {
  return {
    recipients: RECIPIENTS,
    lockedClientId: "client-1",
    defaultCurrency: "USD" as const,
    taxMode: "tax_added" as const,
    taxRatePct: 18,
  };
}

function ControlledHeadlessComposer({
  onCreated,
  onOpenChange,
}: {
  onCreated: (offerId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button" data-testid="composer-return-focus">
        Return focus target
      </button>
      <PrivateOfferComposer
        {...composerProps()}
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen);
          setOpen(nextOpen);
        }}
        onCreated={onCreated}
        trigger={null}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}

async function fillValidCreateFlow(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("button", { name: "Next" }));

  await user.type(within(dialog).getByLabelText("Offer name"), "Custom production");
  await user.type(within(dialog).getByLabelText("Service"), "Production");
  await user.type(within(dialog).getByLabelText("Deliverables"), "Final mix");
  await user.click(within(dialog).getByRole("button", { name: "Next" }));

  await user.click(within(dialog).getByRole("button", { name: "Next" }));

  await user.type(within(dialog).getByLabelText("Rights"), "Artist may release the final master.");
  await user.click(within(dialog).getByRole("button", { name: "Next" }));

  await user.type(
    within(dialog).getByLabelText("Exact agreement"),
    "These are the complete private-offer terms.",
  );
}

async function reachFinalEditStep(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  for (let step = 0; step < 4; step += 1) {
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
  }
}

beforeEach(() => {
  mocks.loadProjects.mockReset();
  mocks.refresh.mockReset();
  mocks.sendOffer.mockReset();
  mocks.toast.mockReset();
  mocks.updateOffer.mockReset();

  mocks.loadProjects.mockResolvedValue({ ok: true, data: [] });
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

describe("PrivateOfferComposer compatibility", () => {
  it("starts at step one and validates only the visible step before advancing", async () => {
    const user = userEvent.setup();

    render(<ControlledHeadlessComposer onCreated={vi.fn()} onOpenChange={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Send a private offer" });
    expect(within(dialog).getByText("Step 1 of 5")).not.toBeNull();
    expect(dialog.querySelectorAll('[aria-current="step"]')).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText("Step 2 of 5")).not.toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Add an offer name.");
    expect(within(dialog).getByText("Step 2 of 5")).not.toBeNull();
    expect(mocks.sendOffer).not.toHaveBeenCalled();
  });

  it("keeps entered values when moving back and forward", async () => {
    const user = userEvent.setup();

    render(<ControlledHeadlessComposer onCreated={vi.fn()} onOpenChange={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Send a private offer" });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.type(within(dialog).getByLabelText("Offer name"), "Preserved offer");
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(within(dialog).getByLabelText<HTMLInputElement>("Offer name").value).toBe(
      "Preserved offer",
    );
  });

  it("uses Enter as Next on an intermediate step without sending", async () => {
    const user = userEvent.setup();

    render(<ControlledHeadlessComposer onCreated={vi.fn()} onOpenChange={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Send a private offer" });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    const offerName = within(dialog).getByLabelText("Offer name");
    await user.type(offerName, "Keyboard offer");
    await user.type(within(dialog).getByLabelText("Service"), "Production");
    await user.type(within(dialog).getByLabelText("Deliverables"), "Final mix");
    await user.click(offerName);
    await user.keyboard("{Enter}");

    expect(within(dialog).getByText("Step 3 of 5")).not.toBeNull();
    expect(mocks.sendOffer).not.toHaveBeenCalled();
  });

  it("returns to step one when an uncontrolled composer is reopened", async () => {
    const user = userEvent.setup();

    render(<PrivateOfferComposer {...composerProps()} />);

    await user.click(screen.getByRole("button", { name: "New private offer" }));
    let dialog = await screen.findByRole("dialog", { name: "Send a private offer" });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText("Step 2 of 5")).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Close private offer composer" }));

    await user.click(screen.getByRole("button", { name: "New private offer" }));
    dialog = await screen.findByRole("dialog", { name: "Send a private offer" });
    expect(within(dialog).getByText("Step 1 of 5")).not.toBeNull();
  });

  it("calls a controlled create callback once before close without refreshing the route", async () => {
    mocks.sendOffer.mockResolvedValue({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    const events: string[] = [];
    const onCreated = vi.fn((offerId: string) => {
      events.push(`created:${offerId}`);
    });
    const onOpenChange = vi.fn((open: boolean) => {
      events.push(`open:${String(open)}`);
    });
    const user = userEvent.setup();

    render(<ControlledHeadlessComposer onCreated={onCreated} onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole("dialog", { name: "Send a private offer" });
    await fillValidCreateFlow(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send a private offer" })).toBeNull();
    });
    expect(mocks.sendOffer).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith("offer-created");
    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(events).toEqual(["created:offer-created", "open:false"]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.sendOffer).toHaveBeenCalledWith({
      recipient: { kind: "existing", clientContactId: "client-1" },
      target: { kind: "new" },
      terms: {
        name: "Custom production",
        service: "Production",
        deliverables: ["Final mix"],
        cashPriceCents: 0,
        currency: "USD",
        taxMode: "tax_added",
        taxRatePct: 18,
        includedSongSpaces: 0,
        session: null,
        revisionRule: { kind: "fixed", count: 0 },
        royaltyTerms: {
          master: { mode: "none" },
          composition: { mode: "none" },
        },
        rights: ["Artist may release the final master."],
        enabledPaymentPlans: [],
        agreementText: "These are the complete private-offer terms.",
      },
      expiresAt: expect.any(String) as unknown as string,
    });
  });

  it("keeps an uncontrolled Store create closing and refreshing the route", async () => {
    mocks.sendOffer.mockResolvedValue({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    const user = userEvent.setup();

    render(<PrivateOfferComposer {...composerProps()} />);

    await user.click(screen.getByRole("button", { name: "New private offer" }));
    const dialog = await screen.findByRole("dialog", { name: "Send a private offer" });
    await fillValidCreateFlow(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send a private offer" })).toBeNull();
      expect(mocks.refresh).toHaveBeenCalledOnce();
    });
    expect(mocks.sendOffer).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "New private offer" })).not.toBeNull();
  });

  it("keeps an uncontrolled Store edit refreshing without calling onCreated", async () => {
    mocks.updateOffer.mockResolvedValue({
      ok: true,
      data: { id: "offer-existing" },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();

    render(
      <PrivateOfferComposer
        {...composerProps()}
        initialOffer={INITIAL_OFFER}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit private offer" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit private offer" });
    await reachFinalEditStep(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Save corrections" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit private offer" })).toBeNull();
      expect(mocks.refresh).toHaveBeenCalledOnce();
    });
    expect(mocks.updateOffer).toHaveBeenCalledOnce();
    expect(mocks.updateOffer).toHaveBeenCalledWith({
      offerId: "offer-existing",
      expectedUpdatedAt: "2026-07-01T00:00:00.000Z",
      recipient: { kind: "existing", clientContactId: "client-1" },
      target: { kind: "new" },
      terms: INITIAL_OFFER.terms,
      expiresAt: expect.any(String) as unknown as string,
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps a failed create open without closing, notifying onCreated, or refreshing", async () => {
    mocks.sendOffer.mockResolvedValue({
      ok: false,
      error: "The private offer could not be saved.",
    });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<ControlledHeadlessComposer onCreated={onCreated} onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole("dialog", { name: "Send a private offer" });
    await fillValidCreateFlow(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Send a private offer" })).not.toBeNull();
    expect(mocks.sendOffer).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("dismisses a controlled headless composer without callbacks or refresh and restores focus", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<ControlledHeadlessComposer onCreated={onCreated} onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole("dialog", { name: "Send a private offer" });
    const returnFocusTarget = screen.getByTestId("composer-return-focus");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send a private offer" })).toBeNull();
      expect(document.activeElement).toBe(returnFocusTarget);
    });
    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(mocks.sendOffer).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
