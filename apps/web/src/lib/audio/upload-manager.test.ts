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

function installBrowserLifecycle(initialState: "hidden" | "visible" = "visible") {
  const browserDocument = Object.assign(new EventTarget(), {
    visibilityState: initialState,
  });
  const browserWindow = new EventTarget();
  const addEventListener = vi.spyOn(browserDocument, "addEventListener");
  const removeEventListener = vi.spyOn(browserDocument, "removeEventListener");
  const addWindowEventListener = vi.spyOn(browserWindow, "addEventListener");
  const removeWindowEventListener = vi.spyOn(browserWindow, "removeEventListener");
  vi.stubGlobal("document", browserDocument);
  vi.stubGlobal("window", browserWindow);

  return {
    addEventListener,
    removeEventListener,
    addWindowEventListener,
    removeWindowEventListener,
    setVisibility(state: "hidden" | "visible") {
      browserDocument.visibilityState = state;
      browserDocument.dispatchEvent(new Event("visibilitychange"));
    },
    focus() {
      browserWindow.dispatchEvent(new Event("focus"));
    },
  };
}

afterEach(() => {
  releaseManagedUploadsForAccount(ACCOUNT_A);
  releaseManagedUploadsForAccount(ACCOUNT_B);
  setUploadRuntimeAccountId(null);
  vi.unstubAllGlobals();
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

  it("expires error feedback on wall-clock time while the app is hidden", () => {
    vi.useFakeTimers();
    installBrowserLifecycle("hidden");
    setUploadRuntimeAccountId(ACCOUNT_A);
    const upload = beginManagedUpload({ fileName: "hidden.wav", label: "Hidden upload" });
    upload.setRetry(() => Promise.resolve());

    upload.fail("The connection stopped while the app was hidden.");
    vi.advanceTimersByTime(UPLOAD_ERROR_FEEDBACK_MS - 1);
    expect(managedUploadsSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(managedUploadsSnapshot()).toEqual([]);
  });

  it("clears a throttled error on iOS-style visibility and focus recovery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const lifecycle = installBrowserLifecycle("hidden");
    setUploadRuntimeAccountId(ACCOUNT_A);
    const visibilityUpload = beginManagedUpload({
      fileName: "visibility.wav",
      label: "Visibility upload",
    });

    visibilityUpload.fail("Network error");
    vi.setSystemTime(new Date("2026-08-04T12:00:09.000Z"));
    lifecycle.setVisibility("visible");
    expect(managedUploadsSnapshot()).toEqual([]);

    const focusUpload = beginManagedUpload({ fileName: "focus.wav", label: "Focus upload" });
    focusUpload.fail("Network error");
    vi.setSystemTime(new Date("2026-08-04T12:00:18.000Z"));
    lifecycle.focus();
    expect(managedUploadsSnapshot()).toEqual([]);
  });

  it("keeps the retry action available during the readable error window", async () => {
    vi.useFakeTimers();
    installBrowserLifecycle("hidden");
    setUploadRuntimeAccountId(ACCOUNT_A);
    const retry = vi.fn(() => Promise.resolve());
    const upload = beginManagedUpload({ fileName: "retry.wav", label: "Retry upload" });
    upload.setRetry(retry);

    upload.fail("Network error");
    vi.advanceTimersByTime(UPLOAD_ERROR_FEEDBACK_MS - 1);

    await expect(retryManagedUpload(upload.id)).resolves.toBe(true);
    expect(retry).toHaveBeenCalledOnce();
    expect(managedUploadsSnapshot()[0]?.status).toBe("preparing");
  });

  it("does not duplicate the error timer or lifecycle listeners", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const lifecycle = installBrowserLifecycle();
    setUploadRuntimeAccountId(ACCOUNT_A);
    const upload = beginManagedUpload({ fileName: "single.wav", label: "Single timer" });

    upload.fail("Network error");
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(lifecycle.addEventListener).toHaveBeenCalledTimes(1);
    expect(lifecycle.addWindowEventListener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    lifecycle.setVisibility("hidden");
    lifecycle.setVisibility("visible");
    lifecycle.focus();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(lifecycle.addEventListener).toHaveBeenCalledTimes(1);
    expect(lifecycle.addWindowEventListener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(UPLOAD_ERROR_FEEDBACK_MS - 2000);
    expect(managedUploadsSnapshot()).toEqual([]);
    expect(lifecycle.removeEventListener).toHaveBeenCalledTimes(1);
    expect(lifecycle.removeWindowEventListener).toHaveBeenCalledTimes(1);
  });

  it("cleans the lifecycle listeners when error feedback is removed or reset", () => {
    vi.useFakeTimers();
    const lifecycle = installBrowserLifecycle();
    setUploadRuntimeAccountId(ACCOUNT_A);
    const dismissed = beginManagedUpload({ fileName: "dismiss.wav", label: "Dismiss" });
    dismissed.fail("Network error");

    expect(lifecycle.addEventListener).toHaveBeenCalledTimes(1);
    expect(lifecycle.addWindowEventListener).toHaveBeenCalledTimes(1);
    expect(dismissManagedUpload(dismissed.id)).toBe(true);
    expect(lifecycle.removeEventListener).toHaveBeenCalledTimes(1);
    expect(lifecycle.removeWindowEventListener).toHaveBeenCalledTimes(1);

    const reset = beginManagedUpload({ fileName: "reset.wav", label: "Reset" });
    reset.fail("Network error");
    expect(lifecycle.addEventListener).toHaveBeenCalledTimes(2);
    expect(lifecycle.addWindowEventListener).toHaveBeenCalledTimes(2);
    releaseManagedUploadsForAccount(ACCOUNT_A);
    expect(lifecycle.removeEventListener).toHaveBeenCalledTimes(2);
    expect(lifecycle.removeWindowEventListener).toHaveBeenCalledTimes(2);
  });

  it("keeps success feedback on its existing wall-clock timer while hidden", () => {
    vi.useFakeTimers();
    const visibility = installBrowserLifecycle("hidden");
    setUploadRuntimeAccountId(ACCOUNT_A);
    const upload = beginManagedUpload({ fileName: "done.wav", label: "Done" });

    upload.succeed();
    vi.advanceTimersByTime(UPLOAD_SUCCESS_FEEDBACK_MS);

    expect(managedUploadsSnapshot()).toEqual([]);
    expect(visibility.addEventListener).not.toHaveBeenCalled();
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
