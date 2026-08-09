// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProducerStoreProductDraft } from "~/lib/runtime-state/runtime-state";

const mocks = vi.hoisted(() => ({
  createPackage: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  updatePackage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("~/app/(producer)/dashboard/booking/actions", () => ({
  createPackage: mocks.createPackage,
  updatePackage: mocks.updatePackage,
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
    onPublish,
    onSaveHidden,
    saveStatus,
  }: {
    children: ReactNode;
    onPublish: () => void;
    onSaveHidden: () => void;
    saveStatus: string;
  }) => (
    <div>
      <span data-testid="save-status">{saveStatus}</span>
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
vi.mock("../editor-steps/payment-step", () => ({ PaymentStep: () => null }));
vi.mock("../editor-steps/pricing-step", () => ({ PricingStep: () => null }));
vi.mock("../editor-steps/review-step", () => ({ ReviewStep: () => null }));
vi.mock("../editor-steps/rights-agreement-step", () => ({ RightsAgreementStep: () => null }));
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

function persistedDraft(currentStep: "details" | "review"): ProducerStoreProductDraft {
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
}: {
  currentStep?: "details" | "review";
  onCreated?: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
  onPersistDraft?: (draft: ProducerStoreProductDraft) => boolean;
  onSubmitted?: () => void;
  onSubmittedResult?: (result: {
    includesSessions: boolean;
    bookingEnabled: boolean;
  }) => void;
} = {}) {
  render(
    <ProductEditor
      open
      onOpenChange={onOpenChange}
      product={null}
      defaultCurrency="ILS"
      taxMode="tax_free"
      taxRatePct={0}
      onCreated={onCreated}
      onSubmitted={onSubmitted}
      onSubmittedResult={onSubmittedResult}
      persistedDraft={persistedDraft(currentStep)}
      onPersistDraft={onPersistDraft}
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
  mocks.refresh.mockReset();
  mocks.toast.mockReset();
  mocks.updatePackage.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("ProductEditor routine save feedback", () => {
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

  it("never reports Saved when the draft persistence write fails", () => {
    renderEditor({ currentStep: "details", onPersistDraft: vi.fn(() => false) });

    expect(screen.getByTestId("save-status").textContent).toBe("saving");
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByTestId("save-status").textContent).toBe("idle");
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
