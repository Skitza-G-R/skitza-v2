"use client";

import { beginManagedUpload } from "~/lib/audio/upload-manager";

import type { ProofContentType } from "./actions";

type ProofPresignResult =
  | { ok: true; uploadUrl: string; uploadToken: string }
  | { ok: false; error: string };
type ProofSubmitResult = { ok: true; proofId: string } | { ok: false; error: string };

export type ManagedPaymentProofUploadOutcome = "succeeded" | "cancelled" | "failed";

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
  submit: (input: {
    purchaseId: string;
    installmentId: string;
    uploadToken: string;
    amountCents: number;
    note?: string;
  }) => Promise<ProofSubmitResult>;
  fetchImpl: typeof fetch;
  onStart?: () => void;
  onSuccess?: () => void;
  onCancelled?: () => void;
  onFailure?: (message: string) => void;
};

export type ManagedPaymentProofUpload = {
  id: string;
  finished: Promise<ManagedPaymentProofUploadOutcome>;
};

type UploadPhase = "preparing" | "uploading" | "submitting";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not upload the proof. Try again.";
}

function cancellationRequested(controller: AbortController): boolean {
  return controller.signal.aborted;
}

/**
 * Keeps only the selected File in the upload manager's in-memory retry
 * closure. Signed URLs and opaque tokens live inside one attempt and are
 * released as soon as it settles.
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
  let resolveFinished: (outcome: ManagedPaymentProofUploadOutcome) => void = () => {};
  const finished = new Promise<ManagedPaymentProofUploadOutcome>((resolve) => {
    resolveFinished = resolve;
  });

  managed.setCancel(async () => {
    controller.abort();
    const outcome = await finished;
    return { ok: outcome === "cancelled" || outcome === "succeeded" };
  });
  managed.setRetry(() => {
    managed.dismiss();
    startManagedPaymentProofUpload(input);
    return Promise.resolve();
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
          input.onCancelled?.();
          resolveFinished("cancelled");
          return;
        }
        throw new Error(presigned.error);
      }
      if (cancellationRequested(controller)) {
        input.onCancelled?.();
        resolveFinished("cancelled");
        return;
      }

      phase = "uploading";
      managed.setUploading(0);
      const uploaded = await input.fetchImpl(presigned.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": input.contentType },
        body: input.file,
        signal: controller.signal,
      });
      if (!uploaded.ok) {
        if (cancellationRequested(controller)) {
          input.onCancelled?.();
          resolveFinished("cancelled");
          return;
        }
        throw new Error("The file upload did not finish. Check your connection and try again.");
      }
      if (cancellationRequested(controller)) {
        input.onCancelled?.();
        resolveFinished("cancelled");
        return;
      }

      phase = "submitting";
      managed.setCompleting();
      const submitted = await input.submit({
        purchaseId: input.purchaseId,
        installmentId: input.installmentId,
        uploadToken: presigned.uploadToken,
        amountCents: input.amountCents,
        ...(input.note ? { note: input.note } : {}),
      });
      if (!submitted.ok) {
        if (cancellationRequested(controller)) {
          input.onCancelled?.();
          resolveFinished("cancelled");
          return;
        }
        throw new Error(submitted.error);
      }

      managed.succeed();
      input.onSuccess?.();
      resolveFinished("succeeded");
    } catch (error) {
      if (cancellationRequested(controller) && phase !== "submitting") {
        input.onCancelled?.();
        resolveFinished("cancelled");
        return;
      }
      const message = errorMessage(error);
      managed.fail(message);
      input.onFailure?.(message);
      resolveFinished("failed");
    }
  })();

  return { id: managed.id, finished };
}
