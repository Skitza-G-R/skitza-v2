"use client";

import { useSyncExternalStore } from "react";

export type ManagedUploadStatus =
  | "preparing"
  | "uploading"
  | "ready"
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
  terminalFeedback: "dock" | "toast";
  /**
   * Surfaces that render their own attached progress (e.g. the upload modal)
   * opt out of the floating dock card so one transfer never shows two bars.
   */
  showInDock: boolean;
  updatedAt: string;
};

export type UploadActionResult = { ok: boolean };
export type TerminalUploadDispose = () => Promise<UploadActionResult>;
type UploadActions = {
  cancel?: () => Promise<UploadActionResult>;
  retry?: () => Promise<void>;
  terminalDispose?: TerminalUploadDispose;
};

export const UPLOAD_SUCCESS_FEEDBACK_MS = 4000;
export const UPLOAD_ERROR_FEEDBACK_MS = 9000;

let activeAccountId: string | null = null;
let records: ManagedUploadRecord[] = [];
const EMPTY_UPLOADS: readonly ManagedUploadRecord[] = [];
let visibleRecords: readonly ManagedUploadRecord[] = EMPTY_UPLOADS;
const actions = new Map<string, UploadActions>();
type TerminalRemovalState = {
  status: "done" | "error";
  timer: ReturnType<typeof setTimeout> | null;
  expiresAtMs: number;
};
const terminalRemovalStates = new Map<string, TerminalRemovalState>();
let errorLifecycleDocument: Document | null = null;
let errorLifecycleWindow: Window | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  visibleRecords = activeAccountId
    ? records.filter((record) => record.accountId === activeAccountId)
    : EMPTY_UPLOADS;
  for (const listener of listeners) listener();
}

function browserDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

function browserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function detachErrorLifecycleListeners(): void {
  errorLifecycleDocument?.removeEventListener("visibilitychange", reconcileExpiredErrors);
  errorLifecycleWindow?.removeEventListener("focus", reconcileExpiredErrors);
  errorLifecycleDocument = null;
  errorLifecycleWindow = null;
}

function syncErrorLifecycleListeners(): void {
  const hasErrorState = Array.from(terminalRemovalStates.values()).some(
    (state) => state.status === "error",
  );
  const currentDocument = browserDocument();
  const currentWindow = browserWindow();
  if (!hasErrorState) {
    detachErrorLifecycleListeners();
    return;
  }
  if (errorLifecycleDocument !== currentDocument) {
    errorLifecycleDocument?.removeEventListener("visibilitychange", reconcileExpiredErrors);
    currentDocument?.addEventListener("visibilitychange", reconcileExpiredErrors);
    errorLifecycleDocument = currentDocument;
  }
  if (errorLifecycleWindow !== currentWindow) {
    errorLifecycleWindow?.removeEventListener("focus", reconcileExpiredErrors);
    currentWindow?.addEventListener("focus", reconcileExpiredErrors);
    errorLifecycleWindow = currentWindow;
  }
}

function reconcileExpiredErrors(): void {
  const now = Date.now();
  for (const [id, state] of Array.from(terminalRemovalStates.entries())) {
    if (state.status === "error" && now >= state.expiresAtMs) {
      removeTerminalRecord(id, "error");
    }
  }
}

function removeTerminalRecord(id: string, status: "done" | "error"): void {
  const current = records.find((candidate) => candidate.id === id);
  if (!current || current.status !== status) return;
  removeRecord(id);
}

function startErrorRemovalTimer(id: string, state: TerminalRemovalState): void {
  if (state.status !== "error" || state.timer !== null) return;
  const remainingMs = state.expiresAtMs - Date.now();
  if (remainingMs <= 0) {
    removeTerminalRecord(id, "error");
    return;
  }

  state.timer = setTimeout(() => {
    const currentState = terminalRemovalStates.get(id);
    if (currentState !== state || currentState.status !== "error") return;
    state.timer = null;
    removeTerminalRecord(id, "error");
  }, remainingMs);
}

function clearTerminalRemovalTimer(id: string): void {
  const state = terminalRemovalStates.get(id);
  if (state?.timer !== null && state?.timer !== undefined) clearTimeout(state.timer);
  terminalRemovalStates.delete(id);
  syncErrorLifecycleListeners();
}

function syncTerminalRemoval(record: ManagedUploadRecord): void {
  clearTerminalRemovalTimer(record.id);
  if (record.status !== "done" && record.status !== "error") return;

  if (record.status === "done") {
    const state: TerminalRemovalState = {
      status: "done",
      timer: null,
      expiresAtMs: Date.now() + UPLOAD_SUCCESS_FEEDBACK_MS,
    };
    state.timer = setTimeout(() => {
      const currentState = terminalRemovalStates.get(record.id);
      if (currentState !== state || currentState.status !== "done") return;
      state.timer = null;
      removeTerminalRecord(record.id, "done");
    }, UPLOAD_SUCCESS_FEEDBACK_MS);
    terminalRemovalStates.set(record.id, state);
    return;
  }

  const state: TerminalRemovalState = {
    status: "error",
    timer: null,
    expiresAtMs: Date.now() + UPLOAD_ERROR_FEEDBACK_MS,
  };
  terminalRemovalStates.set(record.id, state);
  startErrorRemovalTimer(record.id, state);
  syncErrorLifecycleListeners();
}

function updateRecord(
  id: string,
  update: (record: ManagedUploadRecord) => ManagedUploadRecord,
): void {
  let updatedRecord: ManagedUploadRecord | undefined;
  records = records.map((record) => {
    if (record.id !== id) return record;
    updatedRecord = { ...update(record), updatedAt: new Date().toISOString() };
    return updatedRecord;
  });
  if (updatedRecord) syncTerminalRemoval(updatedRecord);
  emit();
}

function takeTerminalDispose(id: string): TerminalUploadDispose | null {
  const current = actions.get(id);
  if (!current?.terminalDispose) return null;
  const { terminalDispose, ...remaining } = current;
  actions.set(id, remaining);
  return terminalDispose;
}

function invokeTerminalDispose(id: string): Promise<UploadActionResult> | null {
  const terminalDispose = takeTerminalDispose(id);
  if (!terminalDispose) return null;
  try {
    return terminalDispose().catch(() => ({ ok: false }));
  } catch {
    return Promise.resolve({ ok: false });
  }
}

function removeRecord(id: string, disposeTerminal = true): void {
  const record = records.find((candidate) => candidate.id === id);
  if (disposeTerminal && record && (record.status === "done" || record.status === "error")) {
    void invokeTerminalDispose(id);
  }
  clearTerminalRemovalTimer(id);
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
  setReadyToSave: () => void;
  setCompleting: () => void;
  setCancel: (cancel: () => Promise<UploadActionResult>) => void;
  setRetry: (retry: () => Promise<void>) => void;
  setTerminalDispose: (dispose: TerminalUploadDispose) => void;
  succeed: () => void;
  fail: (message: string) => void;
  dismiss: () => void;
};

export function beginManagedUpload(input: {
  fileName: string;
  label: string;
  terminalFeedback?: "dock" | "toast";
  showInDock?: boolean;
}): ManagedUploadHandle {
  const accountId = requireUploadRuntimeAccountId();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  for (const record of records) {
    if (record.accountId === accountId && (record.status === "done" || record.status === "error")) {
      void invokeTerminalDispose(record.id);
      actions.delete(record.id);
      clearTerminalRemovalTimer(record.id);
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
      terminalFeedback: input.terminalFeedback ?? "dock",
      showInDock: input.showInDock ?? true,
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
    setReadyToSave() {
      updateRecord(id, (record) => ({
        ...record,
        status: "ready",
        progress: 100,
        error: null,
      }));
    },
    setCompleting() {
      const current = actions.get(id);
      if (current) {
        actions.set(id, {
          ...(current.retry ? { retry: current.retry } : {}),
          ...(current.terminalDispose ? { terminalDispose: current.terminalDispose } : {}),
        });
      }
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
    setTerminalDispose(terminalDispose) {
      const record = records.find((candidate) => candidate.id === id);
      if (!record || record.status === "done") return;
      const current = actions.get(id) ?? {};
      actions.set(id, { ...current, terminalDispose });
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
    record.status === "ready" ||
    record.status === "completing" ||
    record.status === "cancelling"
  );
}

export function dismissManagedUpload(id: string): boolean {
  const record = records.find((candidate) => candidate.id === id);
  if (!record || record.accountId !== activeAccountId || managedUploadIsActive(record))
    return false;
  removeRecord(id);
  return true;
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
      removeRecord(id, false);
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
 * Gives terminal records one final disposal attempt before dropping their
 * File objects and callbacks at an account boundary. Durable multipart
 * identities remain in the account-scoped journal for authenticated recovery.
 */
export async function releaseManagedUploadsForAccount(accountId: string): Promise<void> {
  const terminalDisposals: Promise<UploadActionResult>[] = [];
  for (const record of records) {
    if (record.accountId === accountId) {
      if (record.status === "done" || record.status === "error") {
        const disposal = invokeTerminalDispose(record.id);
        if (disposal) terminalDisposals.push(disposal);
      }
      actions.delete(record.id);
      clearTerminalRemovalTimer(record.id);
    }
  }
  records = records.filter((record) => record.accountId !== accountId);
  emit();
  await Promise.all(terminalDisposals);
}
