// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockSendOffer = (input: {
  offerId: string;
}) => Promise<
  { ok: false; error: string } | { ok: true; data: { id: string; emailDelivered: boolean | null } }
>;

const mocks = vi.hoisted(() => ({
  cancelPdf: vi.fn(),
  loadProjects: vi.fn(),
  preparePdf: vi.fn(),
  refresh: vi.fn(),
  sendOffer: vi.fn<MockSendOffer>(),
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

vi.mock("~/app/(producer)/dashboard/booking/actions", () => ({
  cancelAgreementPdfUpload: mocks.cancelPdf,
  prepareAgreementPdfUpload: mocks.preparePdf,
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
  type PrivateOfferSentSummary,
  type PrivateOfferTemplateProduct,
} from "../private-offer-composer";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";

const RECIPIENTS: PrivateOfferComposerRecipient[] = [
  { id: "client-1", name: "Maya Stone", email: "maya@example.test", projects: [] },
  { id: "client-2", name: "Noah Reed", email: "noah@example.test", projects: [] },
];

const VALID_TEMPLATE: PrivateOfferTemplateProduct = {
  source: {
    productId: PRODUCT_ID,
    productName: "Single production",
    productKind: "production",
  },
  terms: {
    name: "Single production",
    tagline: "Release-ready production",
    service: "Production",
    deliverables: ["Final master", "Instrumental"],
    cashPriceCents: 10_000,
    currency: "USD",
    taxMode: "tax_added",
    taxRatePct: 18,
    includedSongSpaces: 1,
    session: null,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: {
      master: { mode: "none" },
      composition: { mode: "none" },
    },
    rights: ["Artist may release the final master."],
    enabledPaymentPlans: [{ kind: "full" }],
    agreementText: "These are the complete private-offer terms.",
  },
  pricing: { kind: "fixed" },
  rightsNeedCompletion: false,
  agreementNeedsCompletion: false,
};

const PDF_TEMPLATE: PrivateOfferTemplateProduct = {
  ...VALID_TEMPLATE,
  terms: {
    ...VALID_TEMPLATE.terms,
    agreementMode: "pdf",
    agreementText: "",
  },
  agreementPdf: {
    documentId: DOCUMENT_ID,
    originalFileName: "Single Production Agreement.pdf",
    sizeBytes: 1_024,
  },
};

const INITIAL_OFFER: PrivateOfferComposerInitialOffer = {
  id: OFFER_ID,
  clientContactId: "client-1",
  targetProjectId: null,
  productId: PRODUCT_ID,
  sourceProductName: "Single production",
  recipientName: "Maya Stone",
  recipientEmail: "maya@example.test",
  terms: VALID_TEMPLATE.terms,
  expiresAt: "2099-09-01T00:00:00.000Z",
  expectedUpdatedAt: "2026-08-11T12:00:00.000Z",
};

function commonProps() {
  return {
    recipients: RECIPIENTS,
    defaultCurrency: "USD" as const,
    taxMode: "tax_added" as const,
    taxRatePct: 18,
  };
}

function ControlledTemplateComposer({
  templateProduct = VALID_TEMPLATE,
  onCreated = vi.fn(),
  onOpenChange = vi.fn(),
}: {
  templateProduct?: PrivateOfferTemplateProduct;
  onCreated?: (sent: PrivateOfferSentSummary) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={returnFocusRef}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Product action
      </button>
      <PrivateOfferComposer
        {...commonProps()}
        templateProduct={templateProduct}
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

async function selectMaya(user: ReturnType<typeof userEvent.setup>) {
  const recipient = screen.getByRole("combobox", { name: "Recipient" });
  await user.click(recipient);
  await user.click(screen.getByRole("option", { name: /Maya Stone/ }));
}

async function reachPrice(user: ReturnType<typeof userEvent.setup>) {
  await selectMaya(user);
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  await screen.findByRole("heading", { name: "Price & terms" });
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await reachPrice(user);
  await user.click(screen.getByRole("button", { name: "Review offer →" }));
  await screen.findByRole("heading", { name: "Review private offer" });
}

beforeEach(() => {
  mocks.cancelPdf.mockReset().mockResolvedValue({ ok: true, data: { cancelled: true } });
  mocks.loadProjects.mockReset().mockResolvedValue({ ok: true, data: [] });
  mocks.preparePdf.mockReset();
  mocks.refresh.mockReset();
  mocks.sendOffer.mockReset();
  mocks.toast.mockReset();
  mocks.updateOffer.mockReset();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(OFFER_ID);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("product-based Private Offer composer", () => {
  it("uses exactly two labeled editing steps and advances only through Continue", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);

    expect(screen.getByRole("heading", { name: "Recipient" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Recipient$/ }).getAttribute("aria-current")).toBe(
      "step",
    );
    expect(screen.getByRole("button", { name: /Price & terms$/ })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/Step 3/)).toBeNull();

    await selectMaya(user);
    expect(screen.getByRole("heading", { name: "Recipient" })).not.toBeNull();
    expect(screen.getByText(/A new project will be created/)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue →" }));
    expect(await screen.findByRole("heading", { name: "Price & terms" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Recipient$/ }).querySelector("svg")).not.toBeNull();
  });

  it("uses a writable combobox, normalizes existing email matches, and requires a new client name", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);

    const recipient = screen.getByRole("combobox", { name: "Recipient" });
    await user.type(recipient, "MAYA@EXAMPLE.TEST");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Maya Stone/ })).not.toBeNull();

    await user.clear(recipient);
    await user.type(recipient, "noa@example.test");
    await user.click(screen.getByRole("option", { name: /noa@example.test/i }));
    const name = screen.getByLabelText("Client name");
    expect((name as HTMLInputElement).required).toBe(true);
    await user.click(screen.getByRole("button", { name: "Continue →" }));
    expect(screen.getByRole("alert").textContent).toContain("Add the new recipient’s name.");
    await user.type(name, "Noa Levi");
    await user.click(screen.getByRole("button", { name: "Continue →" }));
    expect(await screen.findByRole("heading", { name: "Price & terms" })).not.toBeNull();
  });

  it("keeps new project usable during project failure and retries only on request", async () => {
    mocks.loadProjects.mockResolvedValueOnce({ ok: false, error: "Projects are unavailable." });
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);
    await selectMaya(user);
    await user.click(screen.getByRole("button", { name: "Change" }));
    await waitFor(() => {
      expect(screen.getByText("Projects are unavailable.")).not.toBeNull();
    });
    expect(screen.getByText(/A new project will be created/)).not.toBeNull();
    expect(mocks.loadProjects).toHaveBeenCalledOnce();
    mocks.loadProjects.mockResolvedValueOnce({ ok: true, data: [] });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(mocks.loadProjects).toHaveBeenCalledTimes(2);
    });
    await user.click(screen.getByRole("button", { name: "Continue →" }));
    expect(await screen.findByRole("heading", { name: "Price & terms" })).not.toBeNull();
  });

  it("keeps only price expanded and shows accurate copied terms and tax", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);
    await reachPrice(user);

    expect(screen.getByLabelText("Your price before VAT")).toHaveProperty("value", "100.00");
    expect(screen.getByText("$118.00")).not.toBeNull();
    expect(screen.getByText(/\$18\.00 · 18%/)).not.toBeNull();
    expect(screen.getByText("Terms copied from Single production")).not.toBeNull();
    expect(screen.getByText(/Pay in full · Written agreement · Expires/)).not.toBeNull();
    expect(screen.queryByLabelText("Songs")).toBeNull();
    expect(screen.queryByText(/number of hours/i)).toBeNull();
    expect(screen.queryByText(/View terms/i)).toBeNull();
  });

  it("runs the five-step Customize flow and returns to the compact price screen", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);
    await reachPrice(user);
    await user.click(screen.getByRole("button", { name: "Customize" }));

    for (const heading of ["Product details", "Price", "Payment options", "Delivery"]) {
      expect(screen.getByRole("heading", { name: heading })).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "Continue →" }));
    }
    expect(screen.getByRole("heading", { name: "Rights & agreement" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Save customizations" }));
    expect(await screen.findByRole("heading", { name: "Price & terms" })).not.toBeNull();
    expect(screen.getByText("Terms based on Single production")).not.toBeNull();
  });

  it("shows one read-only Review and Edit offer preserves in-memory price", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);
    await reachPrice(user);
    const price = screen.getByLabelText("Your price before VAT");
    fireEvent.change(price, { target: { value: "145.00" } });
    await user.click(screen.getByRole("button", { name: "Review offer →" }));

    expect(await screen.findByRole("heading", { name: "Review private offer" })).not.toBeNull();
    expect(screen.getByText("To:").parentElement?.textContent).toContain(
      "To: Maya Stone · maya@example.test",
    );
    expect(screen.getByText("$145")).not.toBeNull();
    expect(screen.getByText("$171.10")).not.toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Step 3/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit offer" }));
    expect(await screen.findByLabelText("Your price before VAT")).toHaveProperty("value", "145.00");
  });

  it("inherits the exact product PDF and exposes its authorized Review link", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer templateProduct={PDF_TEMPLATE} />);
    await reachReview(user);

    const view = screen.getByRole("link", { name: /View/ });
    expect(view.getAttribute("href")).toBe(
      `/api/agreement-pdfs/evidence?productId=${PRODUCT_ID}&documentId=${DOCUMENT_ID}`,
    );
    expect(screen.getByText("Single Production Agreement.pdf")).not.toBeNull();
  });

  it("reuses one logical send id after failure and closes on persisted success", async () => {
    mocks.sendOffer
      .mockResolvedValueOnce({ ok: false, error: "Try again." })
      .mockResolvedValueOnce({ ok: true, data: { id: OFFER_ID, emailDelivered: true } });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<ControlledTemplateComposer onCreated={onCreated} />);
    await reachReview(user);

    await user.click(screen.getByRole("button", { name: "Send private offer →" }));
    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledOnce();
    });
    await user.click(screen.getByRole("button", { name: "Send private offer →" }));
    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledTimes(2);
    });
    expect(mocks.sendOffer.mock.calls[0]?.[0].offerId).toBe(OFFER_ID);
    expect(mocks.sendOffer.mock.calls[1]?.[0].offerId).toBe(OFFER_ID);
    expect(onCreated).toHaveBeenCalledWith({
      offerId: OFFER_ID,
      offerName: "Single production",
      recipientName: "Maya Stone",
      recipientEmail: "maya@example.test",
      emailDelivered: true,
    });
    // With a share surface wired via onCreated, the popup reports the
    // outcome — the send-success toast stays suppressed.
    expect(mocks.toast).toHaveBeenLastCalledWith("Try again.", "error");
    expect(mocks.toast).not.toHaveBeenCalledWith(
      "Private offer sent to maya@example.test.",
      "success",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirms changed close, removes drafts, and reopens a fresh flow", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);
    await selectMaya(user);
    await user.click(screen.getByRole("button", { name: "Close private offer editor" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Close this offer?" });
    expect(confirmation.textContent).toContain("Your changes will be lost.");
    expect(screen.queryByText("Discard draft")).toBeNull();
    await user.click(within(confirmation).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("dialog")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Close private offer editor" }));
    await user.click(screen.getByRole("button", { name: "Close offer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Product action" }));
    expect(await screen.findByRole("combobox", { name: "Recipient" })).toHaveProperty("value", "");
  });

  it("edits a sent product offer directly from Price and uses the update mutation", async () => {
    mocks.updateOffer.mockResolvedValue({
      ok: true,
      data: {
        id: OFFER_ID,
        updatedAt: "2026-08-15T10:00:00.000Z",
        changed: true,
        emailDelivered: true,
      },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <PrivateOfferComposer
        {...commonProps()}
        initialOffer={INITIAL_OFFER}
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        trigger={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Edit private offer" })).not.toBeNull();
    expect(screen.getByText("Editing offer for Maya Stone · maya@example.test")).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Recipient" })).toBeNull();
    expect(screen.queryByLabelText("Private offer editing steps")).toBeNull();
    expect(screen.getByText(/After acceptance:/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Review offer →" }));
    expect(await screen.findByRole("heading", { name: "Review changes" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(mocks.updateOffer).toHaveBeenCalledOnce();
    });
    expect(mocks.updateOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: OFFER_ID,
        expectedUpdatedAt: INITIAL_OFFER.expectedUpdatedAt,
        recipient: { kind: "existing", clientContactId: "client-1" },
      }),
    );
    expect(mocks.sendOffer).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
