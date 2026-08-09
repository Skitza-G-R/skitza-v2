// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProducerStoreProductDraft } from "~/lib/runtime-state/runtime-state";

const mocks = vi.hoisted(() => ({
  cancelAgreementPdfUpload: vi.fn(),
  createPackage: vi.fn(),
  prepareAgreementPdfUpload: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  updatePackage: vi.fn(),
  updateProducer: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("~/app/(producer)/dashboard/booking/actions", () => ({
  cancelAgreementPdfUpload: mocks.cancelAgreementPdfUpload,
  createPackage: mocks.createPackage,
  prepareAgreementPdfUpload: mocks.prepareAgreementPdfUpload,
  updatePackage: mocks.updatePackage,
}));

vi.mock("~/app/(producer)/dashboard/settings/actions", () => ({
  updateProducer: mocks.updateProducer,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("../editor-shell", () => ({
  EditorShell: ({
    children,
    canContinue,
    current,
    onOpenChange,
    onContinue,
    onPublish,
    onSaveHidden,
    pending,
    saveStatus,
  }: {
    children: ReactNode;
    canContinue: boolean;
    current: string;
    onOpenChange: (open: boolean) => void;
    onContinue: () => void;
    onPublish: () => void;
    onSaveHidden: () => void;
    pending: boolean;
    saveStatus: string;
  }) => (
    <div>
      <span data-testid="save-status">{saveStatus}</span>
      <span data-testid="current-step">{current}</span>
      <span data-testid="pending">{String(pending)}</span>
      <button
        type="button"
        onClick={() => {
          onOpenChange(false);
        }}
      >
        Close editor
      </button>
      <button type="button" disabled={!canContinue} onClick={onContinue}>
        Continue
      </button>
      <button type="button" onClick={onSaveHidden}>
        Save hidden
      </button>
      <button type="button" onClick={onPublish}>
        Publish product
      </button>
      {children}
    </div>
  ),
}));

vi.mock("../editor-steps/includes-step", () => ({
  IncludesStep: ({
    name,
    onNameChange,
  }: {
    name: string;
    onNameChange: (name: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onNameChange(`${name}!`);
      }}
    >
      Change title
    </button>
  ),
}));

vi.mock("../editor-steps/logistics-step", () => ({ LogisticsStep: () => null }));
vi.mock("../editor-steps/onboarding-tax-step", () => ({
  OnboardingTaxStep: ({ value }: { value: string | null }) => (
    <span data-testid="restored-tax-mode">{value ?? "unselected"}</span>
  ),
}));
vi.mock("../editor-steps/payment-step", () => ({ PaymentStep: () => null }));
vi.mock("../editor-steps/pricing-step", () => ({
  PricingStep: ({ taxMode, taxRatePct }: { taxMode: string; taxRatePct: number }) => (
    <span data-testid="pricing-tax">{`${taxMode}:${String(taxRatePct)}`}</span>
  ),
}));
vi.mock("../editor-steps/review-step", () => ({ ReviewStep: () => null }));
vi.mock("../editor-steps/rights-agreement-step", () => ({
  RightsAgreementStep: ({
    onAgreementPdfSelect,
  }: {
    onAgreementPdfSelect: (file: File) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onAgreementPdfSelect(
          new File([new TextEncoder().encode("%PDF-1.7")], "terms.pdf", {
            type: "application/pdf",
          }),
        );
      }}
    >
      Choose agreement PDF
    </button>
  ),
}));
vi.mock("../editor-steps/type-step", () => ({ TypeStep: () => null }));

import { ProductEditor } from "../product-editor";

const VALID_DRAFT: ProducerStoreProductDraft["draft"] = {
  _picked: "production",
  _legacyAgreementLink: false,
  name: "Full production",
  tagline: "A release-ready production from first idea to final master.",
  type: "production",
  price: 2500,
  currency: "ILS",
  includesSessions: false,
  sessions: 1,
  unlimitedSessions: false,
  bookingEnabled: false,
  payment: {
    full: true,
    split50: false,
    monthly: false,
    monthlyInstallments: 4,
  },
  includes: ["Final master"],
  duration: "",
  revisions: 2,
  unlimitedRevisions: false,
  agreementMode: "none",
  agreementText: "",
  royalty: {
    masterMode: "none",
    masterPercentage: "",
    compositionMode: "none",
    compositionPercentage: "",
    compositionRole: "",
    collectingSociety: "",
    notes: "",
  },
  pricingModel: "flat",
  volumeTiers: [],
};

function persistedDraft(
  currentStep: "details" | "review" | "tax" | "price" | "rights",
): ProducerStoreProductDraft {
  return {
    open: true,
    mode: "new",
    productId: null,
    currentStep,
    draft: VALID_DRAFT,
  };
}

function renderEditor({
  currentStep = "review",
  onCreated = vi.fn(),
  onOpenChange = vi.fn(),
  onPersistDraft = vi.fn(() => true),
  onSubmitted = vi.fn(),
  onSubmittedResult = vi.fn(),
  persisted,
  newProductFlow = "store",
  taxMode = "tax_free",
  taxRatePct = 0,
}: {
  currentStep?: "details" | "review" | "tax" | "price" | "rights";
  onCreated?: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
  onPersistDraft?: (draft: ProducerStoreProductDraft) => boolean;
  onSubmitted?: () => void;
  onSubmittedResult?: (result: { includesSessions: boolean; bookingEnabled: boolean }) => void;
  persisted?: ProducerStoreProductDraft;
  newProductFlow?: "store" | "onboarding";
  taxMode?: "tax_free" | "tax_included" | "tax_added";
  taxRatePct?: number;
} = {}) {
  render(
    <ProductEditor
      open
      onOpenChange={onOpenChange}
      product={null}
      defaultCurrency="ILS"
      taxMode={taxMode}
      taxRatePct={taxRatePct}
      onCreated={onCreated}
      onSubmitted={onSubmitted}
      onSubmittedResult={onSubmittedResult}
      persistedDraft={persisted ?? persistedDraft(currentStep)}
      onPersistDraft={onPersistDraft}
      newProductFlow={newProductFlow}
    />,
  );

  return { onCreated, onOpenChange, onPersistDraft, onSubmitted, onSubmittedResult };
}

async function flushReact(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.createPackage.mockReset();
  mocks.cancelAgreementPdfUpload.mockReset();
  mocks.prepareAgreementPdfUpload.mockReset();
  mocks.refresh.mockReset();
  mocks.toast.mockReset();
  mocks.updatePackage.mockReset();
  mocks.updateProducer.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("ProductEditor routine save feedback", () => {
  it("keeps a restored onboarding tax choice explicitly unselected after reload", () => {
    renderEditor({
      currentStep: "tax",
      newProductFlow: "onboarding",
      persisted: {
        ...persistedDraft("tax"),
        draft: {
          ...VALID_DRAFT,
          taxMode: null,
          taxRatePct: 18,
        },
      },
    });

    expect(screen.getByTestId("current-step").textContent).toBe("tax");
    expect(screen.getByTestId("restored-tax-mode").textContent).toBe("unselected");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
    expect(mocks.updateProducer).not.toHaveBeenCalled();
  });

  it("requires a choice when a legacy onboarding draft has no tax fields", () => {
    renderEditor({
      currentStep: "tax",
      newProductFlow: "onboarding",
      persisted: persistedDraft("tax"),
      taxMode: "tax_added",
      taxRatePct: 18,
    });

    expect(screen.getByTestId("restored-tax-mode").textContent).toBe("unselected");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
    expect(mocks.updateProducer).not.toHaveBeenCalled();
  });

  it("refreshes a normal Store draft from the current Settings tax after reload", () => {
    const onPersistDraft = vi.fn<(draft: ProducerStoreProductDraft) => boolean>(() => true);
    renderEditor({
      currentStep: "price",
      onPersistDraft,
      taxMode: "tax_added",
      taxRatePct: 18,
      persisted: {
        ...persistedDraft("price"),
        draft: {
          ...VALID_DRAFT,
          taxMode: "tax_free",
          taxRatePct: 0,
        },
      },
    });

    expect(screen.getByTestId("pricing-tax").textContent).toBe("tax_added:18");
    expect(onPersistDraft.mock.calls.at(-1)?.[0].draft).not.toHaveProperty("taxMode");
    expect(onPersistDraft.mock.calls.at(-1)?.[0].draft).not.toHaveProperty("taxRatePct");
  });

  it("does not close or cancel the staged PDF while finalization is in flight", async () => {
    const onOpenChange = vi.fn();
    let finishSave!: (value: { ok: true; data: { id: string } }) => void;
    const saveResult = new Promise<{ ok: true; data: { id: string } }>((resolve) => {
      finishSave = resolve;
    });
    mocks.prepareAgreementPdfUpload.mockResolvedValue({
      ok: true,
      data: {
        uploadUrl: "https://upload.invalid/private",
        uploadToken: "staged-upload-token",
      },
    });
    mocks.createPackage.mockReturnValue(saveResult);
    renderEditor({ currentStep: "rights", onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: "Choose agreement PDF" }));
    await flushReact();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("current-step").textContent).toBe("review");

    fireEvent.click(screen.getByRole("button", { name: "Save hidden" }));
    await flushReact();
    expect(screen.getByTestId("pending").textContent).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.cancelAgreementPdfUpload).not.toHaveBeenCalled();

    finishSave({ ok: true, data: { id: "saved-product" } });
    await flushReact();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.cancelAgreementPdfUpload).not.toHaveBeenCalled();
  });

  it("announces Saving… then Saved only after the debounced draft write succeeds", () => {
    const onPersistDraft = vi.fn<(draft: ProducerStoreProductDraft) => boolean>(() => true);
    renderEditor({ currentStep: "details", onPersistDraft });

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId("save-status").textContent).toBe("saved");

    fireEvent.click(screen.getByRole("button", { name: "Change title" }));
    expect(screen.getByTestId("save-status").textContent).toBe("saving");

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(screen.getByTestId("save-status").textContent).toBe("saving");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("save-status").textContent).toBe("saved");
  });

  it("keeps repeated autosaves on Saving… until only the latest draft persists", () => {
    const onPersistDraft = vi.fn<(draft: ProducerStoreProductDraft) => boolean>(() => true);
    renderEditor({ currentStep: "details", onPersistDraft });

    act(() => {
      vi.advanceTimersByTime(250);
    });
    const callsAfterInitialSave = onPersistDraft.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Change title" }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByRole("button", { name: "Change title" }));

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(screen.getByTestId("save-status").textContent).toBe("saving");
    expect(onPersistDraft).toHaveBeenCalledTimes(callsAfterInitialSave);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("save-status").textContent).toBe("saved");
    expect(onPersistDraft).toHaveBeenCalledTimes(callsAfterInitialSave + 1);
    expect(onPersistDraft.mock.calls.at(-1)?.[0].draft.name).toBe("Full production!!");
  });

  it("reports an accessible error state and never Saved when draft persistence fails", () => {
    renderEditor({ currentStep: "details", onPersistDraft: vi.fn(() => false) });

    expect(screen.getByTestId("save-status").textContent).toBe("saving");
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByTestId("save-status").textContent).toBe("error");
  });

  it("navigates after a hidden product persists without the rejected success toast", async () => {
    const callbacks = renderEditor();
    mocks.createPackage.mockResolvedValue({ ok: true, data: { id: "product-created" } });

    fireEvent.click(screen.getByRole("button", { name: "Save hidden" }));
    expect(screen.getByTestId("save-status").textContent).toBe("saving");
    await flushReact();

    expect(callbacks.onCreated).toHaveBeenCalledWith("product-created");
    expect(callbacks.onSubmitted).toHaveBeenCalledOnce();
    expect(callbacks.onSubmittedResult).toHaveBeenCalledWith({
      includesSessions: false,
      bookingEnabled: false,
    });
    expect(callbacks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("keeps failure details in the accessible toast and never claims success", async () => {
    const callbacks = renderEditor();
    mocks.createPackage.mockResolvedValue({ ok: false, error: "Hidden draft could not be saved." });

    fireEvent.click(screen.getByRole("button", { name: "Save hidden" }));
    expect(screen.getByTestId("save-status").textContent).toBe("saving");
    await flushReact();

    expect(screen.getByTestId("save-status").textContent).toBe("idle");
    expect(mocks.toast).toHaveBeenCalledWith("Hidden draft could not be saved.", "error");
    expect(callbacks.onSubmitted).not.toHaveBeenCalled();
    expect(callbacks.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps publishing as an important completion toast", async () => {
    renderEditor();
    mocks.createPackage.mockResolvedValue({ ok: true, data: { id: "product-live" } });

    fireEvent.click(screen.getByRole("button", { name: "Publish product" }));
    await flushReact();

    expect(mocks.toast).toHaveBeenCalledWith("Full production published.", "success");
  });
});
