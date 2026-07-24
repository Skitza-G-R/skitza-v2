import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginManagedUpload,
  cancelManagedUploadsForAccount,
  managedUploadsSnapshot,
  releaseManagedUploadsForAccount,
  retryManagedUpload,
  setUploadRuntimeAccountId,
} from "./upload-manager";

const ACCOUNT_A = "user_a";
const ACCOUNT_B = "user_b";

afterEach(() => {
  releaseManagedUploadsForAccount(ACCOUNT_A);
  releaseManagedUploadsForAccount(ACCOUNT_B);
  setUploadRuntimeAccountId(null);
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
});
