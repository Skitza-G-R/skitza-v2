// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearDraft: vi.fn(),
  draftLoaded: true,
  draftRecord: null as unknown,
  loadProjects: vi.fn(),
  refresh: vi.fn(),
  saveDraft: vi.fn(),
  sendOffer: vi.fn(),
  toast: vi.fn(),
  updateOffer: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/store",
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

vi.mock("~/components/runtime-state/use-runtime-state", () => ({
  useProducerPrivateOfferDraft: () => ({
    record: mocks.draftRecord,
    loaded: mocks.draftLoaded,
    save: mocks.saveDraft,
    clear: mocks.clearDraft,
  }),
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import {
  PrivateOfferComposer,
  type PrivateOfferComposerInitialOffer,
  type PrivateOfferComposerRecipient,
  type PrivateOfferTemplateProduct,
} from "../private-offer-composer";
import { seedPrivateOfferDraft } from "../private-offer-editor-model";

const RECIPIENTS: PrivateOfferComposerRecipient[] = [
  {
    id: "client-1",
    name: "Maya Stone",
    email: "maya@example.test",
    projects: [],
  },
  {
    id: "client-2",
    name: "Noah Reed",
    email: "noah@example.test",
    projects: [],
  },
];

const VALID_TEMPLATE: PrivateOfferTemplateProduct = {
  source: {
    productId: "product-single-production",
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
  agreementNeedsCompletion: false,
};

const PER_SONG_TEMPLATE: PrivateOfferTemplateProduct = {
  ...VALID_TEMPLATE,
  source: {
    productId: "product-per-song-production",
    productName: "Production by song",
    productKind: "production",
  },
  pricing: {
    kind: "per_song",
    initialQuantity: 1,
    volumeTiers: [
      { minQty: 1, pricePerUnitCents: 10_000 },
      { minQty: 3, pricePerUnitCents: 8_000 },
    ],
  },
};

const INITIAL_OFFER: PrivateOfferComposerInitialOffer = {
  id: "offer-existing",
  clientContactId: "client-1",
  targetProjectId: null,
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

function persistedTemplateDraft(
  draftOverrides: Partial<ReturnType<typeof seedPrivateOfferDraft>> = {},
  recordOverrides: Record<string, unknown> = {},
) {
  const draft = {
    ...seedPrivateOfferDraft({
      defaultCurrency: "USD",
      taxMode: "tax_added",
      taxRatePct: 18,
      templateProduct: VALID_TEMPLATE,
    }),
    clientContactId: "client-1",
    ...draftOverrides,
  };
  return {
    version: 1,
    entryKey: "template:product-single-production",
    mode: "new",
    existingOfferId: null,
    expectedUpdatedAt: null,
    currentStep: "quick:quick",
    draftJson: JSON.stringify(draft),
    submissionOfferId: null,
    ...recordOverrides,
  };
}

function persistedEditDraft(recordOverrides: Record<string, unknown> = {}) {
  const draft = {
    ...seedPrivateOfferDraft({
      defaultCurrency: "USD",
      taxMode: "tax_added",
      taxRatePct: 18,
      initialOffer: INITIAL_OFFER,
    }),
    name: "Restored correction",
  };
  return {
    version: 1,
    entryKey: `edit:${INITIAL_OFFER.id}:${INITIAL_OFFER.expectedUpdatedAt}`,
    mode: "edit",
    existingOfferId: INITIAL_OFFER.id,
    expectedUpdatedAt: INITIAL_OFFER.expectedUpdatedAt,
    currentStep: "full:details",
    draftJson: JSON.stringify(draft),
    submissionOfferId: null,
    ...recordOverrides,
  };
}

function ControlledTemplateComposer({
  templateProduct = VALID_TEMPLATE,
  onCreated = vi.fn(),
  onOpenChange = vi.fn(),
}: {
  templateProduct?: PrivateOfferTemplateProduct;
  onCreated?: (offerId: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={returnFocusRef}
        type="button"
        data-testid="return-focus"
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

function ControlledEditComposer({
  onCreated = vi.fn(),
  onOpenChange = vi.fn(),
}: {
  onCreated?: (offerId: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <PrivateOfferComposer
      {...commonProps()}
      initialOffer={INITIAL_OFFER}
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        setOpen(nextOpen);
      }}
      onCreated={onCreated}
      trigger={null}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function chooseRecipientAndReview(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole("dialog");
  await user.selectOptions(within(dialog).getByLabelText("Recipient"), "client-1");
  await user.click(within(dialog).getByRole("button", { name: "Review offer →" }));
  return dialog;
}

beforeEach(() => {
  mocks.clearDraft.mockReset();
  mocks.draftLoaded = true;
  mocks.draftRecord = null;
  mocks.loadProjects.mockReset();
  mocks.refresh.mockReset();
  mocks.saveDraft.mockReset();
  mocks.sendOffer.mockReset();
  mocks.toast.mockReset();
  mocks.updateOffer.mockReset();
  mocks.clearDraft.mockImplementation(() => {
    mocks.draftRecord = null;
  });
  mocks.saveDraft.mockImplementation((record: unknown) => {
    mocks.draftRecord = record;
    return true;
  });
  mocks.loadProjects.mockResolvedValue({ ok: true, data: [] });
  vi.spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
    .mockReturnValue("22222222-2222-4222-8222-222222222222");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PrivateOfferComposer shared editor", () => {
  it("restores only the exact matching template draft after runtime storage loads", async () => {
    mocks.draftRecord = persistedTemplateDraft({ cashPrice: "145.00" });
    mocks.draftLoaded = false;
    const view = render(<ControlledTemplateComposer />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Cash price").value).toBe("100.00");
    expect(mocks.saveDraft).not.toHaveBeenCalled();

    mocks.draftLoaded = true;
    view.rerender(<ControlledTemplateComposer />);
    await waitFor(() => {
      expect(within(dialog).getByLabelText<HTMLSelectElement>("Recipient").value).toBe("client-1");
      expect(within(dialog).getByLabelText<HTMLInputElement>("Cash price").value).toBe("145.00");
    });
  });

  it("ignores a draft for a different entry and ignores tampered partial JSON", async () => {
    mocks.draftRecord = persistedTemplateDraft(
      { cashPrice: "145.00" },
      { entryKey: "template:another-product" },
    );
    const first = render(<ControlledTemplateComposer />);
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>("Recipient").value).toBe("");
      expect(screen.getByLabelText<HTMLInputElement>("Cash price").value).toBe("100.00");
    });
    first.unmount();

    mocks.draftRecord = persistedTemplateDraft({}, { draftJson: '{"clientContactId":"client-1"}' });
    render(<ControlledTemplateComposer />);
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>("Recipient").value).toBe("");
      expect(screen.getByLabelText<HTMLInputElement>("Cash price").value).toBe("100.00");
    });
  });

  it("restores Review only after full validation and otherwise opens the missing full step", async () => {
    mocks.draftRecord = persistedTemplateDraft({ rights: "" }, { currentStep: "quick:review" });
    render(<ControlledTemplateComposer />);

    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByRole("heading", { name: "Rights & agreement" }),
    ).not.toBeNull();
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Write the rights included in this offer.",
    );
  });

  it("keeps an existing-project Review restored while that client's projects load", async () => {
    const projects = deferred<{
      ok: true;
      data: Array<{
        id: string;
        title: string;
        createdAtIso: string;
        lifecycleStatus: "active";
        songCount: number;
        balances: never[];
      }>;
    }>();
    mocks.loadProjects.mockReturnValue(projects.promise);
    mocks.draftRecord = persistedTemplateDraft(
      {
        targetKind: "existing",
        targetProjectId: "project-client-1",
      },
      { currentStep: "quick:review" },
    );
    render(<ControlledTemplateComposer />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Review & send" })).not.toBeNull();
    expect(mocks.loadProjects).toHaveBeenCalledOnce();
    expect(mocks.loadProjects).toHaveBeenCalledWith("client-1");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });
    expect(
      mocks.saveDraft.mock.calls.some(
        ([record]) =>
          (record as { currentStep?: string }).currentStep === "full:recipient",
      ),
    ).toBe(false);

    await act(async () => {
      projects.resolve({
        ok: true,
        data: [
          {
            id: "project-client-1",
            title: "Maya's album",
            createdAtIso: "2026-08-01T00:00:00.000Z",
            lifecycleStatus: "active",
            songCount: 2,
            balances: [],
          },
        ],
      });
      await projects.promise;
    });

    expect(await within(dialog).findAllByText("Maya's album")).not.toHaveLength(0);
    expect(within(dialog).getByRole("heading", { name: "Review & send" })).not.toBeNull();
    expect(
      within(dialog).queryByRole("heading", { name: "Recipient & project", level: 2 }),
    ).toBeNull();
  });

  it("restores an expired draft on Review and requires a future expiry before sending", async () => {
    mocks.draftRecord = persistedTemplateDraft(
      { expiresAtLocal: "2020-01-01T12:00" },
      { currentStep: "quick:review" },
    );
    mocks.sendOffer.mockResolvedValue({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<ControlledTemplateComposer onCreated={onCreated} />);

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Review & send" })).not.toBeNull();
    const expiry = within(dialog).getByLabelText<HTMLInputElement>("Offer expires");
    expect(expiry.value).toBe("2020-01-01T12:00");
    expect(expiry.getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Choose a future expiry date and time.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));
    expect(mocks.sendOffer).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(mocks.clearDraft).not.toHaveBeenCalled();
    expect(
      within(dialog)
        .getAllByRole("alert")
        .some((alert) => alert.textContent.includes("Choose an expiry date in the future.")),
    ).toBe(true);

    fireEvent.change(expiry, { target: { value: "2099-09-01T12:00" } });
    expect(expiry.getAttribute("aria-invalid")).toBe("false");
    expect(
      within(dialog).queryByText("Choose a future expiry date and time."),
    ).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledOnce();
    });
    expect(mocks.sendOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date("2099-09-01T12:00").toISOString(),
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("offer-created");
    expect(mocks.clearDraft).toHaveBeenCalledOnce();
  });

  it("restores an edit only for the same offer id and expected update version", async () => {
    mocks.draftRecord = persistedEditDraft({
      expectedUpdatedAt: "2026-08-10T12:00:00.000Z",
    });
    const first = render(
      <PrivateOfferComposer
        {...commonProps()}
        initialOffer={INITIAL_OFFER}
        open
        onOpenChange={vi.fn()}
        trigger={null}
      />,
    );
    expect(screen.getByRole("heading", { name: "Recipient & project" })).not.toBeNull();
    first.unmount();

    mocks.draftRecord = persistedEditDraft();
    render(
      <PrivateOfferComposer
        {...commonProps()}
        initialOffer={INITIAL_OFFER}
        open
        onOpenChange={vi.fn()}
        trigger={null}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Details & deliverables" })).not.toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Offer title").value).toBe(
      "Restored correction",
    );
  });

  it("does not auto-select the first recipient", () => {
    render(<ControlledTemplateComposer />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Step 1 of 2 · PRIVATE OFFER")).not.toBeNull();
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Recipient").value).toBe("");
    expect(within(dialog).getByRole("button", { name: "Review offer →" })).not.toBeNull();
  });

  it("keeps a new project safe after a project-load failure and retries only on request", async () => {
    const staleRetry = deferred<{
      ok: true;
      data: Array<{
        id: string;
        title: string;
        createdAtIso: string;
        lifecycleStatus: "active";
        songCount: number;
        balances: never[];
      }>;
    }>();
    mocks.loadProjects
      .mockResolvedValueOnce({ ok: false, error: "Projects are temporarily unavailable." })
      .mockReturnValueOnce(staleRetry.promise)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: "project-client-2",
            title: "Noah's active project",
            createdAtIso: "2026-08-01T00:00:00.000Z",
            lifecycleStatus: "active",
            songCount: 1,
            balances: [],
          },
        ],
      });
    const user = userEvent.setup();
    const view = render(<ControlledTemplateComposer />);

    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Recipient"), "client-1");
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Projects are temporarily unavailable.",
    );
    expect(mocks.loadProjects).toHaveBeenCalledOnce();
    expect(mocks.loadProjects).toHaveBeenLastCalledWith("client-1");

    const newProject = within(dialog).getByRole("button", { name: "Create a new project" });
    const existingProject = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Add to an existing project",
    });
    expect(newProject.getAttribute("aria-pressed")).toBe("true");
    expect(existingProject.disabled).toBe(true);

    view.rerender(<ControlledTemplateComposer />);
    await within(dialog).findByText("Saved");
    expect(mocks.loadProjects).toHaveBeenCalledOnce();

    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(mocks.loadProjects).toHaveBeenCalledTimes(2);
    });
    expect(mocks.loadProjects).toHaveBeenNthCalledWith(2, "client-1");
    expect(newProject.getAttribute("aria-pressed")).toBe("true");

    await user.selectOptions(within(dialog).getByLabelText("Recipient"), "client-2");
    await waitFor(() => {
      expect(mocks.loadProjects).toHaveBeenCalledTimes(3);
    });
    expect(mocks.loadProjects).toHaveBeenNthCalledWith(3, "client-2");
    await waitFor(() => {
      expect(
        within(dialog).getByRole<HTMLButtonElement>("button", {
          name: "Add to an existing project",
        }).disabled,
      ).toBe(false);
    });

    await act(async () => {
      staleRetry.resolve({
        ok: true,
        data: [
          {
            id: "stale-project-client-1",
            title: "Maya's stale project",
            createdAtIso: "2026-07-01T00:00:00.000Z",
            lifecycleStatus: "active",
            songCount: 3,
            balances: [],
          },
        ],
      });
      await staleRetry.promise;
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Add to an existing project" }),
    );
    const projectSelect = within(dialog).getByLabelText<HTMLSelectElement>("Existing project");
    expect(projectSelect.textContent).toContain("Noah's active project");
    expect(projectSelect.textContent).not.toContain("Maya's stale project");
    expect(mocks.loadProjects).toHaveBeenCalledTimes(3);
  });

  it("runs full validation before quick Review and routes missing terms into Customize", async () => {
    const user = userEvent.setup();
    const incompleteTemplate: PrivateOfferTemplateProduct = {
      ...VALID_TEMPLATE,
      terms: { ...VALID_TEMPLATE.terms, deliverables: [] },
    };
    render(<ControlledTemplateComposer templateProduct={incompleteTemplate} />);

    const dialog = await chooseRecipientAndReview(user);
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Add at least one deliverable.",
    );
    expect(
      within(dialog).getAllByRole("button", { name: "Complete missing terms" }),
    ).not.toHaveLength(0);

    const completeButton = within(dialog).getAllByRole("button", {
      name: "Complete missing terms",
    })[0];
    expect(completeButton).toBeDefined();
    if (!completeButton) throw new Error("Missing Complete missing terms action");
    await user.click(completeButton);
    expect(within(dialog).getByRole("heading", { name: "Details & deliverables" })).not.toBeNull();
    const deliverables = within(dialog).getByLabelText<HTMLTextAreaElement>(
      "Deliverables · one per line",
    );
    fireEvent.change(deliverables, { target: { value: "Final master" } });
    expect(
      within(dialog).getByLabelText<HTMLTextAreaElement>("Deliverables · one per line").value,
    ).toBe("Final master");
    const continueButton = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Continue →",
    });
    expect(continueButton.disabled).toBe(false);
    await user.click(continueButton);
    expect((await within(dialog).findByLabelText<HTMLInputElement>("Cash price")).value).toBe(
      "100.00",
    );
  });

  it("shows the exact artist-facing terms and sends the copied source provenance", async () => {
    mocks.sendOffer.mockResolvedValue({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<ControlledTemplateComposer onCreated={onCreated} />);

    const dialog = await chooseRecipientAndReview(user);
    expect(await within(dialog).findByTestId("private-offer-terms")).not.toBeNull();
    expect(within(dialog).getAllByText("$118")).not.toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledOnce();
    });
    expect(mocks.sendOffer).toHaveBeenCalledWith({
      offerId: "11111111-1111-4111-8111-111111111111",
      sourceProductId: "product-single-production",
      recipient: { kind: "existing", clientContactId: "client-1" },
      target: { kind: "new" },
      terms: VALID_TEMPLATE.terms,
      expiresAt: expect.any(String) as unknown as string,
    });
    expect(onCreated).toHaveBeenCalledWith("offer-created");
    expect(mocks.clearDraft).toHaveBeenCalled();
  });

  it("changes only the private cash price while preserving the source and copied terms", async () => {
    mocks.sendOffer.mockResolvedValue({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);

    const dialog = screen.getByRole("dialog");
    const cashPrice = within(dialog).getByLabelText<HTMLInputElement>("Cash price");
    await user.clear(cashPrice);
    await user.type(cashPrice, "135.00");
    await chooseRecipientAndReview(user);

    expect(within(dialog).getAllByText("$159.30")).not.toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledOnce();
    });
    expect(mocks.sendOffer).toHaveBeenCalledWith({
      offerId: "11111111-1111-4111-8111-111111111111",
      sourceProductId: "product-single-production",
      recipient: { kind: "existing", clientContactId: "client-1" },
      target: { kind: "new" },
      terms: {
        ...VALID_TEMPLATE.terms,
        cashPriceCents: 13_500,
      },
      expiresAt: expect.any(String) as unknown as string,
    });
  });

  it("rejects invalid per-song quantities and sends only the valid recalculated quote", async () => {
    mocks.sendOffer.mockResolvedValue({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    const user = userEvent.setup();
    render(<ControlledTemplateComposer templateProduct={PER_SONG_TEMPLATE} />);

    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Recipient"), "client-1");
    const songs = within(dialog).getByLabelText<HTMLInputElement>("Songs");
    const cashPrice = within(dialog).getByLabelText<HTMLInputElement>("Cash price");
    expect(songs.value).toBe("1");
    expect(cashPrice.value).toBe("100.00");

    for (const [index, invalidQuantity] of ["2.5", "", "1001"].entries()) {
      fireEvent.change(songs, { target: { value: invalidQuantity } });
      expect(
        within(dialog).getByLabelText<HTMLInputElement>("Cash price").value,
      ).toBe("100.00");
      expect(
        within(dialog).getByText((_, element) =>
          Boolean(
            element?.tagName === "P" &&
              element.textContent.match(/Subtotal\s+—\s+·\s+18% tax added/),
          ),
        ),
      ).not.toBeNull();
      const artistPaysValue = within(dialog).getByText("Artist pays").nextElementSibling;
      expect(artistPaysValue).not.toBeNull();
      if (!artistPaysValue) throw new Error("Missing Artist pays value");
      expect(artistPaysValue.textContent).toBe("—");
      await user.click(within(dialog).getByRole("button", { name: "Review offer →" }));
      const alert = await within(dialog).findByRole("alert");
      expect(alert.textContent).toContain(
        "Choose a whole number of songs from 1 to 1,000.",
      );
      if (index === 0) {
        await waitFor(() => {
          expect(document.activeElement).toBe(alert);
        });
      }
      expect(within(dialog).getByRole("heading", { name: "Recipient & price" })).not.toBeNull();
      expect(within(dialog).queryByRole("heading", { name: "Review & send" })).toBeNull();
      expect(mocks.sendOffer).not.toHaveBeenCalled();
    }

    fireEvent.change(songs, { target: { value: "3" } });
    expect(within(dialog).getByLabelText<HTMLInputElement>("Cash price").value).toBe("240.00");
    await user.click(within(dialog).getByRole("button", { name: "Review offer →" }));
    expect(await within(dialog).findByRole("heading", { name: "Review & send" })).not.toBeNull();
    expect(within(dialog).getAllByText("$283.20")).not.toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledOnce();
    });
    expect(mocks.sendOffer).toHaveBeenCalledWith({
      offerId: "11111111-1111-4111-8111-111111111111",
      sourceProductId: "product-per-song-production",
      recipient: { kind: "existing", clientContactId: "client-1" },
      target: { kind: "new" },
      terms: {
        ...VALID_TEMPLATE.terms,
        cashPriceCents: 24_000,
        includedSongSpaces: 3,
      },
      expiresAt: expect.any(String) as unknown as string,
    });
  });

  it("keeps a failed send open without callbacks or draft clearing and reuses its id", async () => {
    mocks.sendOffer.mockResolvedValue({ ok: false, error: "Could not save the offer." });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ControlledTemplateComposer onCreated={onCreated} onOpenChange={onOpenChange} />,
    );

    const dialog = await chooseRecipientAndReview(user);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Could not save the offer.",
    );

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.clearDraft).not.toHaveBeenCalled();
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionOfferId: "11111111-1111-4111-8111-111111111111",
      }),
    );

    const retryButton = await within(dialog).findByRole("button", {
      name: "Send private offer",
    });
    await user.click(retryButton);
    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledTimes(2);
    });
    expect(mocks.sendOffer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ offerId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(mocks.sendOffer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offerId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.clearDraft).not.toHaveBeenCalled();
  });

  it("blocks duplicate submits and closing while a send is pending, then closes once", async () => {
    const pendingSend = deferred<{
      ok: true;
      data: { id: string; emailDelivered: boolean };
    }>();
    mocks.sendOffer.mockReturnValue(pendingSend.promise);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ControlledTemplateComposer onCreated={onCreated} onOpenChange={onOpenChange} />,
    );

    const dialog = await chooseRecipientAndReview(user);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));
    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledOnce();
    });

    const pendingButton = within(dialog).getByRole("button", { name: "Sending…" });
    const closeButton = within(dialog).getByRole("button", {
      name: "Close private offer editor",
    });
    expect(pendingButton.hasAttribute("disabled")).toBe(true);
    expect(closeButton.hasAttribute("disabled")).toBe(true);
    await user.click(pendingButton);
    await user.click(closeButton);
    expect(mocks.sendOffer).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    pendingSend.resolve({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mocks.sendOffer).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith("offer-created");
    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.clearDraft).toHaveBeenCalledOnce();
  });

  it("keeps the exact Review inert and unchanged while its send is pending", async () => {
    const pendingSend = deferred<{
      ok: true;
      data: { id: string; emailDelivered: boolean };
    }>();
    mocks.sendOffer.mockReturnValue(pendingSend.promise);
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);

    const dialog = await chooseRecipientAndReview(user);
    const expiry = within(dialog).getByLabelText<HTMLInputElement>("Offer expires");
    const initialExpiry = expiry.value;
    const editPrice = within(dialog).getByRole("button", { name: "Edit price" });
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));
    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledOnce();
    });

    const inertBody = dialog.querySelector<HTMLElement>("[inert]");
    expect(inertBody).not.toBeNull();
    expect(inertBody?.contains(expiry)).toBe(true);
    expect(inertBody?.contains(editPrice)).toBe(true);

    fireEvent.change(expiry, { target: { value: "2099-12-31T23:59" } });
    fireEvent.click(editPrice);
    expect(expiry.value).toBe(initialExpiry);
    expect(within(dialog).getByRole("heading", { name: "Review & send" })).not.toBeNull();
    expect(within(dialog).queryByRole("heading", { name: "Price & tax" })).toBeNull();
    expect(mocks.sendOffer).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date(initialExpiry).toISOString() }),
    );

    pendingSend.resolve({
      ok: true,
      data: { id: "offer-created", emailDelivered: true },
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it.each([
    {
      emailDelivered: null,
      message: "Offer was already saved. No duplicate or second email was sent.",
    },
    {
      emailDelivered: false,
      message:
        "Offer sent, but the notification email could not be delivered. It is still available in the app.",
    },
  ])(
    "treats emailDelivered=$emailDelivered as a persisted success",
    async ({ emailDelivered, message }) => {
      mocks.sendOffer.mockResolvedValue({
        ok: true,
        data: { id: "offer-created", emailDelivered },
      });
      const onCreated = vi.fn();
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ControlledTemplateComposer onCreated={onCreated} onOpenChange={onOpenChange} />,
      );

      const dialog = await chooseRecipientAndReview(user);
      await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(mocks.toast).toHaveBeenCalledWith(message, "info");
      expect(onCreated).toHaveBeenCalledWith("offer-created");
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mocks.clearDraft).toHaveBeenCalledOnce();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("updates an existing offer with its exact version and refreshes without onCreated", async () => {
    mocks.updateOffer.mockResolvedValue({ ok: true, data: { id: INITIAL_OFFER.id } });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledEditComposer onCreated={onCreated} onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole("dialog");
    for (const heading of [
      "Details & deliverables",
      "Price & tax",
      "Payment options",
      "Delivery & sessions",
      "Rights & agreement",
      "Review & send",
    ]) {
      await user.click(within(dialog).getByRole("button", { name: "Continue →" }));
      expect(await within(dialog).findByRole("heading", { name: heading })).not.toBeNull();
    }
    await user.click(within(dialog).getByRole("button", { name: "Save corrections" }));

    await waitFor(() => {
      expect(mocks.updateOffer).toHaveBeenCalledOnce();
    });
    expect(mocks.updateOffer).toHaveBeenCalledWith({
      offerId: INITIAL_OFFER.id,
      expectedUpdatedAt: INITIAL_OFFER.expectedUpdatedAt,
      recipient: { kind: "existing", clientContactId: "client-1" },
      target: { kind: "new" },
      terms: VALID_TEMPLATE.terms,
      expiresAt: expect.any(String) as unknown as string,
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.clearDraft).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps one create id through failure, close, restore, and retry", async () => {
    mocks.sendOffer
      .mockResolvedValueOnce({ ok: false, error: "Could not save the offer." })
      .mockResolvedValueOnce({
        ok: true,
        data: { id: "offer-created", emailDelivered: true },
      });
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);

    const dialog = await chooseRecipientAndReview(user);
    await user.click(within(dialog).getByRole("button", { name: "Send private offer" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Could not save the offer.",
    );
    await within(dialog).findByRole("button", { name: "Send private offer" });
    await user.click(within(dialog).getByRole("button", { name: "Close private offer editor" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mocks.draftRecord).toEqual(
      expect.objectContaining({
        currentStep: "quick:review",
        submissionOfferId: "11111111-1111-4111-8111-111111111111",
      }),
    );

    await user.click(screen.getByTestId("return-focus"));
    const restoredDialog = await screen.findByRole("dialog");
    expect(within(restoredDialog).getByRole("heading", { name: "Review & send" })).not.toBeNull();
    await user.click(within(restoredDialog).getByRole("button", { name: "Send private offer" }));

    await waitFor(() => {
      expect(mocks.sendOffer).toHaveBeenCalledTimes(2);
    });
    expect(mocks.sendOffer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ offerId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(mocks.sendOffer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offerId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(mocks.clearDraft).toHaveBeenCalled();
  });

  it("flushes an ordinary close and clears only an explicit Discard draft", async () => {
    const user = userEvent.setup();
    render(<ControlledTemplateComposer />);

    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Recipient"), "client-1");
    await user.click(within(dialog).getByRole("button", { name: "Close private offer editor" }));
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        entryKey: "template:product-single-production",
        currentStep: "quick:quick",
        draftJson: expect.stringContaining('"clientContactId":"client-1"') as unknown as string,
      }),
    );
    expect(mocks.clearDraft).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("return-focus"));
    const reopened = await screen.findByRole("dialog");
    await user.click(within(reopened).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mocks.clearDraft).toHaveBeenCalledOnce();
    expect(mocks.draftRecord).toBeNull();
  });

  it("closes a controlled headless editor and restores focus without sending", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledTemplateComposer onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Close private offer editor" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(screen.getByTestId("return-focus"));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.sendOffer).not.toHaveBeenCalled();
  });
});
