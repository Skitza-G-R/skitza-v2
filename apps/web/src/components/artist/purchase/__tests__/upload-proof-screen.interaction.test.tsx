// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  startUpload: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("../actions", () => ({
  cancelPaymentProofUploadAction: vi.fn(),
  presignProofUploadAction: vi.fn(),
  submitPaymentProofAction: vi.fn(),
}));

vi.mock("../proof-upload-lifecycle", () => ({
  startManagedPaymentProofUpload: mocks.startUpload,
  uploadPaymentProofBytes: vi.fn(),
}));

import { UploadProofScreen } from "../upload-proof-screen";

function renderScreen(): HTMLInputElement {
  const view = render(
    <UploadProofScreen
      productName="Single production"
      studioId="producer-1"
      producerName="North Room"
      purchaseId="00000000-0000-4000-8000-000000000001"
      installmentId="00000000-0000-4000-8000-000000000002"
      installmentPosition={1}
      thisProofCents={120_000}
      currency="ILS"
    />,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Expected the proof file input.");
  return input;
}

function chooseProof(input: HTMLInputElement): void {
  fireEvent.change(input, {
    target: {
      files: [new File(["private receipt"], "receipt.pdf", { type: "application/pdf" })],
    },
  });
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.startUpload.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("payment-proof upload feedback", () => {
  it("shows a retryable local error when upload startup throws synchronously", () => {
    mocks.startUpload
      .mockImplementationOnce(() => {
        throw new Error("Upload manager is unavailable without a signed-in account.");
      })
      .mockImplementationOnce(() => undefined);

    const input = renderScreen();
    chooseProof(input);

    fireEvent.click(screen.getByRole("button", { name: /Send proof/ }));

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not start the upload. Try again.",
    );
    expect(screen.getByText("receipt.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Send proof/ }));
    expect(mocks.startUpload).toHaveBeenCalledTimes(2);
  });

  it("shows callback failures without discarding the selected file", () => {
    mocks.startUpload.mockImplementation((input: Record<string, unknown>) => {
      (input.onStart as (() => void) | undefined)?.();
      (input.onFailure as ((message: string) => void) | undefined)?.(
        "The file upload did not finish. Check your connection and try again.",
      );
      return undefined;
    });

    const input = renderScreen();
    chooseProof(input);
    fireEvent.click(screen.getByRole("button", { name: /Send proof/ }));

    expect(screen.getByRole("alert").textContent).toContain(
      "The file upload did not finish. Check your connection and try again.",
    );
    expect(screen.getByText("receipt.pdf")).toBeTruthy();
  });
});
