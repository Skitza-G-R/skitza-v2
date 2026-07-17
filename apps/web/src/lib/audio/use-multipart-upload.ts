"use client";

import { useCallback, useEffect, useState } from "react";

import {
  abortAudioUpload,
  completeAudioUpload,
  initAudioUpload,
  signAudioPart,
} from "~/app/(producer)/dashboard/audio-upload-actions";
import { deleteVersionAction } from "~/app/(producer)/dashboard/clients-projects/upload-actions";

export type UploadState =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "uploading"; progress: number }
  | { kind: "completing" }
  | { kind: "done"; url: string; key: string }
  | { kind: "error"; message: string };

export type PartRange = { partNumber: number; start: number; end: number };

// Split a file into multipart upload ranges. Each part is exactly
// `partSize` bytes except the last, which may be smaller. Part numbers
// are 1-indexed because S3/R2 require that.
export function computeParts(totalBytes: number, partSize: number): PartRange[] {
  if (totalBytes <= 0) throw new Error("totalBytes must be positive");
  if (partSize <= 0) throw new Error("partSize must be positive");
  const parts: PartRange[] = [];
  let offset = 0;
  let n = 1;
  while (offset < totalBytes) {
    const end = Math.min(offset + partSize, totalBytes);
    parts.push({ partNumber: n, start: offset, end });
    n += 1;
    offset = end;
  }
  return parts;
}

const STORAGE_PREFIX = "skitza:upload:";
const VERSION_CLEANUP_STORAGE_PREFIX = "skitza:upload-version-cleanup:";
const PART_SIZE = 5 * 1024 * 1024; // 5 MB per part
export const CANCELLATION_RETRY_MS = 61_000;
// A signed part URL is valid for 900 seconds. Two full signing windows plus
// a retry buffer avoid cancelling a slow live PUT in another tab.
export const ACTIVE_UPLOAD_STALE_MS = 31 * 60 * 1_000;

export type ResumableEntry = {
  uploadId: string;
  key: string;
  completionToken: string;
  trackVersionId: string;
  completed: Array<{ partNumber: number; eTag: string }>;
  totalBytes: number;
  createdAt?: string;
  lastProgressAt?: string;
  cancellationRequestedAt?: string;
};

export type PendingVersionCleanupEntry = {
  trackVersionId: string;
  cleanupRequestedAt: string;
};

type RecoveryResult = Readonly<{ ok: boolean }>;
type ExactAbort = (input: ReturnType<typeof toExactAbortInput>) => Promise<RecoveryResult>;
type VersionCleanup = (input: { id: string }) => Promise<RecoveryResult>;

export function toExactAbortInput(entry: ResumableEntry) {
  return {
    key: entry.key,
    uploadId: entry.uploadId,
    trackVersionId: entry.trackVersionId,
    sizeBytes: entry.totalBytes,
    completionToken: entry.completionToken,
  };
}

export function persistResumableEntry(entry: ResumableEntry): void {
  localStorage.setItem(`${STORAGE_PREFIX}${entry.uploadId}`, JSON.stringify(entry));
}

export function removeResumableEntry(uploadId: string): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${uploadId}`);
}

export function markResumableProgress(
  entry: ResumableEntry,
  now = new Date(),
  persist = true,
): ResumableEntry {
  if (!Number.isFinite(now.getTime())) throw new Error("Upload progress time is invalid");
  const observedAt = now.toISOString();
  entry.createdAt ??= observedAt;
  entry.lastProgressAt = observedAt;
  if (persist) persistResumableEntry(entry);
  return entry;
}

export function markCancellationRequested(
  entry: ResumableEntry,
  now = new Date(),
  persist = true,
): ResumableEntry {
  if (!Number.isFinite(now.getTime())) throw new Error("Cancellation time is invalid");
  entry.cancellationRequestedAt ??= now.toISOString();
  if (persist) persistResumableEntry(entry);
  return entry;
}

export function cancellationRetryDue(entry: ResumableEntry, now = new Date()): boolean {
  if (entry.cancellationRequestedAt === undefined) return false;
  const requestedAt = new Date(entry.cancellationRequestedAt);
  return (
    Number.isFinite(requestedAt.getTime()) &&
    Number.isFinite(now.getTime()) &&
    now.getTime() - requestedAt.getTime() >= CANCELLATION_RETRY_MS
  );
}

export function activeUploadRecoveryDue(entry: ResumableEntry, now = new Date()): boolean {
  if (entry.cancellationRequestedAt !== undefined) return false;
  const lastProgressAt = new Date(entry.lastProgressAt ?? entry.createdAt ?? "");
  return (
    Number.isFinite(lastProgressAt.getTime()) &&
    Number.isFinite(now.getTime()) &&
    now.getTime() - lastProgressAt.getTime() >= ACTIVE_UPLOAD_STALE_MS
  );
}

export async function runRequestedCancellationPass(
  input: Readonly<{
    entries: readonly ResumableEntry[];
    now: Date;
    abort: ExactAbort;
    remove: (uploadId: string) => void;
  }>,
): Promise<number> {
  let completed = 0;
  for (const entry of input.entries) {
    if (!cancellationRetryDue(entry, input.now)) continue;
    let result: RecoveryResult;
    try {
      result = await input.abort(toExactAbortInput(entry));
    } catch {
      continue;
    }
    if (!result.ok) continue;
    input.remove(entry.uploadId);
    completed += 1;
  }
  return completed;
}

export async function requestExactMultipartCancellation(
  entry: ResumableEntry,
  abort: ExactAbort = abortAudioUpload,
  now = new Date(),
): Promise<RecoveryResult> {
  const pending = markCancellationRequested(entry, now);
  let result: RecoveryResult;
  try {
    result = await abort(toExactAbortInput(pending));
  } catch {
    return { ok: false };
  }
  if (result.ok) {
    removeResumableEntry(entry.uploadId);
  }
  return result;
}

async function cancelResumableEntry(entry: ResumableEntry) {
  return requestExactMultipartCancellation(entry, abortAudioUpload);
}

export async function runRecoverableUploadPass(
  input: Readonly<{
    entries: readonly ResumableEntry[];
    now: Date;
    abort: ExactAbort;
    remove: (uploadId: string) => void;
  }>,
): Promise<number> {
  let completed = 0;
  for (const entry of input.entries) {
    const requestedRetry = cancellationRetryDue(entry, input.now);
    const staleActiveUpload = activeUploadRecoveryDue(entry, input.now);
    if (!requestedRetry && !staleActiveUpload) continue;
    if (staleActiveUpload) {
      try {
        markCancellationRequested(entry, input.now);
      } catch {
        // Never abort unless the durable cancellation intent was saved first.
        continue;
      }
    }
    let result: RecoveryResult;
    try {
      result = await input.abort(toExactAbortInput(entry));
    } catch {
      continue;
    }
    if (!result.ok) continue;
    input.remove(entry.uploadId);
    completed += 1;
  }
  return completed;
}

function versionCleanupStorageKey(trackVersionId: string): string {
  return `${VERSION_CLEANUP_STORAGE_PREFIX}${trackVersionId}`;
}

export function markVersionCleanupRequested(
  trackVersionId: string,
  now = new Date(),
): PendingVersionCleanupEntry {
  if (!Number.isFinite(now.getTime())) throw new Error("Version cleanup time is invalid");
  const storageKey = versionCleanupStorageKey(trackVersionId);
  const existing = localStorage.getItem(storageKey);
  let cleanupRequestedAt = now.toISOString();
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as Partial<PendingVersionCleanupEntry>;
      const parsedTime = new Date(parsed.cleanupRequestedAt ?? "");
      if (Number.isFinite(parsedTime.getTime())) cleanupRequestedAt = parsedTime.toISOString();
    } catch {
      // Replace malformed recovery state with a valid durable request.
    }
  }
  const entry = { trackVersionId, cleanupRequestedAt };
  localStorage.setItem(storageKey, JSON.stringify(entry));
  return entry;
}

export function removeVersionCleanupEntry(trackVersionId: string): void {
  localStorage.removeItem(versionCleanupStorageKey(trackVersionId));
}

function versionCleanupRetryDue(entry: PendingVersionCleanupEntry, now = new Date()): boolean {
  const requestedAt = new Date(entry.cleanupRequestedAt);
  return (
    Number.isFinite(requestedAt.getTime()) &&
    Number.isFinite(now.getTime()) &&
    now.getTime() - requestedAt.getTime() >= CANCELLATION_RETRY_MS
  );
}

export async function requestVersionCleanup(
  entry: PendingVersionCleanupEntry,
  cleanup: VersionCleanup = deleteVersionAction,
): Promise<RecoveryResult> {
  // Re-persist before every attempt so cleanup can never outrun its owner.
  localStorage.setItem(versionCleanupStorageKey(entry.trackVersionId), JSON.stringify(entry));
  let result: RecoveryResult;
  try {
    result = await cleanup({ id: entry.trackVersionId });
  } catch {
    return { ok: false };
  }
  if (result.ok) removeVersionCleanupEntry(entry.trackVersionId);
  return result;
}

export async function runRequestedVersionCleanupPass(
  input: Readonly<{
    entries: readonly PendingVersionCleanupEntry[];
    now: Date;
    cleanup: VersionCleanup;
    remove: (trackVersionId: string) => void;
  }>,
): Promise<number> {
  let completed = 0;
  for (const entry of input.entries) {
    if (!versionCleanupRetryDue(entry, input.now)) continue;
    let result: RecoveryResult;
    try {
      result = await input.cleanup({ id: entry.trackVersionId });
    } catch {
      continue;
    }
    if (!result.ok) continue;
    input.remove(entry.trackVersionId);
    completed += 1;
  }
  return completed;
}

let recoveryOwners = 0;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryRunning = false;

async function runScheduledCancellationRecovery(): Promise<void> {
  if (recoveryRunning || recoveryOwners === 0) return;
  recoveryRunning = true;
  try {
    await runRecoverableUploadPass({
      entries: resumableUploads(),
      now: new Date(),
      abort: abortAudioUpload,
      remove: removeResumableEntry,
    });
    const stillActiveVersionIds = new Set(resumableUploads().map((entry) => entry.trackVersionId));
    await runRequestedVersionCleanupPass({
      entries: pendingVersionCleanups().filter(
        (entry) => !stillActiveVersionIds.has(entry.trackVersionId),
      ),
      now: new Date(),
      cleanup: deleteVersionAction,
      remove: removeVersionCleanupEntry,
    });
  } finally {
    recoveryRunning = false;
    if (recoveryOwners > 0) {
      recoveryTimer = setTimeout(() => {
        void runScheduledCancellationRecovery();
      }, CANCELLATION_RETRY_MS);
    }
  }
}

/** Keep one durable browser retry owner alive while an upload surface is mounted. */
export function startMultipartCancellationRecovery(): () => void {
  recoveryOwners += 1;
  if (recoveryTimer === null && !recoveryRunning) {
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      void runScheduledCancellationRecovery();
    }, 0);
  }
  return () => {
    recoveryOwners = Math.max(0, recoveryOwners - 1);
    if (recoveryOwners === 0 && recoveryTimer !== null) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
  };
}

// Enumerate in-progress uploads persisted to localStorage. Used by the
// dashboard to surface a "resume?" prompt on page load. Malformed
// entries are silently skipped rather than blocking the whole read.
export function resumableUploads(): ResumableEntry[] {
  if (typeof localStorage === "undefined") return [];
  const out: ResumableEntry[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      const entry = JSON.parse(raw) as unknown;
      if (!isResumableEntry(entry, k.slice(STORAGE_PREFIX.length))) continue;
      out.push(entry);
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isResumableEntry(value: unknown, storageUploadId: string): value is ResumableEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.uploadId !== "string" ||
    entry.uploadId.length === 0 ||
    entry.uploadId !== storageUploadId ||
    typeof entry.key !== "string" ||
    entry.key.length === 0 ||
    !isUuid(entry.trackVersionId) ||
    typeof entry.completionToken !== "string" ||
    !/^[0-9a-f]{64}$/.test(entry.completionToken) ||
    typeof entry.totalBytes !== "number" ||
    !Number.isSafeInteger(entry.totalBytes) ||
    entry.totalBytes <= 0 ||
    !Array.isArray(entry.completed) ||
    !isIsoTimestamp(entry.createdAt) ||
    !isIsoTimestamp(entry.lastProgressAt) ||
    new Date(entry.createdAt).getTime() > new Date(entry.lastProgressAt).getTime() ||
    (entry.cancellationRequestedAt !== undefined && !isIsoTimestamp(entry.cancellationRequestedAt))
  ) {
    return false;
  }
  return entry.completed.every((part) => {
    if (typeof part !== "object" || part === null) return false;
    const candidate = part as Record<string, unknown>;
    return (
      typeof candidate.partNumber === "number" &&
      Number.isSafeInteger(candidate.partNumber) &&
      candidate.partNumber > 0 &&
      typeof candidate.eTag === "string"
    );
  });
}

function pendingVersionCleanups(): PendingVersionCleanupEntry[] {
  if (typeof localStorage === "undefined") return [];
  const out: PendingVersionCleanupEntry[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(VERSION_CLEANUP_STORAGE_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const entry = JSON.parse(raw) as PendingVersionCleanupEntry;
      if (
        isUuid(entry.trackVersionId) &&
        key === versionCleanupStorageKey(entry.trackVersionId) &&
        isIsoTimestamp(entry.cleanupRequestedAt)
      ) {
        out.push(entry);
      }
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

export function useMultipartUpload() {
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  useEffect(() => startMultipartCancellationRecovery(), []);

  const upload = useCallback(
    async (opts: {
      file: File;
      trackVersionId: string;
      onComplete: (r: { url: string; key: string }) => void;
    }) => {
      setState({ kind: "signing" });
      const init = await initAudioUpload({
        trackVersionId: opts.trackVersionId,
        filename: opts.file.name,
        sizeBytes: opts.file.size,
        contentType: opts.file.type || "application/octet-stream",
      });
      if (!init.ok) {
        setState({ kind: "error", message: init.error });
        return;
      }
      const parts = computeParts(opts.file.size, PART_SIZE);
      const completed: Array<{ partNumber: number; eTag: string }> = [];
      const startedAt = new Date().toISOString();
      const entry: ResumableEntry = {
        uploadId: init.data.uploadId,
        key: init.data.key,
        completionToken: init.data.completionToken,
        trackVersionId: opts.trackVersionId,
        completed,
        totalBytes: opts.file.size,
        createdAt: startedAt,
        lastProgressAt: startedAt,
      };
      // Persist the complete server-issued identity before signing or
      // uploading the first part so every later failure remains recoverable.
      persistResumableEntry(entry);
      setState({ kind: "uploading", progress: 0 });
      for (const p of parts) {
        const signed = await signAudioPart({
          key: init.data.key,
          uploadId: init.data.uploadId,
          partNumber: p.partNumber,
          trackVersionId: opts.trackVersionId,
        });
        if (!signed.ok) {
          await cancelResumableEntry(entry);
          setState({ kind: "error", message: signed.error });
          return;
        }
        const blob = opts.file.slice(p.start, p.end);
        let resp: Response;
        try {
          resp = await fetch(signed.data.url, { method: "PUT", body: blob });
        } catch (e) {
          await cancelResumableEntry(entry);
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : "Network error",
          });
          return;
        }
        if (!resp.ok) {
          await cancelResumableEntry(entry);
          setState({
            kind: "error",
            message: `Part ${String(p.partNumber)} failed (HTTP ${String(resp.status)})`,
          });
          return;
        }
        const eTag = (resp.headers.get("etag") ?? "").replace(/"/g, "");
        completed.push({ partNumber: p.partNumber, eTag });
        markResumableProgress(entry);
        setState({
          kind: "uploading",
          progress: Math.round((completed.length / parts.length) * 100),
        });
      }
      setState({ kind: "completing" });
      const done = await completeAudioUpload({
        key: init.data.key,
        uploadId: init.data.uploadId,
        parts: completed,
        trackVersionId: opts.trackVersionId,
        sizeBytes: opts.file.size,
        completionToken: init.data.completionToken,
      });
      if (!done.ok) {
        await cancelResumableEntry(entry);
        setState({ kind: "error", message: done.error });
        return;
      }
      removeResumableEntry(init.data.uploadId);
      setState({ kind: "done", url: done.data.url, key: done.data.key });
      opts.onComplete({ url: done.data.url, key: done.data.key });
    },
    [],
  );

  const cancel = useCallback(async (entry: ResumableEntry) => {
    return cancelResumableEntry(entry);
  }, []);

  return { state, upload, cancel };
}
