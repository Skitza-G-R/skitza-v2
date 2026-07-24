"use client";

import { useSyncExternalStore } from "react";

export type ManagedUploadStatus =
  | "preparing"
  | "uploading"
  | "completing"
  | "cancelling"
  | "error"
  | "done";

export type ManagedUploadRecord = {
  id: string;
  accountId: string;
  fileName: string;
  label: string;
  progress: number;
  status: ManagedUploadStatus;
  error: string | null;
  canRetry: boolean;
  canCancel: boolean;
  updatedAt: string;
};

type UploadActionResult = { ok: boolean };
type UploadActions = {
  cancel?: () => Promise<UploadActionResult>;
  retry?: () => Promise<void>;
};

let activeAccountId: string | null = null;
let records: ManagedUploadRecord[] = [];
const EMPTY_UPLOADS: readonly ManagedUploadRecord[] = [];
let visibleRecords: readonly ManagedUploadRecord[] = EMPTY_UPLOADS;
const actions = new Map<string, UploadActions>();
const listeners = new Set<() => void>();

function emit(): void {
  visibleRecords = activeAccountId
    ? records.filter((record) => record.accountId === activeAccountId)
    : EMPTY_UPLOADS;
  for (const listener of listeners) listener();
}

function updateRecord(
  id: string,
  update: (record: ManagedUploadRecord) => ManagedUploadRecord,
): void {
  records = records.map((record) =>
    record.id === id ? { ...update(record), updatedAt: new Date().toISOString() } : record,
  );
  emit();
}

function removeRecord(id: string): void {
  records = records.filter((record) => record.id !== id);
  actions.delete(id);
  emit();
}

export function setUploadRuntimeAccountId(accountId: string | null): void {
  activeAccountId = accountId;
  emit();
}

export function getUploadRuntimeAccountId(): string | null {
  return activeAccountId;
}

export function requireUploadRuntimeAccountId(): string {
  if (!activeAccountId) {
    throw new Error("Upload manager is unavailable without a signed-in account.");
  }
  return activeAccountId;
}

export function subscribeManagedUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function managedUploadsSnapshot(): readonly ManagedUploadRecord[] {
  return visibleRecords;
}

export function useManagedUploads(): readonly ManagedUploadRecord[] {
  return useSyncExternalStore(subscribeManagedUploads, managedUploadsSnapshot, () => EMPTY_UPLOADS);
}

export type ManagedUploadHandle = {
  id: string;
  setPreparing: () => void;
  setUploading: (progress: number) => void;
  setCompleting: () => void;
  setCancel: (cancel: () => Promise<UploadActionResult>) => void;
  setRetry: (retry: () => Promise<void>) => void;
  succeed: () => void;
  fail: (message: string) => void;
  dismiss: () => void;
};

export function beginManagedUpload(input: {
  fileName: string;
  label: string;
}): ManagedUploadHandle {
  const accountId = requireUploadRuntimeAccountId();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  for (const record of records) {
    if (record.accountId === accountId && (record.status === "done" || record.status === "error")) {
      actions.delete(record.id);
    }
  }
  records = [
    ...records.filter(
      (record) =>
        record.accountId !== accountId || (record.status !== "done" && record.status !== "error"),
    ),
    {
      id,
      accountId,
      fileName: input.fileName,
      label: input.label,
      progress: 0,
      status: "preparing",
      error: null,
      canRetry: false,
      canCancel: false,
      updatedAt: now,
    },
  ];
  actions.set(id, {});
  emit();

  return {
    id,
    setPreparing() {
      updateRecord(id, (record) => ({
        ...record,
        status: "preparing",
        progress: 0,
        error: null,
      }));
    },
    setUploading(progress) {
      updateRecord(id, (record) => ({
        ...record,
        status: "uploading",
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        error: null,
      }));
    },
    setCompleting() {
      const current = actions.get(id);
      if (current) actions.set(id, current.retry ? { retry: current.retry } : {});
      updateRecord(id, (record) => ({
        ...record,
        status: "completing",
        progress: 100,
        error: null,
        canCancel: false,
      }));
    },
    setCancel(cancel) {
      const current = actions.get(id) ?? {};
      actions.set(id, { ...current, cancel });
      updateRecord(id, (record) => ({ ...record, canCancel: true }));
    },
    setRetry(retry) {
      const current = actions.get(id) ?? {};
      actions.set(id, { ...current, retry });
      updateRecord(id, (record) => ({ ...record, canRetry: true }));
    },
    succeed() {
      actions.delete(id);
      updateRecord(id, (record) => ({
        ...record,
        status: "done",
        progress: 100,
        error: null,
        canCancel: false,
        canRetry: false,
      }));
    },
    fail(message) {
      updateRecord(id, (record) => ({
        ...record,
        status: "error",
        error: message,
        canCancel: false,
      }));
    },
    dismiss() {
      removeRecord(id);
    },
  };
}

export function managedUploadIsActive(record: ManagedUploadRecord): boolean {
  return (
    record.status === "preparing" ||
    record.status === "uploading" ||
    record.status === "completing" ||
    record.status === "cancelling"
  );
}

export function hasActiveManagedUploads(accountId = activeAccountId): boolean {
  return (
    accountId !== null &&
    records.some((record) => record.accountId === accountId && managedUploadIsActive(record))
  );
}

export async function retryManagedUpload(id: string): Promise<boolean> {
  const record = records.find((candidate) => candidate.id === id);
  const retry = actions.get(id)?.retry;
  if (!record || record.accountId !== activeAccountId || !retry) return false;
  updateRecord(id, (current) => ({
    ...current,
    status: "preparing",
    progress: 0,
    error: null,
    canCancel: false,
  }));
  try {
    await retry();
    return true;
  } catch (error) {
    updateRecord(id, (current) => ({
      ...current,
      status: "error",
      error: error instanceof Error ? error.message : "Upload retry failed.",
    }));
    return false;
  }
}

async function cancelManagedUploadForAccount(id: string, accountId: string): Promise<boolean> {
  const record = records.find((candidate) => candidate.id === id);
  const cancel = actions.get(id)?.cancel;
  if (!record || record.accountId !== accountId || !record.canCancel || !cancel) return false;
  updateRecord(id, (current) => ({
    ...current,
    status: "cancelling",
    canCancel: false,
  }));
  try {
    const result = await cancel();
    if (result.ok) {
      removeRecord(id);
      return true;
    }
  } catch {
    // The durable journal remains the recovery authority.
  }
  updateRecord(id, (current) => ({
    ...current,
    status: "error",
    error: "Couldn’t stop this upload yet. Skitza kept its recovery record.",
    canCancel: false,
  }));
  return false;
}

export async function cancelManagedUpload(id: string): Promise<boolean> {
  if (!activeAccountId) return false;
  return cancelManagedUploadForAccount(id, activeAccountId);
}

export async function cancelManagedUploadsForAccount(accountId: string): Promise<boolean> {
  const ids = records
    .filter((record) => record.accountId === accountId && managedUploadIsActive(record))
    .map((record) => record.id);
  const results = await Promise.all(ids.map((id) => cancelManagedUploadForAccount(id, accountId)));
  return results.every(Boolean);
}

/**
 * Drops File objects and callbacks at an account boundary. Durable multipart
 * identities are deliberately not touched here: failed cancellation must
 * remain in that account's scoped journal for later authenticated recovery.
 */
export function releaseManagedUploadsForAccount(accountId: string): void {
  for (const record of records) {
    if (record.accountId === accountId) actions.delete(record.id);
  }
  records = records.filter((record) => record.accountId !== accountId);
  emit();
}
