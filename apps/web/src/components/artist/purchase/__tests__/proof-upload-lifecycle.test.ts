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
import { startManagedPaymentProofUpload } from "../proof-upload-lifecycle";

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
    contentType: "application/pdf",
    amountCents: 12_000,
    note: "Paid by transfer",
    presign: vi.fn().mockResolvedValue({
      ok: true,
      uploadUrl: "https://private-upload.invalid/signed",
      uploadToken: "opaque-token",
    }),
    submit: vi.fn().mockResolvedValue({ ok: true, proofId: "proof-1" }),
    fetchImpl: vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch,
    ...overrides,
  };
}

afterEach(() => {
  releaseManagedUploadsForAccount(ACCOUNT_ID);
  setUploadRuntimeAccountId(null);
  vi.restoreAllMocks();
});

describe("managed payment-proof upload", () => {
  it("stays visible in app upload activity until server-confirmed success", async () => {
    setUploadRuntimeAccountId(ACCOUNT_ID);
    let finishPut: ((response: Pick<Response, "ok">) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Pick<Response, "ok">>((resolve) => {
          finishPut = resolve;
        }),
    ) as unknown as typeof fetch;
    const input = baseInput({ fetchImpl });

    const upload = startManagedPaymentProofUpload(input);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]).toMatchObject({
        id: upload.id,
        fileName: "receipt.pdf",
        label: "Payment proof",
        status: "uploading",
        canCancel: true,
        canRetry: true,
      });
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
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const putSignal = init?.signal ?? null;
          readPutAborted = () => putSignal?.aborted ?? false;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const input = baseInput({ fetchImpl });

    const upload = startManagedPaymentProofUpload(input);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]?.status).toBe("uploading");
    });

    await expect(cancelManagedUpload(upload.id)).resolves.toBe(true);
    await expect(upload.finished).resolves.toBe("cancelled");
    expect(readPutAborted()).toBe(true);
    expect(input.submit).not.toHaveBeenCalled();
    expect(managedUploadsSnapshot()).toEqual([]);
  });

  it("reports failure truthfully and retries from a fresh presign", async () => {
    setUploadRuntimeAccountId(ACCOUNT_ID);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true }) as unknown as typeof fetch;
    const input = baseInput({ fetchImpl });

    const upload = startManagedPaymentProofUpload(input);
    await expect(upload.finished).resolves.toBe("failed");
    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "error",
      canRetry: true,
      error: "The file upload did not finish. Check your connection and try again.",
    });

    await expect(retryManagedUpload(upload.id)).resolves.toBe(true);
    await vi.waitFor(() => {
      expect(managedUploadsSnapshot()[0]?.status).toBe("done");
    });
    expect(input.presign).toHaveBeenCalledTimes(2);
    expect(input.submit).toHaveBeenCalledOnce();
  });

  it("keeps proof bytes, signed URLs, and upload tokens out of persistent storage", () => {
    expect(lifecycleSource).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
    expect(lifecycleSource).not.toMatch(/writeRuntimeState|persist/);
  });
});
