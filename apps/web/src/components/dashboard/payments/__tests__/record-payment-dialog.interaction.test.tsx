// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProjectPurchaseInstallment,
  ProjectPurchaseSummary,
} from "~/components/dashboard/projects/project-purchases-panel";

type AnyAction = (input: unknown) => Promise<unknown>;

const refresh = vi.fn();
const toast = vi.fn();
const presign = vi.fn<AnyAction>();
const cancelReceipt = vi.fn<AnyAction>();
const record = vi.fn<AnyAction>();
const uploadBytes = vi.fn<AnyAction>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast, dismissToast: vi.fn() }),
}));
vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));
vi.mock("~/app/(producer)/dashboard/clients-projects/actions", () => ({
  presignManualReceiptAction: (input: unknown) => presign(input),
  cancelManualReceiptAction: (input: unknown) => cancelReceipt(input),
  recordManualPaymentAction: (input: unknown) => record(input),
}));
vi.mock("~/components/artist/purchase/proof-upload-lifecycle", () => ({
  uploadPaymentProofBytes: (input: unknown) => uploadBytes(input),
}));

import { RecordPaymentDialog } from "../record-payment-dialog";

function installment(
  overrides: Partial<ProjectPurchaseInstallment> & { id: string },
): ProjectPurchaseInstallment {
  return {
    position: 1,
    amountCents: 50_000,
    currency: "ILS",
    dueAtIso: "2026-08-01T09:00:00.000Z",
    status: "not_paid",
    remainingCents: 50_000,
    hasPendingProof: false,
    payableNow: true,
    ...overrides,
  };
}

function purchase(
  overrides: Partial<ProjectPurchaseSummary> & { id: string },
): ProjectPurchaseSummary {
  return {
    sourceKind: "store_product",
    sourceLabel: "Full production",
    lifecycleStatus: "active",
    totalCents: 100_000,
    currency: "ILS",
    installments: [],
    ...overrides,
  };
}

const SINGLE = [purchase({ id: "p1", installments: [installment({ id: "i1" })] })];

function submitForm(button: HTMLElement): void {
  const form = button.closest("form");
  if (!form) throw new Error("submit button is not inside a form");
  fireEvent.submit(form);
}

function submitButton(name: string | RegExp): HTMLButtonElement {
  const element = screen.getByRole("button", { name });
  if (!(element instanceof HTMLButtonElement)) throw new Error("expected a button");
  return element;
}

function inputValue(label: string): string {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error("expected an input");
  return element.value;
}

function firstCallInput(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const input = mock.mock.calls[0]?.[0];
  if (!input || typeof input !== "object") throw new Error("mock was not called with an object");
  return input as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  record.mockResolvedValue({
    ok: true,
    data: {
      paymentId: "pay-1",
      proofId: null,
      installmentPosition: 1,
      installmentStatus: "confirmed",
      paidInFull: true,
    },
  });
  Object.defineProperty(URL, "createObjectURL", { value: () => "blob:preview", writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
});

afterEach(() => {
  cleanup();
});

describe("RecordPaymentDialog", () => {
  it("pre-selects the only open payment, prefills the full amount, and records it", async () => {
    const onClose = vi.fn();
    render(<RecordPaymentDialog open onClose={onClose} projectId="project-1" purchases={SINGLE} />);

    const radio = screen.getByRole("radio", { name: /Full production/ });
    expect(radio.getAttribute("aria-checked")).toBe("true");
    expect(inputValue("Amount received")).toBe("500");
    expect(submitButton(/Record ₪500/).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Bank transfer" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "ref 8841" } });
    submitForm(submitButton(/Record ₪500/));

    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    const input = firstCallInput(record);
    expect(input).toMatchObject({
      projectId: "project-1",
      purchaseId: "p1",
      installmentId: "i1",
      amountCents: 50_000,
      note: "Bank transfer — ref 8841",
    });
    expect(typeof input.operationKey).toBe("string");
    expect(input.uploadToken).toBeUndefined();
    expect(presign).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/paid in full/), "success");
  });

  it("blocks amounts above what is left and allows partial payments", async () => {
    render(<RecordPaymentDialog open onClose={vi.fn()} projectId="project-1" purchases={SINGLE} />);

    const amount = screen.getByLabelText("Amount received");
    fireEvent.change(amount, { target: { value: "600" } });
    expect(screen.getByText(/more than what is left/)).toBeTruthy();
    expect(submitButton("Record payment").disabled).toBe(true);

    fireEvent.change(amount, { target: { value: "200" } });
    expect(screen.queryByText(/more than what is left/)).toBeNull();
    expect(submitButton(/Record ₪200/).disabled).toBe(false);
    submitForm(submitButton(/Record ₪200/));
    await waitFor(() => {
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 20_000 }));
    });
  });

  // SK-293 — the client approved over WhatsApp, so the 50/50 final half never
  // triggered. The producer holding their money must still be able to record it.
  it("records a final half whose approval never happened, and says what that means", async () => {
    const onClose = vi.fn();
    render(
      <RecordPaymentDialog
        open
        onClose={onClose}
        projectId="project-1"
        purchases={[
          purchase({
            id: "p1",
            installments: [
              installment({ id: "i1", status: "confirmed", remainingCents: 0 }),
              installment({
                id: "i2",
                position: 2,
                dueAtIso: null,
                payableNow: false,
                finalMilestonePending: true,
              }),
            ],
          }),
        ]}
      />,
    );

    const radio = screen.getByRole("radio", { name: /Full production/ });
    expect(radio.getAttribute("aria-disabled")).toBeNull();
    expect(radio.getAttribute("aria-checked")).toBe("true");
    expect(radio.textContent).toContain("Waiting on approval");
    // The consequence belongs next to the button that causes it.
    expect(screen.getByText(/Also marks the work finished/)).toBeTruthy();

    submitForm(submitButton(/Record ₪500/));

    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    expect(firstCallInput(record)).toMatchObject({
      installmentId: "i2",
      amountCents: 50_000,
      markFinalMilestone: true,
    });
  });

  it("never declares the milestone on a payment that is simply due", async () => {
    render(<RecordPaymentDialog open onClose={vi.fn()} projectId="project-1" purchases={SINGLE} />);
    submitForm(submitButton(/Record ₪500/));
    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    expect(firstCallInput(record).markFinalMilestone).toBeUndefined();
    expect(screen.queryByText(/Also marks the work finished/)).toBeNull();
  });

  it("keeps blocked installments unselectable with their reason", () => {
    render(
      <RecordPaymentDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        purchases={[
          purchase({
            id: "p1",
            installments: [
              installment({ id: "i1" }),
              installment({ id: "i2", position: 2, dueAtIso: null, payableNow: false }),
              installment({
                id: "i3",
                position: 3,
                hasPendingProof: true,
                status: "awaiting_review",
              }),
            ],
          }),
        ]}
      />,
    );

    // Only one installment is open, so it is pre-selected even with blocked siblings.
    const open = screen.getByRole("radio", { name: /Payment 1 of 3/ });
    expect(open.getAttribute("aria-checked")).toBe("true");

    const notDue = screen.getByRole("radio", { name: /Not due yet/ });
    expect(notDue.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(notDue);
    expect(notDue.getAttribute("aria-checked")).toBe("false");
    expect(open.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Proof waiting for review/)).toBeTruthy();
    expect(inputValue("Amount received")).toBe("500");
  });

  it("uploads the receipt first and passes its token to the record call", async () => {
    presign.mockResolvedValue({
      ok: true,
      data: { uploadUrl: "https://r2.example/put", uploadToken: "tok-1" },
    });
    uploadBytes.mockImplementation((input) => {
      (input as { onProgress: (loaded: number, total: number) => void }).onProgress(10, 10);
      return Promise.resolve({ ok: true });
    });
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    render(
      <RecordPaymentDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        purchases={SINGLE}
        initialFile={file}
      />,
    );

    expect(screen.getByText("receipt.png")).toBeTruthy();
    submitForm(submitButton(/Record ₪500/));

    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    const presignInput = firstCallInput(presign);
    const recordInput = firstCallInput(record);
    expect(presignInput).toMatchObject({
      purchaseId: "p1",
      installmentId: "i1",
      fileName: "receipt.png",
      contentType: "image/png",
      sizeBytes: 7,
    });
    expect(presignInput.operationKey).toBe(recordInput.operationKey);
    expect(recordInput.uploadToken).toBe("tok-1");
    expect(cancelReceipt).not.toHaveBeenCalled();
  });

  it("cleans up the staged receipt when the byte upload fails", async () => {
    presign.mockResolvedValue({
      ok: true,
      data: { uploadUrl: "https://r2.example/put", uploadToken: "tok-2" },
    });
    uploadBytes.mockResolvedValue({ ok: false });
    cancelReceipt.mockResolvedValue({ ok: true });
    const file = new File(["receipt"], "receipt.pdf", { type: "application/pdf" });
    render(
      <RecordPaymentDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        purchases={SINGLE}
        initialFile={file}
      />,
    );

    submitForm(submitButton(/Record ₪500/));

    await waitFor(() => {
      expect(cancelReceipt).toHaveBeenCalledWith({
        purchaseId: "p1",
        installmentId: "i1",
        uploadToken: "tok-2",
      });
    });
    expect(record).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/upload did not finish/), "error");
    expect(submitButton(/Record ₪500/).disabled).toBe(false);
  });

  it("rejects an unsupported receipt file without losing the form", () => {
    render(
      <RecordPaymentDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        purchases={SINGLE}
        initialFile={new File(["x"], "song.wav", { type: "audio/wav" })}
      />,
    );
    expect(screen.getByText(/photo .* or a PDF/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add the receipt/ })).toBeTruthy();
    expect(submitButton(/Record ₪500/).disabled).toBe(false);
  });
});
