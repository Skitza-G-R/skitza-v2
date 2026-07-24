import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { setUploadRuntimeAccountId } from "./upload-manager";

import {
  ACTIVE_UPLOAD_STALE_MS,
  CANCELLATION_RETRY_MS,
  cancelInitializedUploadIfRequested,
  cancellationRetryDue,
  computeParts,
  createUploadCancellationRequest,
  markCancellationRequested,
  markVersionCleanupRequested,
  requestExactMultipartCancellation,
  requestUploadCancellation,
  requestVersionCleanup,
  resumableUploads,
  runRequestedCancellationPass,
  runRecoverableUploadPass,
  runRequestedVersionCleanupPass,
  toExactAbortInput,
  type PendingVersionCleanupEntry,
  type ResumableEntry,
} from "./use-multipart-upload";

const SOURCE = readFileSync(new URL("./use-multipart-upload.ts", import.meta.url), "utf8");
const ACCOUNT_ID = "user_test";

beforeEach(() => {
  setUploadRuntimeAccountId(ACCOUNT_ID);
});

afterEach(() => {
  setUploadRuntimeAccountId(null);
  vi.unstubAllGlobals();
});

describe("computeParts", () => {
  it("splits 50MB into 10 parts of 5MB", () => {
    const parts = computeParts(50 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(10);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 5 * 1024 * 1024 });
  });

  it("last part handles remainder", () => {
    const parts = computeParts(12 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(3);
    const last = parts[2];
    expect(last).toBeDefined();
    if (!last) return;
    expect(last.end - last.start).toBe(2 * 1024 * 1024);
  });

  it("single-part when file smaller than part size", () => {
    const parts = computeParts(1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 1024 });
  });

  it("exact multiple has no partial tail", () => {
    const parts = computeParts(15 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(3);
    const last = parts[2];
    expect(last).toBeDefined();
    if (!last) return;
    expect(last.end - last.start).toBe(5 * 1024 * 1024);
  });

  it("zero size throws", () => {
    expect(() => computeParts(0, 5 * 1024 * 1024)).toThrow(/positive/i);
  });
});

describe("multipart upload recovery identity", () => {
  it("waits at least two signed-part windows before treating an upload as crashed", () => {
    expect(ACTIVE_UPLOAD_STALE_MS).toBeGreaterThanOrEqual(31 * 60 * 1_000);
  });

  it("maps the persisted entry to the exact cancellation identity", () => {
    const entry: ResumableEntry = {
      accountId: ACCOUNT_ID,
      key: "private-key",
      uploadId: "upload-id",
      trackVersionId: "version-id",
      completionToken: "a".repeat(64),
      totalBytes: 123,
      completed: [],
    };

    expect(toExactAbortInput(entry)).toEqual({
      key: entry.key,
      uploadId: entry.uploadId,
      trackVersionId: entry.trackVersionId,
      sizeBytes: entry.totalBytes,
      completionToken: entry.completionToken,
    });
  });

  it("persists recovery identity before the first part operation", () => {
    const initSucceeded = SOURCE.indexOf("if (!init.ok)");
    const initialPersist = SOURCE.indexOf("persistResumableEntry(entry)", initSucceeded);
    const partLoop = SOURCE.indexOf("for (const p of parts)", initSucceeded);

    expect(initialPersist).toBeGreaterThan(initSucceeded);
    expect(initialPersist).toBeLessThan(partLoop);
  });

  it("attempts exact cancellation for sign, PUT, network, and completion failures", () => {
    const signedFailure = SOURCE.slice(
      SOURCE.indexOf("if (!signed.ok)"),
      SOURCE.indexOf("const blob"),
    );
    const networkFailure = SOURCE.slice(
      SOURCE.indexOf("catch (e)"),
      SOURCE.indexOf("if (!resp.ok)"),
    );
    const putFailure = SOURCE.slice(
      SOURCE.indexOf("if (!resp.ok)"),
      SOURCE.indexOf('resp.headers.get("etag")'),
    );
    const completionFailure = SOURCE.slice(
      SOURCE.indexOf("if (!done.ok)"),
      SOURCE.indexOf('setState({ kind: "done"'),
    );

    for (const failureBranch of [signedFailure, networkFailure, putFailure, completionFailure]) {
      expect(failureBranch).toContain("await cancelResumableEntry(entry)");
    }
  });

  it("persists cancellation intent before abort and keeps it while the server is pending", async () => {
    const events: string[] = [];
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      setItem(key: string, value: string) {
        events.push("persist");
        saved.set(key, value);
      },
      removeItem() {
        events.push("remove");
      },
    });
    const entry: ResumableEntry = {
      accountId: ACCOUNT_ID,
      key: "private-key",
      uploadId: "upload-id",
      trackVersionId: "version-id",
      completionToken: "a".repeat(64),
      totalBytes: 123,
      completed: [],
    };

    await expect(
      requestExactMultipartCancellation(
        entry,
        () => {
          events.push("abort");
          return Promise.resolve({ ok: false as const, error: "pending" });
        },
        new Date("2026-07-17T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ ok: false });

    expect(events).toEqual(["persist", "abort"]);
    expect([...saved.values()][0]).toContain('"cancellationRequestedAt"');
  });

  it("records Stop during deferred init, cancels the returned identity, and never continues", async () => {
    const request = createUploadCancellationRequest();
    const abort = vi.fn(() => Promise.resolve({ ok: true as const }));
    const continueUpload = vi.fn();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    let finishInit: ((entry: ResumableEntry) => void) | undefined;
    const initialized = new Promise<ResumableEntry>((resolve) => {
      finishInit = resolve;
    });
    const flow = initialized.then(async (entry) => {
      const canceled = await cancelInitializedUploadIfRequested(request, entry, abort);
      if (canceled === null) continueUpload();
      return canceled;
    });

    requestUploadCancellation(request);
    finishInit?.({
      accountId: ACCOUNT_ID,
      key: "private-key",
      uploadId: "upload-id",
      trackVersionId: "version-id",
      completionToken: "a".repeat(64),
      totalBytes: 123,
      completed: [],
    });

    await expect(flow).resolves.toEqual({ ok: true });
    expect(abort).toHaveBeenCalledOnce();
    expect(continueUpload).not.toHaveBeenCalled();
  });

  it("owns a delayed second pass after the first cancellation stays pending", async () => {
    const requestedAt = new Date("2026-07-17T12:00:00.000Z");
    const entry = markCancellationRequested(
      {
        accountId: ACCOUNT_ID,
        key: "private-key",
        uploadId: "upload-id",
        trackVersionId: "version-id",
        completionToken: "a".repeat(64),
        totalBytes: 123,
        completed: [],
      },
      requestedAt,
      false,
    );
    const removed: string[] = [];
    let attempts = 0;

    expect(cancellationRetryDue(entry, new Date(requestedAt.getTime() + 1_000))).toBe(false);
    await expect(
      runRequestedCancellationPass({
        entries: [entry],
        now: new Date(requestedAt.getTime() + CANCELLATION_RETRY_MS),
        abort: () => {
          attempts += 1;
          return Promise.resolve({ ok: attempts > 1 } as const);
        },
        remove: (uploadId) => removed.push(uploadId),
      }),
    ).resolves.toBe(0);
    expect(removed).toEqual([]);

    await expect(
      runRequestedCancellationPass({
        entries: [entry],
        now: new Date(requestedAt.getTime() + CANCELLATION_RETRY_MS * 2),
        abort: () => {
          attempts += 1;
          return Promise.resolve({ ok: attempts > 1 } as const);
        },
        remove: (uploadId) => removed.push(uploadId),
      }),
    ).resolves.toBe(1);
    expect(removed).toEqual([entry.uploadId]);
  });

  it("publishes cancellation for an unmarked crashed upload only after it is safely stale", async () => {
    const lastProgressAt = new Date("2026-07-17T12:00:00.000Z");
    const events: string[] = [];
    vi.stubGlobal("localStorage", {
      setItem: () => events.push("persist-cancellation"),
      removeItem: () => events.push("remove"),
    });
    const entry: ResumableEntry = {
      accountId: ACCOUNT_ID,
      key: "private-key",
      uploadId: "upload-id",
      trackVersionId: "version-id",
      completionToken: "a".repeat(64),
      totalBytes: 123,
      completed: [],
      createdAt: lastProgressAt.toISOString(),
      lastProgressAt: lastProgressAt.toISOString(),
    };

    await expect(
      runRecoverableUploadPass({
        entries: [entry],
        now: new Date(lastProgressAt.getTime() + ACTIVE_UPLOAD_STALE_MS - 1),
        abort: () => {
          events.push("abort");
          return Promise.resolve({ ok: false as const });
        },
        remove: () => events.push("remove"),
      }),
    ).resolves.toBe(0);
    expect(events).toEqual([]);

    await expect(
      runRecoverableUploadPass({
        entries: [entry],
        now: new Date(lastProgressAt.getTime() + ACTIVE_UPLOAD_STALE_MS),
        abort: () => {
          events.push("abort");
          return Promise.resolve({ ok: false as const });
        },
        remove: () => events.push("remove"),
      }),
    ).resolves.toBe(0);
    expect(events).toEqual(["persist-cancellation", "abort"]);
    expect(entry.cancellationRequestedAt).toBeDefined();
  });

  it("skips malformed local recovery identities without persisting them", () => {
    const entries = [
      [
        `skitza:upload:${encodeURIComponent(ACCOUNT_ID)}:missing-id`,
        JSON.stringify({
          accountId: ACCOUNT_ID,
          key: "private-key",
          completionToken: "a".repeat(64),
          trackVersionId: "11111111-1111-4111-8111-111111111111",
          totalBytes: 123,
          completed: [],
          createdAt: "2026-07-17T12:00:00.000Z",
          lastProgressAt: "2026-07-17T12:00:00.000Z",
        }),
      ],
      [
        `skitza:upload:${encodeURIComponent(ACCOUNT_ID)}:upload-id`,
        JSON.stringify({
          accountId: ACCOUNT_ID,
          uploadId: "upload-id",
          key: "private-key",
          completionToken: "bad-token",
          trackVersionId: "11111111-1111-4111-8111-111111111111",
          totalBytes: 0,
          completed: [],
          createdAt: "not-a-date",
          lastProgressAt: "not-a-date",
        }),
      ],
    ] as const;
    const writes: string[] = [];
    vi.stubGlobal("localStorage", {
      length: entries.length,
      key: (index: number) => entries[index]?.[0] ?? null,
      getItem: (key: string) => entries.find(([candidate]) => candidate === key)?.[1] ?? null,
      setItem: (key: string) => writes.push(key),
    });

    expect(resumableUploads()).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("exposes only the signed-in account's durable journal", () => {
    const versionId = "11111111-1111-4111-8111-111111111111";
    const timestamp = "2026-07-17T12:00:00.000Z";
    const makeEntry = (accountId: string, uploadId: string) => ({
      accountId,
      uploadId,
      key: "private-key",
      completionToken: "a".repeat(64),
      trackVersionId: versionId,
      totalBytes: 123,
      completed: [],
      createdAt: timestamp,
      lastProgressAt: timestamp,
    });
    const a = makeEntry(ACCOUNT_ID, "upload-a");
    const b = makeEntry("user_other", "upload-b");
    const entries = [
      [`skitza:upload:${encodeURIComponent(a.accountId)}:${a.uploadId}`, JSON.stringify(a)],
      [`skitza:upload:${encodeURIComponent(b.accountId)}:${b.uploadId}`, JSON.stringify(b)],
    ] as const;
    vi.stubGlobal("localStorage", {
      length: entries.length,
      key: (index: number) => entries[index]?.[0] ?? null,
      getItem: (key: string) => entries.find(([candidate]) => candidate === key)?.[1] ?? null,
    });

    expect(resumableUploads(ACCOUNT_ID).map((entry) => entry.uploadId)).toEqual(["upload-a"]);
    expect(resumableUploads("user_other").map((entry) => entry.uploadId)).toEqual(["upload-b"]);
  });
});

describe("orphan version cleanup recovery", () => {
  it("persists before cleanup, keeps a pending failure, and removes only server success", async () => {
    const events: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => events.push("persist"),
      removeItem: () => events.push("remove"),
    });
    const entry = markVersionCleanupRequested(
      "11111111-1111-4111-8111-111111111111",
      new Date("2026-07-17T12:00:00.000Z"),
    );

    await expect(
      requestVersionCleanup(entry, () => {
        events.push("cleanup");
        return Promise.resolve({ ok: false as const, error: "pending" });
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(events).toEqual(["persist", "persist", "cleanup"]);

    await expect(
      requestVersionCleanup(entry, () => {
        events.push("cleanup");
        return Promise.resolve({ ok: true as const });
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(events.slice(-3)).toEqual(["persist", "cleanup", "remove"]);
  });

  it("retries a due version cleanup on a later mounted recovery pass", async () => {
    const entry: PendingVersionCleanupEntry = {
      accountId: ACCOUNT_ID,
      trackVersionId: "11111111-1111-4111-8111-111111111111",
      cleanupRequestedAt: "2026-07-17T12:00:00.000Z",
    };
    const removed: string[] = [];

    await expect(
      runRequestedVersionCleanupPass({
        entries: [entry],
        now: new Date("2026-07-17T12:01:01.000Z"),
        cleanup: () => Promise.resolve({ ok: true as const }),
        remove: (trackVersionId) => removed.push(trackVersionId),
      }),
    ).resolves.toBe(1);
    expect(removed).toEqual([entry.trackVersionId]);
  });
});
