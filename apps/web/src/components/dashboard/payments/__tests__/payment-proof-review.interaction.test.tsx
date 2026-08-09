// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  reject: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("~/app/(producer)/dashboard/payments/proof-actions", () => ({
  confirmPaymentProofAction: mocks.confirm,
  rejectPaymentProofAction: mocks.reject,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { PaymentProofReview } from "../payment-proof-review";

const PROOF_ID = "00000000-0000-4000-8000-000000000091";

const review = {
  proof: {
    proofId: PROOF_ID,
    purchaseId: "00000000-0000-4000-8000-000000000092",
    purchaseRequestId: "00000000-0000-4000-8000-000000000093",
    installmentId: "00000000-0000-4000-8000-000000000094",
    installmentPosition: 1,
    installmentAmountCents: 120_000,
    refNumber: "PAY-TEST",
    artistName: "Noa Artist",
    projectId: "00000000-0000-4000-8000-000000000095",
    projectTitle: "Debut single",
    productNameSnapshot: "Single production",
    amountCents: 120_000,
    totalCents: 240_000,
    currency: "ILS",
    originalFileName: "payment-proof.png",
    contentType: "image/png",
    sizeBytes: 42_000,
    proofNote: "First installment",
    status: "pending" as const,
    rejectionNote: null,
    confirmedAt: null,
    rejectedAt: null,
    createdAt: new Date("2026-08-08T10:00:00.000Z"),
  },
  evidenceUrl: "/api/payment-proofs/evidence?token=test",
  evidenceExpiresInSeconds: 300,
  history: [],
};

describe("PaymentProofReview decisions", () => {
  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.push.mockReset();
    mocks.refresh.mockReset();
    mocks.reject.mockReset();
    mocks.toast.mockReset();

    mocks.confirm.mockResolvedValue({ ok: true, result: { projectId: review.proof.projectId } });
    mocks.reject.mockResolvedValue({ ok: true, result: { projectId: review.proof.projectId } });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows success feedback and navigates home after a live confirmation", async () => {
    const user = userEvent.setup();
    render(<PaymentProofReview review={review} />);

    await user.click(screen.getByRole("button", { name: /Confirm .*1,200/ }));
    await user.click(screen.getByRole("button", { name: "Confirm payment" }));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalledWith({ proofId: PROOF_ID });
      expect(mocks.toast).toHaveBeenCalledWith("Payment confirmed and recorded.", "success");
      expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    });
    expect(mocks.toast.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.push.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps rejection feedback on the record without navigating away", async () => {
    const user = userEvent.setup();
    render(<PaymentProofReview review={review} />);

    await user.click(screen.getByRole("button", { name: "Reject proof" }));
    await user.type(
      screen.getByRole("textbox", { name: "Message shown to the artist" }),
      "Please upload the complete transfer receipt.",
    );
    await user.click(screen.getByRole("button", { name: "Send note & reject" }));

    await waitFor(() => {
      expect(mocks.reject).toHaveBeenCalledWith({
        proofId: PROOF_ID,
        note: "Please upload the complete transfer receipt.",
      });
      expect(mocks.refresh).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("status").textContent).toContain(
      "Proof rejected. The artist can see your note and replace it.",
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
