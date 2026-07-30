import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelManagedUpload,
  managedUploadsSnapshot,
  releaseManagedUploadsForAccount,
  retryManagedUpload,
  setUploadRuntimeAccountId,
} from "~/lib/audio/upload-manager";
import {
  startManagedPaymentProofUpload,
  type PaymentProofByteUpload,
} from "../proof-upload-lifecycle";

const ACCOUNT_ID = "artist-user";
const here = dirname(fileURLToPath(import.meta.url));
const lifecycleSource = readFileSync(join(here, "..", "proof-upload-lifecycle.ts"), "utf8");

function proofFile(): File {
  return new File(["private receipt"], "receipt.pdf", { type: "application/pdf" });
}

function baseInput(
  overrides: Partial<Parameters<typeof startManagedPaymentProofUpload>[0]> = {},
): Parameters<typeof startManagedPaymentProofUpload>[0] {
  return {
    file: proofFile(),
    purchaseId: "purchase-1",
    installmentId: "installment-1",
    operationKey: "00000000-0000-4000-8000-000000000001",
    contentType: "application/pdf",
    amountCents: 12_000,
    note: "Paid by transfer",
    presign: vi.fn().mockResolvedValue({
      ok: true,
      uploadUrl: "https://private-upload.invalid/signed",
      uploadToken: "opaque-token",
    }),
    cleanup: vi.fn().mockResolvedValue({ ok: true }),
    submit: vi.fn().mockResolvedValue({ ok: true, proofId: "proof-1" }),
    uploadFile: vi.fn((request: Parameters<PaymentProofByteUpload>[0]) => {
      request.onProgress(0, request.file.size);
      request.onProgress(request.file.size, request.file.size);
      return Promise.resolve({ ok: true });
    }),
    ...overrides,
  };
}

afterEach(() => {
  releaseManagedUploadsForAccount(ACCOUNT_ID);
  setUploadRuntimeAccountId(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("managed payment-proof upload", () => {
  it("stays visible in app upload activity until server-confirmed success", async () => {
    setUploadRuntimeAccountId(ACCOUNT_ID);
    let finishPut: ((response: { ok: boolean }) => void) | undefined;
    let reportProgress: ((loadedBytes: number, totalBytes: number) => void) | undefined;
    const uploadFile: PaymentProofByteUpload = (request) =>
      new Promise((resolve) => {
        finishPut = resolve;
        reportProgress = request.onProgress;
      });
    const input = baseInput({ uploadFile });

    const upload = startManagedPaymentProofUpload(input);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]).toMatchObject({
        id: upload.id,
        fileName: "receipt.pdf",
        label: "Payment proof",
        status: "uploading",
        progress: 0,
        canCancel: true,
        canRetry: true,
      });
    });

    const halfwayBytes = Math.floor(input.file.size / 2);
    reportProgress?.(halfwayBytes, input.file.size);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]?.progress).toBe(
        Math.round((halfwayBytes / input.file.size) * 100),
      );
    });

    finishPut?.({ ok: true });
    await expect(upload.finished).resolves.toBe("succeeded");
    expect(input.submit).toHaveBeenCalledOnce();
    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "done",
      progress: 100,
      canCancel: false,
      canRetry: false,
    });
  });

  it("aborts an in-flight PUT and never submits after cancellation", async () => {
    setUploadRuntimeAccountId(ACCOUNT_ID);
    let readPutAborted = () => false;
    const uploadFile: PaymentProofByteUpload = (request) =>
      new Promise((_resolve, reject) => {
        readPutAborted = () => request.signal.aborted;
        request.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const input = baseInput({ uploadFile });

    const upload = startManagedPaymentProofUpload(input);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]?.status).toBe("uploading");
    });

    await expect(cancelManagedUpload(upload.id)).resolves.toBe(true);
    await expect(upload.finished).resolves.toBe("cancelled");
    expect(readPutAborted()).toBe(true);
    expect(input.cleanup).toHaveBeenCalledWith({
      purchaseId: "purchase-1",
      installmentId: "installment-1",
      uploadToken: "opaque-token",
    });
    expect(input.submit).not.toHaveBeenCalled();
    expect(managedUploadsSnapshot()).toEqual([]);
  });

  it("retains a failed proof offline, then retries from a fresh presign after reconnecting", async () => {
    setUploadRuntimeAccountId(ACCOUNT_ID);
    const uploadFile = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true }) as unknown as PaymentProofByteUpload;
    const onFailure = vi.fn();
    const input = baseInput({ uploadFile, onFailure });

    const upload = startManagedPaymentProofUpload(input);
    await expect(upload.finished).resolves.toBe("failed");
    expect(input.cleanup).toHaveBeenCalledWith({
      purchaseId: "purchase-1",
      installmentId: "installment-1",
      uploadToken: "opaque-token",
    });
    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "error",
      canRetry: true,
      error: "The file upload did not finish. Check your connection and try again.",
    });

    const onlineState = { onLine: false };
    vi.stubGlobal("navigator", onlineState);
    await expect(retryManagedUpload(upload.id)).resolves.toBe(false);
    expect(input.presign).toHaveBeenCalledOnce();
    expect(input.submit).not.toHaveBeenCalled();
    expect(managedUploadsSnapshot()[0]).toMatchObject({
      id: upload.id,
      status: "error",
      canRetry: true,
      error: "Reconnect to retry this payment proof. Your selected file is still available.",
    });
    expect(onFailure).toHaveBeenLastCalledWith(
      "Reconnect to retry this payment proof. Your selected file is still available.",
    );

    onlineState.onLine = true;
    await expect(retryManagedUpload(upload.id)).resolves.toBe(true);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]?.status).toBe("done");
    });
    expect(input.presign).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        file: input.file,
      }),
    );
    expect(input.submit).toHaveBeenCalledOnce();
  });

  it("keeps Stop unavailable while a successful server submission settles", async () => {
    setUploadRuntimeAccountId(ACCOUNT_ID);
    let finishSubmit: ((result: { ok: true; proofId: string }) => void) | undefined;
    const submit = vi.fn(
      () =>
        new Promise<{ ok: true; proofId: string }>((resolve) => {
          finishSubmit = resolve;
        }),
    );
    const onSubmitting = vi.fn();
    const onCancelled = vi.fn();
    const onSuccess = vi.fn();
    const input = baseInput({ submit, onSubmitting, onCancelled, onSuccess });

    const upload = startManagedPaymentProofUpload(input);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]).toMatchObject({
        status: "completing",
        canCancel: false,
      });
    });

    await expect(cancelManagedUpload(upload.id)).resolves.toBe(false);
    expect(managedUploadsSnapshot()[0]?.status).toBe("completing");
    expect(onSubmitting).toHaveBeenCalledOnce();
    expect(onCancelled).not.toHaveBeenCalled();

    finishSubmit?.({ ok: true, proofId: "proof-1" });
    await expect(upload.finished).resolves.toBe("succeeded");
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onCancelled).not.toHaveBeenCalled();
    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "done",
      canCancel: false,
    });
  });

  it("reports a rejected server submission without claiming Stop or durable recovery", async () => {
    setUploadRuntimeAccountId(ACCOUNT_ID);
    let finishSubmit: ((result: { ok: false; error: string }) => void) | undefined;
    const submit = vi.fn(
      () =>
        new Promise<{ ok: false; error: string }>((resolve) => {
          finishSubmit = resolve;
        }),
    );
    const onCancelled = vi.fn();
    const onFailure = vi.fn();
    const input = baseInput({ submit, onCancelled, onFailure });

    const upload = startManagedPaymentProofUpload(input);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]).toMatchObject({
        status: "completing",
        canCancel: false,
      });
    });

    await expect(cancelManagedUpload(upload.id)).resolves.toBe(false);
    finishSubmit?.({ ok: false, error: "Could not record the proof." });
    await expect(upload.finished).resolves.toBe("failed");

    expect(onCancelled).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith("Could not record the proof.");
    expect(input.cleanup).not.toHaveBeenCalled();
    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "error",
      error: "Could not record the proof.",
      canCancel: false,
    });
    expect(managedUploadsSnapshot()[0]?.error).not.toMatch(/recovery record/i);
  });

  it("keeps proof bytes, signed URLs, and upload tokens out of persistent storage", () => {
    expect(lifecycleSource).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
    expect(lifecycleSource).not.toMatch(/writeRuntimeState|persist/);
  });
});
