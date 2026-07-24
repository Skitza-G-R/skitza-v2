"use client";

import { beginManagedUpload } from "~/lib/audio/upload-manager";

import type { ProofContentType } from "./actions";

type ProofPresignResult =
  | { ok: true; uploadUrl: string; uploadToken: string }
  | { ok: false; error: string };
type ProofCleanupResult = { ok: true } | { ok: false; error: string };
type ProofSubmitResult = { ok: true; proofId: string } | { ok: false; error: string };

export type ManagedPaymentProofUploadOutcome = "succeeded" | "cancelled" | "failed";

export type PaymentProofByteUploadInput = {
  uploadUrl: string;
  file: File;
  contentType: ProofContentType;
  signal: AbortSignal;
  onProgress: (loadedBytes: number, totalBytes: number) => void;
};

export type PaymentProofByteUpload = (
  input: PaymentProofByteUploadInput,
) => Promise<{ ok: boolean }>;

export type ManagedPaymentProofUploadInput = {
  file: File;
  purchaseId: string;
  installmentId: string;
  contentType: ProofContentType;
  amountCents: number;
  note: string | null;
  presign: (input: {
    purchaseId: string;
    installmentId: string;
    fileName: string;
    contentType: ProofContentType;
    sizeBytes: number;
  }) => Promise<ProofPresignResult>;
  cleanup: (input: {
    purchaseId: string;
    installmentId: string;
    uploadToken: string;
  }) => Promise<ProofCleanupResult>;
  submit: (input: {
    purchaseId: string;
    installmentId: string;
    uploadToken: string;
    amountCents: number;
    note?: string;
  }) => Promise<ProofSubmitResult>;
  uploadFile: PaymentProofByteUpload;
  onStart?: () => void;
  onSubmitting?: () => void;
  onSuccess?: () => void;
  onCancelled?: () => void;
  onFailure?: (message: string) => void;
};

export type ManagedPaymentProofUpload = {
  id: string;
  finished: Promise<ManagedPaymentProofUploadOutcome>;
};

type UploadPhase = "preparing" | "uploading" | "submitting";

const OFFLINE_PAYMENT_PROOF_RETRY_MESSAGE =
  "Reconnect to retry this payment proof. Your selected file is still available.";
const PAYMENT_PROOF_CLEANUP_ERROR =
  "The upload stopped, but its private staging copy could not be cleaned up. Try again.";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not upload the proof. Try again.";
}

function cancellationRequested(controller: AbortController): boolean {
  return controller.signal.aborted;
}

/**
 * XMLHttpRequest is used only for this in-memory PUT because fetch does not
 * expose upload byte progress. The signed URL, proof bytes, and opaque token
 * never leave this attempt's closure or enter durable browser storage.
 */
export function uploadPaymentProofBytes(
  input: PaymentProofByteUploadInput,
): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      callback();
    }

    function abort() {
      request.abort();
    }

    request.open("PUT", input.uploadUrl);
    request.setRequestHeader("Content-Type", input.contentType);
    request.upload.addEventListener("progress", (event) => {
      const totalBytes = input.file.size;
      if (totalBytes <= 0) return;
      input.onProgress(Math.min(totalBytes, Math.max(0, event.loaded)), totalBytes);
    });
    request.addEventListener("load", () => {
      input.onProgress(input.file.size, input.file.size);
      finish(() => {
        resolve({ ok: request.status >= 200 && request.status < 300 });
      });
    });
    request.addEventListener("error", () => {
      finish(() => {
        reject(new Error("The file upload did not finish. Check your connection and try again."));
      });
    });
    request.addEventListener("abort", () => {
      finish(() => {
        reject(new DOMException("Upload stopped.", "AbortError"));
      });
    });
    input.signal.addEventListener("abort", abort, { once: true });

    if (input.signal.aborted) {
      finish(() => {
        reject(new DOMException("Upload stopped.", "AbortError"));
      });
      return;
    }

    input.onProgress(0, input.file.size);
    request.send(input.file);
  });
}

/**
 * Keeps only the selected File in the upload manager's in-memory retry
 * closure. Signed URLs are released with each attempt; an opaque upload token
 * stays only long enough to retry a failed staging cleanup and is never
 * written to browser storage.
 */
export function startManagedPaymentProofUpload(
  input: ManagedPaymentProofUploadInput,
): ManagedPaymentProofUpload {
  const managed = beginManagedUpload({
    fileName: input.file.name,
    label: "Payment proof",
  });
  const controller = new AbortController();
  let phase: UploadPhase = "preparing";
  let activeUploadToken: string | null = null;
  let finalizationStarted = false;
  let stagingCleanupPending = false;
  let resolveFinished: (outcome: ManagedPaymentProofUploadOutcome) => void = () => {};
  const finished = new Promise<ManagedPaymentProofUploadOutcome>((resolve) => {
    resolveFinished = resolve;
  });

  const cleanupStaging = async (): Promise<string | null> => {
    if (!activeUploadToken) {
      stagingCleanupPending = false;
      return null;
    }
    stagingCleanupPending = true;
    try {
      const result = await input.cleanup({
        purchaseId: input.purchaseId,
        installmentId: input.installmentId,
        uploadToken: activeUploadToken,
      });
      if (!result.ok) return result.error;
      activeUploadToken = null;
      stagingCleanupPending = false;
      return null;
    } catch {
      return PAYMENT_PROOF_CLEANUP_ERROR;
    }
  };
  const finishCancelled = async (): Promise<void> => {
    const cleanupError = await cleanupStaging();
    if (cleanupError) {
      managed.fail(cleanupError);
      input.onFailure?.(cleanupError);
      resolveFinished("failed");
      return;
    }
    input.onCancelled?.();
    resolveFinished("cancelled");
  };

  managed.setCancel(async () => {
    if (phase === "submitting") return { ok: false };
    controller.abort();
    const outcome = await finished;
    return { ok: outcome === "cancelled" };
  });
  managed.setRetry(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      input.onFailure?.(OFFLINE_PAYMENT_PROOF_RETRY_MESSAGE);
      throw new Error(OFFLINE_PAYMENT_PROOF_RETRY_MESSAGE);
    }
    if (stagingCleanupPending) {
      const cleanupError = await cleanupStaging();
      if (cleanupError) {
        input.onFailure?.(cleanupError);
        throw new Error(cleanupError);
      }
    }
    managed.dismiss();
    startManagedPaymentProofUpload(input);
  });

  void (async () => {
    managed.setPreparing();
    input.onStart?.();
    try {
      const presigned = await input.presign({
        purchaseId: input.purchaseId,
        installmentId: input.installmentId,
        fileName: input.file.name,
        contentType: input.contentType,
        sizeBytes: input.file.size,
      });
      if (!presigned.ok) {
        if (cancellationRequested(controller)) {
          await finishCancelled();
          return;
        }
        throw new Error(presigned.error);
      }
      activeUploadToken = presigned.uploadToken;
      if (cancellationRequested(controller)) {
        await finishCancelled();
        return;
      }

      phase = "uploading";
      managed.setUploading(0);
      const uploaded = await input.uploadFile({
        uploadUrl: presigned.uploadUrl,
        file: input.file,
        contentType: input.contentType,
        signal: controller.signal,
        onProgress: (loadedBytes, totalBytes) => {
          if (
            phase !== "uploading" ||
            cancellationRequested(controller) ||
            !Number.isFinite(loadedBytes) ||
            !Number.isFinite(totalBytes) ||
            totalBytes <= 0
          ) {
            return;
          }
          const boundedLoadedBytes = Math.min(totalBytes, Math.max(0, loadedBytes));
          managed.setUploading((boundedLoadedBytes / totalBytes) * 100);
        },
      });
      if (!uploaded.ok) {
        if (cancellationRequested(controller)) {
          await finishCancelled();
          return;
        }
        throw new Error("The file upload did not finish. Check your connection and try again.");
      }
      if (cancellationRequested(controller)) {
        await finishCancelled();
        return;
      }

      phase = "submitting";
      managed.setCompleting();
      input.onSubmitting?.();
      finalizationStarted = true;
      const submitted = await input.submit({
        purchaseId: input.purchaseId,
        installmentId: input.installmentId,
        uploadToken: presigned.uploadToken,
        amountCents: input.amountCents,
        ...(input.note ? { note: input.note } : {}),
      });
      if (!submitted.ok) {
        throw new Error(submitted.error);
      }

      managed.succeed();
      activeUploadToken = null;
      input.onSuccess?.();
      resolveFinished("succeeded");
    } catch (error) {
      if (cancellationRequested(controller) && !finalizationStarted) {
        await finishCancelled();
        return;
      }
      let message = errorMessage(error);
      if (!finalizationStarted) {
        message = (await cleanupStaging()) ?? message;
      }
      managed.fail(message);
      input.onFailure?.(message);
      resolveFinished("failed");
    }
  })();

  return { id: managed.id, finished };
}
