import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginManagedUpload,
  cancelManagedUpload,
  cancelManagedUploadsForAccount,
  dismissManagedUpload,
  managedUploadsSnapshot,
  releaseManagedUploadsForAccount,
  retryManagedUpload,
  setUploadRuntimeAccountId,
  UPLOAD_ERROR_FEEDBACK_MS,
  UPLOAD_SUCCESS_FEEDBACK_MS,
} from "./upload-manager";

const ACCOUNT_A = "user_a";
const ACCOUNT_B = "user_b";

afterEach(() => {
  releaseManagedUploadsForAccount(ACCOUNT_A);
  releaseManagedUploadsForAccount(ACCOUNT_B);
  setUploadRuntimeAccountId(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("app-level upload registry", () => {
  it("never exposes records owned by a previous account", () => {
    setUploadRuntimeAccountId(ACCOUNT_A);
    beginManagedUpload({ fileName: "a.wav", label: "A" });
    expect(managedUploadsSnapshot().map((record) => record.accountId)).toEqual([ACCOUNT_A]);

    setUploadRuntimeAccountId(ACCOUNT_B);
    expect(managedUploadsSnapshot()).toEqual([]);
    beginManagedUpload({ fileName: "b.wav", label: "B" });
    expect(managedUploadsSnapshot().map((record) => record.accountId)).toEqual([ACCOUNT_B]);

    setUploadRuntimeAccountId(ACCOUNT_A);
    expect(managedUploadsSnapshot().map((record) => record.fileName)).toEqual(["a.wav"]);
  });

  it("awaits cancellation while the exiting account remains active", async () => {
    setUploadRuntimeAccountId(ACCOUNT_A);
    const events: string[] = [];
    const upload = beginManagedUpload({ fileName: "mix.wav", label: "Mix" });
    upload.setCancel(async () => {
      events.push("cancel");
      await Promise.resolve();
      events.push("settled");
      return { ok: false };
    });
    upload.setUploading(40);

    await expect(cancelManagedUploadsForAccount(ACCOUNT_A)).resolves.toBe(false);
    expect(events).toEqual(["cancel", "settled"]);
    expect(managedUploadsSnapshot()[0]?.status).toBe("error");
  });

  it("keeps progress and an in-memory retry action across route consumers", async () => {
    setUploadRuntimeAccountId(ACCOUNT_A);
    const retry = vi.fn(() => Promise.resolve());
    const upload = beginManagedUpload({
      fileName: "master.wav",
      label: "Master",
    });
    upload.setUploading(57);
    upload.setRetry(retry);
    upload.fail("Network error");

    expect(managedUploadsSnapshot()[0]).toMatchObject({
      progress: 57,
      status: "error",
      canRetry: true,
      error: "Network error",
    });
    await expect(retryManagedUpload(upload.id)).resolves.toBe(true);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("releases the retry closure after a successful upload", async () => {
    setUploadRuntimeAccountId(ACCOUNT_A);
    const retry = vi.fn(() => Promise.resolve());
    const upload = beginManagedUpload({ fileName: "done.wav", label: "Done" });
    upload.setRetry(retry);
    upload.succeed();

    await expect(retryManagedUpload(upload.id)).resolves.toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });

  it("removes completed upload feedback after the success window", () => {
    vi.useFakeTimers();
    setUploadRuntimeAccountId(ACCOUNT_A);
    const upload = beginManagedUpload({ fileName: "done.wav", label: "Final mix" });

    upload.succeed();

    expect(managedUploadsSnapshot()[0]?.status).toBe("done");
    vi.advanceTimersByTime(UPLOAD_SUCCESS_FEEDBACK_MS - 1);
    expect(managedUploadsSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(managedUploadsSnapshot()).toEqual([]);
  });

  it("keeps active uploads visible past every terminal feedback window", () => {
    vi.useFakeTimers();
    setUploadRuntimeAccountId(ACCOUNT_A);
    const upload = beginManagedUpload({ fileName: "long.wav", label: "Long upload" });
    upload.setUploading(42);

    vi.advanceTimersByTime(UPLOAD_ERROR_FEEDBACK_MS * 2);

    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "uploading",
      progress: 42,
    });
  });

  it("removes readable error feedback after the longer error window", () => {
    vi.useFakeTimers();
    setUploadRuntimeAccountId(ACCOUNT_A);
    const upload = beginManagedUpload({ fileName: "broken.wav", label: "Broken upload" });
    upload.setRetry(() => Promise.resolve());

    upload.fail("The connection stopped before the upload finished.");

    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "error",
      canRetry: true,
    });
    vi.advanceTimersByTime(UPLOAD_ERROR_FEEDBACK_MS - 1);
    expect(managedUploadsSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(managedUploadsSnapshot()).toEqual([]);
  });

  it("lets terminal feedback be closed manually but protects active work", () => {
    vi.useFakeTimers();
    setUploadRuntimeAccountId(ACCOUNT_A);
    const upload = beginManagedUpload({ fileName: "mix.wav", label: "Mix" });

    upload.setUploading(18);
    expect(dismissManagedUpload(upload.id)).toBe(false);
    expect(managedUploadsSnapshot()).toHaveLength(1);

    upload.fail("Network error");
    expect(dismissManagedUpload(upload.id)).toBe(true);
    expect(managedUploadsSnapshot()).toEqual([]);
    vi.runAllTimers();
    expect(managedUploadsSnapshot()).toEqual([]);
  });

  it("removes Stop once server completion begins", async () => {
    setUploadRuntimeAccountId(ACCOUNT_A);
    const cancel = vi.fn(() => Promise.resolve({ ok: true }));
    const upload = beginManagedUpload({ fileName: "proof.pdf", label: "Payment proof" });
    upload.setCancel(cancel);
    upload.setUploading(100);

    upload.setCompleting();

    expect(managedUploadsSnapshot()[0]).toMatchObject({
      status: "completing",
      progress: 100,
      canCancel: false,
    });
    await expect(cancelManagedUpload(upload.id)).resolves.toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(managedUploadsSnapshot()[0]?.status).toBe("completing");
  });
});
