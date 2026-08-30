// @vitest-environment jsdom

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPrivateOfferInviteUrl } from "~/lib/clients/invite-url";

import type { PrivateOfferSentSummary } from "../private-offer-composer";
import { privateOfferWhatsAppUrl } from "../private-offer-share";

const mocks = vi.hoisted(() => ({
  cancelOffer: vi.fn(),
  composerProps: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

interface ComposerMockProps {
  initialOffer?: { id: string };
  onCreated?: (sent: PrivateOfferSentSummary) => void;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("~/app/(producer)/dashboard/store/private-offer-actions", () => ({
  cancelPrivateOfferAction: mocks.cancelOffer,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("../private-offer-composer", () => ({
  PrivateOfferComposer: (props: ComposerMockProps) => {
    mocks.composerProps(props);
    if (props.initialOffer) {
      return (
        <button type="button" data-testid={`edit-${props.initialOffer.id}`}>
          Edit private offer
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          props.onCreated?.({
            offerId: "55555555-5555-4555-8555-555555555555",
            offerName: "Album deal",
            recipientName: "Noa Levi",
            recipientEmail: "noa@example.test",
            emailDelivered: true,
          });
        }}
      >
        New private offer
      </button>
    );
  },
}));

import { PrivateOfferManager, type ProducerPrivateOfferItem } from "../private-offer-manager";

const DAY_MS = 24 * 60 * 60 * 1_000;

function draft(name: string, totalCents: number): PurchaseCommercialSnapshot {
  return {
    version: 2,
    bookingEnabled: false,
    productOrOfferName: name,
    service: "Production",
    deliverables: ["Final master"],
    lineItems: [
      {
        label: name,
        quantity: 1,
        listUnitPriceCents: totalCents,
        unitPriceCents: totalCents,
        totalCents,
      },
    ],
    listSubtotalCents: totalCents,
    discountCents: 0,
    subtotalCents: totalCents,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents,
    currency: "USD",
    includedSongSpaces: 1,
    session: null,
    revisionRule: null,
    royaltyTerms: null,
    rights: ["Artist may release the final master."],
    selectedPaymentPlan: null,
    offeredPaymentPlans: [{ kind: "full" }],
    agreementText: "The displayed private-offer terms are the complete agreement.",
    agreementMode: "none",
  };
}

let nextOfferSequence = 0;

function offer(
  overrides: Partial<ProducerPrivateOfferItem> & { name: string },
): ProducerPrivateOfferItem {
  nextOfferSequence += 1;
  const { name, ...rest } = overrides;
  return {
    id: `00000000-0000-4000-8000-${String(nextOfferSequence).padStart(12, "0")}`,
    status: "sent",
    commercialDraft: draft(name, 120_000),
    expiresAt: new Date(Date.now() + 10 * DAY_MS),
    acceptedAt: null,
    createdAt: new Date(Date.now() - 5 * DAY_MS),
    updatedAt: new Date(Date.now() - 5 * DAY_MS),
    clientContactId: "client-1",
    recipientName: "Maya Stone",
    recipientEmail: "maya@example.test",
    targetProjectId: null,
    targetProjectTitle: null,
    purchaseId: null,
    purchaseLifecycleStatus: null,
    ...rest,
  };
}

function renderManager(offers: ProducerPrivateOfferItem[]) {
  render(
    <PrivateOfferManager
      recipients={[
        { id: "client-1", name: "Maya Stone", email: "maya@example.test", projects: [] },
      ]}
      offers={offers}
      defaultCurrency="USD"
      taxMode="tax_free"
      taxRatePct={0}
      producerSlug="gili-asraf"
    />,
  );
}

beforeEach(() => {
  nextOfferSequence = 0;
  mocks.cancelOffer.mockReset();
  mocks.composerProps.mockClear();
  mocks.open.mockReset();
  mocks.refresh.mockReset();
  mocks.toast.mockReset();
  vi.stubGlobal("open", mocks.open);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<PrivateOfferManager> work queue", () => {
  it("sorts waiting offers by soonest expiry with urgency labels and keeps history collapsed", () => {
    renderManager([
      offer({ name: "Far out", expiresAt: new Date(Date.now() + 10 * DAY_MS) }),
      offer({ name: "Won deal", status: "accepted", acceptedAt: new Date("2026-08-01T00:00:00Z") }),
      offer({ name: "Last call", expiresAt: new Date(Date.now() + 1 * DAY_MS) }),
      offer({ name: "Lost deal", status: "declined" }),
      offer({ name: "Chase soon", expiresAt: new Date(Date.now() + 3 * DAY_MS) }),
    ]);

    expect(screen.getByText("Waiting for artist · 3")).not.toBeNull();
    const waitingNames = screen
      .getAllByRole("listitem")
      .map((item) => within(item).getByText(/Far out|Last call|Chase soon/).textContent);
    expect(waitingNames).toEqual(["Last call", "Chase soon", "Far out"]);
    expect(screen.getByText("Expires in 1 day")).not.toBeNull();
    expect(screen.getByText("Expires in 3 days")).not.toBeNull();

    const historyToggle = screen.getByRole("button", { name: /History · 2/ });
    expect(historyToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Won deal")).toBeNull();
    expect(screen.queryByText("Lost deal")).toBeNull();
  });

  it("expands history with colored outcomes and pages long lists", async () => {
    const user = userEvent.setup();
    const terminal: ProducerPrivateOfferItem[] = [
      offer({ name: "Won deal", status: "accepted", acceptedAt: new Date("2026-08-01T00:00:00Z") }),
      offer({ name: "Lost deal", status: "declined" }),
    ];
    for (let index = 0; index < 8; index += 1) {
      terminal.push(
        offer({
          name: `Old offer ${String(index + 1)}`,
          status: "expired",
          createdAt: new Date(Date.now() - (30 + index) * DAY_MS),
        }),
      );
    }
    renderManager(terminal);

    expect(screen.getByText("No offers waiting on an artist right now.")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /History · 10/ }));

    expect(screen.getByText("Accepted")).not.toBeNull();
    expect(screen.getByText("Rejected")).not.toBeNull();
    expect(screen.getByText(/Accepted 1 Aug 2026/)).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  });

  it("shares a waiting offer through WhatsApp with the producer-join link", async () => {
    const user = userEvent.setup();
    const waiting = offer({ name: "Mix & master" });
    renderManager([waiting]);

    await user.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share private offer" });
    expect(dialog.textContent).toContain("maya@example.test");
    await user.click(within(dialog).getByRole("button", { name: "Share on WhatsApp" }));

    expect(mocks.open).toHaveBeenCalledWith(
      privateOfferWhatsAppUrl(buildPrivateOfferInviteUrl("gili-asraf", waiting.id)),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens the sent share surface and refreshes after the composer reports a send", async () => {
    const user = userEvent.setup();
    renderManager([]);

    await user.click(screen.getByRole("button", { name: "New private offer" }));

    expect(screen.getByRole("dialog", { name: "Offer sent to Noa Levi" })).not.toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
