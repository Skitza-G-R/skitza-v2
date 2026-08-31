// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PrivateOfferShareModal,
  privateOfferShareMessage,
  privateOfferWhatsAppUrl,
} from "../private-offer-share";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  open: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const OFFER = {
  offerId: "00000000-0000-4000-8000-000000000001",
  offerName: "Single production",
  recipientName: "Maya Stone",
  recipientEmail: "maya@example.test",
} as const;

const SHARE_URL =
  "https://skitza.app/sign-up/join/gili-asraf/offer/00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.copy.mockReset().mockResolvedValue(undefined);
  mocks.open.mockReset();
  mocks.toast.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  });
  vi.stubGlobal("open", mocks.open);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("private-offer share helpers", () => {
  it("builds a wa.me chat-picker URL around the encoded offer link", () => {
    const url = privateOfferWhatsAppUrl(SHARE_URL);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).toContain(encodeURIComponent(SHARE_URL));
    expect(decodeURIComponent(url.split("?text=")[1] ?? "")).toBe(
      privateOfferShareMessage(SHARE_URL),
    );
  });
});

describe("<PrivateOfferShareModal>", () => {
  it("celebrates a just-sent offer and locks the link story to the invited email", () => {
    render(
      <PrivateOfferShareModal
        open
        onClose={vi.fn()}
        offer={{ ...OFFER, emailDelivered: true }}
        producerSlug="gili-asraf"
        occasion="sent"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Offer sent to Maya Stone" })).not.toBeNull();
    expect(screen.getByText("maya@example.test")).not.toBeNull();
    expect(screen.getByText("The offer opens only for this verified email.")).not.toBeNull();
    expect(screen.queryByText(/couldn’t be delivered/)).toBeNull();
  });

  it("opens WhatsApp with the producer-join offer link and records nothing", async () => {
    const user = userEvent.setup();
    render(
      <PrivateOfferShareModal
        open
        onClose={vi.fn()}
        offer={OFFER}
        producerSlug="gili-asraf"
        occasion="reshare"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Share private offer" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Share on WhatsApp" }));
    expect(mocks.open).toHaveBeenCalledWith(
      privateOfferWhatsAppUrl(SHARE_URL),
      "_blank",
      "noopener,noreferrer",
    );
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it("copies the offer link and confirms with a toast", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(
      <PrivateOfferShareModal
        open
        onClose={vi.fn()}
        offer={OFFER}
        producerSlug="gili-asraf"
        occasion="reshare"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SHARE_URL);
    });
    expect(await screen.findByRole("button", { name: "Link copied" })).not.toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith("Offer link copied", "success");
  });

  it("flags a failed notification email so the producer sends the link", () => {
    render(
      <PrivateOfferShareModal
        open
        onClose={vi.fn()}
        offer={{ ...OFFER, emailDelivered: false }}
        producerSlug="gili-asraf"
        occasion="sent"
      />,
    );

    expect(
      screen.getByText("The email notification couldn’t be delivered — send the link yourself."),
    ).not.toBeNull();
  });
});
