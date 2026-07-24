"use client";

import { useCallback, useEffect, useState } from "react";

import {
  abortAudioUpload,
  completeAudioUpload,
  initAudioUpload,
  signAudioPart,
} from "~/app/(producer)/dashboard/audio-upload-actions";
import { deleteVersionAction } from "~/app/(producer)/dashboard/clients-projects/upload-actions";
import {
  beginManagedUpload,
  getUploadRuntimeAccountId,
  requireUploadRuntimeAccountId,
} from "~/lib/audio/upload-manager";

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
  accountId: string;
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
  accountId: string;
  trackVersionId: string;
  cleanupRequestedAt: string;
};

type RecoveryResult = Readonly<{ ok: boolean }>;
type ExactAbort = (input: ReturnType<typeof toExactAbortInput>) => Promise<RecoveryResult>;
type VersionCleanup = (input: { id: string }) => Promise<RecoveryResult>;

export type UploadCancellationRequest = { requested: boolean };

export function createUploadCancellationRequest(): UploadCancellationRequest {
  return { requested: false };
}

export function requestUploadCancellation(request: UploadCancellationRequest): void {
  request.requested = true;
}

export function uploadCancellationRequested(request: UploadCancellationRequest): boolean {
  return request.requested;
}

export function toExactAbortInput(entry: ResumableEntry) {
  return {
    key: entry.key,
    uploadId: entry.uploadId,
    trackVersionId: entry.trackVersionId,
    sizeBytes: entry.totalBytes,
    completionToken: entry.completionToken,
  };
}

function scopedUploadStorageKey(accountId: string, uploadId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(accountId)}:${uploadId}`;
}

export function persistResumableEntry(entry: ResumableEntry): void {
  localStorage.setItem(
    scopedUploadStorageKey(entry.accountId, entry.uploadId),
    JSON.stringify(entry),
  );
}

export function removeResumableEntry(
  uploadId: string,
  accountId = requireUploadRuntimeAccountId(),
): void {
  localStorage.removeItem(scopedUploadStorageKey(accountId, uploadId));
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
    removeResumableEntry(entry.uploadId, entry.accountId);
  }
  return result;
}

export async function cancelInitializedUploadIfRequested(
  request: UploadCancellationRequest,
  entry: ResumableEntry,
  abort: ExactAbort,
): Promise<RecoveryResult | null> {
  if (!uploadCancellationRequested(request)) return null;
  return requestExactMultipartCancellation(entry, abort);
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

function versionCleanupStorageKey(accountId: string, trackVersionId: string): string {
  return `${VERSION_CLEANUP_STORAGE_PREFIX}${encodeURIComponent(accountId)}:${trackVersionId}`;
}

export function markVersionCleanupRequested(
  trackVersionId: string,
  now = new Date(),
  accountId = requireUploadRuntimeAccountId(),
): PendingVersionCleanupEntry {
  if (!Number.isFinite(now.getTime())) throw new Error("Version cleanup time is invalid");
  const storageKey = versionCleanupStorageKey(accountId, trackVersionId);
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
  const entry = { accountId, trackVersionId, cleanupRequestedAt };
  localStorage.setItem(storageKey, JSON.stringify(entry));
  return entry;
}

export function removeVersionCleanupEntry(
  trackVersionId: string,
  accountId = requireUploadRuntimeAccountId(),
): void {
  localStorage.removeItem(versionCleanupStorageKey(accountId, trackVersionId));
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
  localStorage.setItem(
    versionCleanupStorageKey(entry.accountId, entry.trackVersionId),
    JSON.stringify(entry),
  );
  let result: RecoveryResult;
  try {
    result = await cleanup({ id: entry.trackVersionId });
  } catch {
    return { ok: false };
  }
  if (result.ok) removeVersionCleanupEntry(entry.trackVersionId, entry.accountId);
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
  const accountId = getUploadRuntimeAccountId();
  if (!accountId) return;
  recoveryRunning = true;
  try {
    await migrateLegacyUploadJournalForAccount(accountId);
    await runRecoverableUploadPass({
      entries: resumableUploads(accountId),
      now: new Date(),
      abort: abortAudioUpload,
      remove: (uploadId) => {
        removeResumableEntry(uploadId, accountId);
      },
    });
    const stillActiveVersionIds = new Set(
      resumableUploads(accountId).map((entry) => entry.trackVersionId),
    );
    await runRequestedVersionCleanupPass({
      entries: pendingVersionCleanups(accountId).filter(
        (entry) => !stillActiveVersionIds.has(entry.trackVersionId),
      ),
      now: new Date(),
      cleanup: deleteVersionAction,
      remove: (trackVersionId) => {
        removeVersionCleanupEntry(trackVersionId, accountId);
      },
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

// Enumerate exact multipart identities for cancellation/reconciliation.
// The browser journal never persists File bytes or a file handle, so it must
// not claim that an upload continues after iOS terminates the app. Malformed
// entries are silently skipped rather than blocking the whole read.
export function resumableUploads(accountId = getUploadRuntimeAccountId()): ResumableEntry[] {
  if (!accountId) return [];
  if (typeof localStorage === "undefined") return [];
  const out: ResumableEntry[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(`${STORAGE_PREFIX}${encodeURIComponent(accountId)}:`)) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      const entry = JSON.parse(raw) as unknown;
      if (!isResumableEntry(entry, accountId, k)) continue;
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

function isResumableEntry(
  value: unknown,
  accountId: string,
  storageKey: string,
): value is ResumableEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (
    accountId.length === 0 ||
    entry.accountId !== accountId ||
    typeof entry.uploadId !== "string" ||
    entry.uploadId.length === 0 ||
    storageKey !== scopedUploadStorageKey(accountId, entry.uploadId) ||
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

function pendingVersionCleanups(
  accountId = getUploadRuntimeAccountId(),
): PendingVersionCleanupEntry[] {
  if (!accountId) return [];
  if (typeof localStorage === "undefined") return [];
  const out: PendingVersionCleanupEntry[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(`${VERSION_CLEANUP_STORAGE_PREFIX}${encodeURIComponent(accountId)}:`)) {
      continue;
    }
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const entry = JSON.parse(raw) as PendingVersionCleanupEntry;
      if (
        entry.accountId === accountId &&
        isUuid(entry.trackVersionId) &&
        key === versionCleanupStorageKey(accountId, entry.trackVersionId) &&
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

type LegacyResumableEntry = Omit<ResumableEntry, "accountId">;
type LegacyVersionCleanupEntry = Omit<PendingVersionCleanupEntry, "accountId">;

type LegacyJournalScan = {
  uploads: Array<{ storageKey: string; entry: LegacyResumableEntry }>;
  versionCleanups: Array<{
    storageKey: string;
    entry: LegacyVersionCleanupEntry;
  }>;
  malformedKeys: string[];
  blockingUploadVersionIds: Set<string>;
};

function localStorageKeySnapshot(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key): key is string => key !== null);
  } catch {
    return [];
  }
}

function validCompletedParts(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((part) => {
      if (typeof part !== "object" || part === null) return false;
      const candidate = part as Record<string, unknown>;
      return (
        typeof candidate.partNumber === "number" &&
        Number.isSafeInteger(candidate.partNumber) &&
        candidate.partNumber > 0 &&
        typeof candidate.eTag === "string"
      );
    })
  );
}

function isLegacyResumableEntry(value: unknown, storageKey: string): value is LegacyResumableEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.accountId === undefined &&
    typeof entry.uploadId === "string" &&
    entry.uploadId.length > 0 &&
    storageKey === `${STORAGE_PREFIX}${entry.uploadId}` &&
    typeof entry.key === "string" &&
    entry.key.length > 0 &&
    isUuid(entry.trackVersionId) &&
    typeof entry.completionToken === "string" &&
    /^[0-9a-f]{64}$/.test(entry.completionToken) &&
    typeof entry.totalBytes === "number" &&
    Number.isSafeInteger(entry.totalBytes) &&
    entry.totalBytes > 0 &&
    validCompletedParts(entry.completed) &&
    isIsoTimestamp(entry.createdAt) &&
    isIsoTimestamp(entry.lastProgressAt) &&
    new Date(entry.createdAt).getTime() <= new Date(entry.lastProgressAt).getTime() &&
    (entry.cancellationRequestedAt === undefined || isIsoTimestamp(entry.cancellationRequestedAt))
  );
}

function isLegacyVersionCleanupEntry(
  value: unknown,
  storageKey: string,
): value is LegacyVersionCleanupEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.accountId === undefined &&
    isUuid(entry.trackVersionId) &&
    storageKey === `${VERSION_CLEANUP_STORAGE_PREFIX}${entry.trackVersionId}` &&
    isIsoTimestamp(entry.cleanupRequestedAt)
  );
}

function scanLegacyUploadJournal(): LegacyJournalScan {
  const scan: LegacyJournalScan = {
    uploads: [],
    versionCleanups: [],
    malformedKeys: [],
    blockingUploadVersionIds: new Set(),
  };
  for (const storageKey of localStorageKeySnapshot()) {
    const isUpload = storageKey.startsWith(STORAGE_PREFIX);
    const isVersionCleanup = storageKey.startsWith(VERSION_CLEANUP_STORAGE_PREFIX);
    if (!isUpload && !isVersionCleanup) continue;
    let parsed: unknown;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        scan.malformedKeys.push(storageKey);
        continue;
      }
      parsed = JSON.parse(raw) as unknown;
    } catch {
      scan.malformedKeys.push(storageKey);
      continue;
    }

    if (typeof parsed === "object" && parsed !== null) {
      const parsedAccountId = (parsed as Record<string, unknown>).accountId;
      if (typeof parsedAccountId === "string") {
        const validScopedUpload =
          parsedAccountId.length > 0 &&
          isUpload &&
          isResumableEntry(parsed, parsedAccountId, storageKey);
        const scopedCleanup = parsed as Partial<PendingVersionCleanupEntry>;
        const validScopedVersionCleanup =
          parsedAccountId.length > 0 &&
          isVersionCleanup &&
          scopedCleanup.accountId === parsedAccountId &&
          isUuid(scopedCleanup.trackVersionId) &&
          storageKey === versionCleanupStorageKey(parsedAccountId, scopedCleanup.trackVersionId) &&
          isIsoTimestamp(scopedCleanup.cleanupRequestedAt);
        if (!validScopedUpload && !validScopedVersionCleanup) {
          scan.malformedKeys.push(storageKey);
        }
        const scopedUploadVersionId = (parsed as Record<string, unknown>).trackVersionId;
        if (isUpload && isUuid(scopedUploadVersionId)) {
          // Scoped uploads are never adopted by legacy migration. Even a
          // malformed scoped sibling blocks version deletion because its
          // exact multipart identity could not be safely aborted.
          scan.blockingUploadVersionIds.add(scopedUploadVersionId);
        }
        // Valid scoped journals remain isolated to their explicit owner and
        // keep their normal retry semantics. Invalid scoped payloads cannot
        // be recovered and are purged so embedded secrets do not linger.
        continue;
      }
    }
    if (isUpload && isLegacyResumableEntry(parsed, storageKey)) {
      scan.uploads.push({ storageKey, entry: parsed });
    } else if (isVersionCleanup && isLegacyVersionCleanupEntry(parsed, storageKey)) {
      scan.versionCleanups.push({ storageKey, entry: parsed });
    } else {
      if (
        isUpload &&
        typeof parsed === "object" &&
        parsed !== null &&
        isUuid((parsed as Record<string, unknown>).trackVersionId)
      ) {
        scan.blockingUploadVersionIds.add(
          (parsed as { trackVersionId: string }).trackVersionId,
        );
      }
      scan.malformedKeys.push(storageKey);
    }
  }
  return scan;
}

function removeLegacyStorageKey(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Best effort: storage may be unavailable during browser teardown.
  }
}

/**
 * Pre-SK-110 journals had no account owner and persisted R2 keys and
 * completion tokens. The first authenticated recovery gets one fail-closed
 * server attempt using the current session, then purges every ownerless local
 * record. A false/unauthorized/transient result is never adopted into the
 * current account because doing so could expose another account's secret.
 */
export async function migrateLegacyUploadJournalForAccount(
  accountId: string,
  dependencies: Readonly<{
    abort?: ExactAbort;
    cleanup?: VersionCleanup;
  }> = {},
): Promise<{
  attemptedUploads: number;
  attemptedVersionCleanups: number;
  removedLocalEntries: number;
}> {
  const abort = dependencies.abort ?? abortAudioUpload;
  const cleanup = dependencies.cleanup ?? deleteVersionAction;
  const scan = scanLegacyUploadJournal();
  let removedLocalEntries = 0;
  for (const storageKey of scan.malformedKeys) {
    removeLegacyStorageKey(storageKey);
    removedLocalEntries += 1;
  }

  const uploadVersionIds = new Set(scan.uploads.map(({ entry }) => entry.trackVersionId));
  const everyLegacyUploadSafelyAborted = new Map<string, boolean>(
    [...uploadVersionIds].map((versionId) => [versionId, true]),
  );
  for (const { storageKey, entry } of scan.uploads) {
    try {
      const result = await abort(
        toExactAbortInput({
          ...entry,
          accountId,
        }),
      );
      if (!result.ok) {
        everyLegacyUploadSafelyAborted.set(entry.trackVersionId, false);
      }
    } catch {
      everyLegacyUploadSafelyAborted.set(entry.trackVersionId, false);
      // Treat errors as unauthorized/transient and still purge the unowned
      // local secret rather than assigning it to the current account.
    } finally {
      removeLegacyStorageKey(storageKey);
      removedLocalEntries += 1;
    }
  }

  let attemptedVersionCleanups = 0;
  for (const { storageKey, entry } of scan.versionCleanups) {
    const safeToDeleteVersion =
      !scan.blockingUploadVersionIds.has(entry.trackVersionId) &&
      (!uploadVersionIds.has(entry.trackVersionId) ||
        everyLegacyUploadSafelyAborted.get(entry.trackVersionId) === true);
    if (safeToDeleteVersion) {
      attemptedVersionCleanups += 1;
      try {
        await cleanup({ id: entry.trackVersionId });
      } catch {
        // The local legacy record is purged even when current auth rejects it.
      }
    }
    removeLegacyStorageKey(storageKey);
    removedLocalEntries += 1;
  }

  return {
    attemptedUploads: scan.uploads.length,
    attemptedVersionCleanups,
    removedLocalEntries,
  };
}

export async function cancelPersistedUploadsForAccount(accountId: string): Promise<boolean> {
  await migrateLegacyUploadJournalForAccount(accountId);
  let allCancelled = true;
  for (const entry of resumableUploads(accountId)) {
    const result = await requestExactMultipartCancellation(entry, abortAudioUpload);
    if (!result.ok) allCancelled = false;
  }
  if (!allCancelled) return false;

  const activeVersionIds = new Set(
    resumableUploads(accountId).map((entry) => entry.trackVersionId),
  );
  for (const entry of pendingVersionCleanups(accountId)) {
    if (activeVersionIds.has(entry.trackVersionId)) continue;
    const result = await requestVersionCleanup(entry, deleteVersionAction);
    if (!result.ok) allCancelled = false;
  }
  return allCancelled;
}

export function useMultipartUpload() {
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  useEffect(() => startMultipartCancellationRecovery(), []);

  const upload = useCallback(async function runUpload(opts: {
    file: File;
    trackVersionId: string;
    onComplete: (r: { url: string; key: string }) => void;
  }) {
    const accountId = requireUploadRuntimeAccountId();
    const managed = beginManagedUpload({
      fileName: opts.file.name,
      label: "Audio upload",
    });
    const abortController = new AbortController();
    let entry: ResumableEntry | null = null;
    const cancellation = createUploadCancellationRequest();
    let settleInitialization: (value: ResumableEntry | null) => void = () => {};
    const initialized = new Promise<ResumableEntry | null>((resolve) => {
      settleInitialization = resolve;
    });
    managed.setCancel(async () => {
      requestUploadCancellation(cancellation);
      abortController.abort();
      const initializedEntry = entry ?? (await initialized);
      return initializedEntry ? cancelResumableEntry(initializedEntry) : { ok: true };
    });
    managed.setRetry(async () => {
      managed.dismiss();
      await runUpload(opts);
    });
    setState({ kind: "signing" });
    managed.setPreparing();
    let init: Awaited<ReturnType<typeof initAudioUpload>>;
    try {
      init = await initAudioUpload({
        trackVersionId: opts.trackVersionId,
        filename: opts.file.name,
        sizeBytes: opts.file.size,
        contentType: opts.file.type || "application/octet-stream",
      });
    } catch (error) {
      settleInitialization(null);
      const message = error instanceof Error ? error.message : "Couldn’t prepare the upload.";
      setState({ kind: "error", message });
      managed.fail(message);
      return;
    }
    if (!init.ok) {
      settleInitialization(null);
      setState({ kind: "error", message: init.error });
      managed.fail(init.error);
      return;
    }
    const parts = computeParts(opts.file.size, PART_SIZE);
    const completed: Array<{ partNumber: number; eTag: string }> = [];
    const startedAt = new Date().toISOString();
    entry = {
      accountId,
      uploadId: init.data.uploadId,
      key: init.data.key,
      completionToken: init.data.completionToken,
      trackVersionId: opts.trackVersionId,
      completed,
      totalBytes: opts.file.size,
      createdAt: startedAt,
      lastProgressAt: startedAt,
    };
    settleInitialization(entry);
    // Persist the complete server-issued identity before signing or
    // uploading the first part so every later failure remains recoverable.
    persistResumableEntry(entry);
    if (uploadCancellationRequested(cancellation)) {
      const cancelled = await cancelResumableEntry(entry);
      if (!cancelled.ok) {
        managed.fail("Couldn’t stop this upload yet. Skitza kept its recovery record.");
      }
      return;
    }
    setState({ kind: "uploading", progress: 0 });
    managed.setUploading(0);
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
        managed.fail(signed.error);
        return;
      }
      const blob = opts.file.slice(p.start, p.end);
      let resp: Response;
      try {
        resp = await fetch(signed.data.url, {
          method: "PUT",
          body: blob,
          signal: abortController.signal,
        });
      } catch (e) {
        await cancelResumableEntry(entry);
        const message = e instanceof Error ? e.message : "Network error";
        setState({
          kind: "error",
          message,
        });
        managed.fail(message);
        return;
      }
      if (!resp.ok) {
        await cancelResumableEntry(entry);
        setState({
          kind: "error",
          message: `Part ${String(p.partNumber)} failed (HTTP ${String(resp.status)})`,
        });
        managed.fail(`Part ${String(p.partNumber)} failed (HTTP ${String(resp.status)})`);
        return;
      }
      const eTag = (resp.headers.get("etag") ?? "").replace(/"/g, "");
      completed.push({ partNumber: p.partNumber, eTag });
      markResumableProgress(entry);
      const progress = Math.round((completed.length / parts.length) * 100);
      setState({
        kind: "uploading",
        progress,
      });
      managed.setUploading(progress);
    }
    setState({ kind: "completing" });
    managed.setCompleting();
    const done = await completeAudioUpload({
      key: init.data.key,
      uploadId: init.data.uploadId,
      parts: completed,
      trackVersionId: opts.trackVersionId,
      sizeBytes: opts.file.size,
      completionToken: init.data.completionToken,
      acknowledgePublicExposure: false,
    });
    if (!done.ok) {
      await cancelResumableEntry(entry);
      setState({ kind: "error", message: done.error });
      managed.fail(done.error);
      return;
    }
    removeResumableEntry(init.data.uploadId, accountId);
    setState({ kind: "done", url: done.data.url, key: done.data.key });
    managed.succeed();
    opts.onComplete({ url: done.data.url, key: done.data.key });
  }, []);

  const cancel = useCallback(async (entry: ResumableEntry) => {
    return cancelResumableEntry(entry);
  }, []);

  return { state, upload, cancel };
}
