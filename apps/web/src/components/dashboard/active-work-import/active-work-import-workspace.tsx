"use client";

import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  createImportBatchAction,
  deleteImportRowAction,
  finishImportSetupAction,
  loadImportBatchRowsAction,
  loadImportSetupOptionsAction,
  materializeImportRowsAction,
  prepareImportAgreementPdfAction,
  prepareImportProofAction,
  restoreImportClientAction,
  saveImportRowAction,
  type ImportActionResult,
} from "~/app/(producer)/dashboard/clients-projects/bring-active-work/actions";

import {
  ImportRowEditor,
  type ImportEditorStep,
  type ImportEditorMemory,
} from "./import-row-editor";
import { ImportRowList } from "./import-row-list";
import {
  isRowReady,
  materializeErrorMessage,
  newImportDraft,
  parseStoredImportDraft,
  rowDisplayReasons,
  toServerDraftPayload,
  type ActiveWorkImportDraft,
  type ArchivedClientOption,
  type ExistingClientOption,
  type FinishSetupResultView,
  type ImportTaxMode,
  type ImportReasonView,
  type InitialImportBatch,
  type SetupOptionsView,
  type StoreTemplateOption,
  type WorkspaceImportRow,
} from "./model";
import type { ProofUploadView } from "./payment-history-editor";
import { agreementPdfFileError } from "~/lib/agreement-pdf";
import { useBodyScrollLock } from "~/components/native/use-body-scroll-lock";
import { ReviewAndFinish } from "./review-and-finish";

type RowUpdater = (rows: WorkspaceImportRow[]) => WorkspaceImportRow[];

function randomOperationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

const UNREACHABLE_ERROR = "Could not reach Skitza. Check your connection and try again.";

// Server actions reject when the request never reaches Skitza (offline, timeout,
// deploy in progress). Every caller reads a plain result instead, so no row or
// button is ever left busy by an unhandled rejection.
async function callAction<T>(
  request: () => Promise<ImportActionResult<T>>,
): Promise<ImportActionResult<T>> {
  try {
    return await request();
  } catch (error) {
    console.error("[active-work-import] action did not answer", error);
    return { ok: false, error: UNREACHABLE_ERROR, code: "UNREACHABLE" };
  }
}

type ImportProofContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "application/pdf";

function importProofContentType(file: File): ImportProofContentType | null {
  if (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    file.type === "image/heic" ||
    file.type === "application/pdf"
  ) {
    return file.type;
  }
  return file.name.toLowerCase().endsWith(".heic") ? "image/heic" : null;
}

/** Why this import is still open after everything else succeeded. */
function unfinishedImportMessage(unfinishedDraftCount: number | null): string {
  const created = "Your created work, invitations and reminders are all safe.";
  if (unfinishedDraftCount === null || unfinishedDraftCount < 1) {
    return `This import is not finished yet, so it will still be here next time. ${created} Check the items above, then press Finish setup again.`;
  }
  const items =
    unfinishedDraftCount === 1
      ? "1 item is still saved as a draft and was never created"
      : `${String(unfinishedDraftCount)} items are still saved as drafts and were never created`;
  return `This import is not finished: ${items}, so it will still be here next time. ${created} Go back, finish or remove ${unfinishedDraftCount === 1 ? "that item" : "those items"}, then press Finish setup again.`;
}

function setupShowsPriorAttempt(options: SetupOptionsView | null): boolean {
  if (!options) return false;
  return (
    options.clients.some((client) => client.invitationState !== "available") ||
    options.installments.some((installment) => installment.remindersEnabled)
  );
}

export function ActiveWorkImportWorkspace({
  initialBatch,
  initialNotice = null,
  initialSetupOptions,
  existingClients,
  archivedClients,
  templates,
  defaultCurrency,
  defaultTaxMode,
  defaultTaxRatePct,
}: {
  initialBatch: InitialImportBatch | null;
  initialNotice?: string | null;
  initialSetupOptions: SetupOptionsView | null;
  existingClients: readonly ExistingClientOption[];
  archivedClients: readonly ArchivedClientOption[];
  templates: readonly StoreTemplateOption[];
  defaultCurrency: string;
  defaultTaxMode: ImportTaxMode;
  defaultTaxRatePct: number;
}) {
  const router = useRouter();
  const defaults = useMemo(
    () => ({ defaultCurrency, defaultTaxMode, defaultTaxRatePct }),
    [defaultCurrency, defaultTaxMode, defaultTaxRatePct],
  );
  const initialRows = useMemo<WorkspaceImportRow[]>(
    () =>
      initialBatch?.rows.map(({ row, assessment }) => ({
        rowId: row.id,
        operationKey: row.operationKey,
        revision: row.draftRevision,
        draft: parseStoredImportDraft(row.draftPayload, defaults),
        assessment,
        materializedAtIso: row.materializedAtIso,
        createdClientContactId: row.createdClientContactId,
        createdProjectId: row.createdProjectId,
        createdPurchaseId: row.createdPurchaseId,
        saveState: "idle",
        saveError: null,
        materializeError: materializeErrorMessage(row.lastErrorCode),
        localVersion: 0,
        persistedLocalVersion: 0,
      })) ?? [],
    [defaults, initialBatch],
  );
  const [batchId, setBatchId] = useState(initialBatch?.id ?? null);
  const [rows, setRows] = useState<WorkspaceImportRow[]>(initialRows);
  const [activeClientOptions, setActiveClientOptions] = useState<ExistingClientOption[]>([
    ...existingClients,
  ]);
  const [archivedClientOptions, setArchivedClientOptions] = useState<ArchivedClientOption[]>([
    ...archivedClients,
  ]);
  const [selectedOperationKey, setSelectedOperationKey] = useState<string | null>(
    initialRows[0]?.operationKey ?? null,
  );
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [restoringClientId, setRestoringClientId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewStage, setReviewStage] = useState<"review" | "setup">("review");
  const [openingReview, setOpeningReview] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [setupOptions, setSetupOptions] = useState<SetupOptionsView | null>(initialSetupOptions);
  const [setupAttempted, setSetupAttempted] = useState(() =>
    setupShowsPriorAttempt(initialSetupOptions),
  );
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [finishResult, setFinishResult] = useState<FinishSetupResultView | null>(null);
  const [proofUploads, setProofUploads] = useState<Record<string, ProofUploadView>>({});
  // Keyed by row operation key: one agreement PDF per item.
  const [agreementPdfUploads, setAgreementPdfUploads] = useState<Record<string, ProofUploadView>>(
    {},
  );

  const rowsRef = useRef(rows);
  const editorMemoryRef = useRef(new Map<string, ImportEditorMemory>());
  const batchIdRef = useRef(batchId);
  const savePromises = useRef(new Map<string, Promise<boolean>>());
  const batchOperationKeyRef = useRef<string | null>(null);
  const batchPromiseRef = useRef<Promise<string | null> | null>(null);
  const addPromiseRef = useRef<Promise<void> | null>(null);
  const proofPromisesRef = useRef(new Map<string, Promise<boolean>>());
  const agreementPdfPromisesRef = useRef(new Map<string, Promise<boolean>>());
  const finishOperationKeyRef = useRef<string | null>(null);
  const mobileEditorTriggerRef = useRef<HTMLButtonElement | null>(null);

  function updateRows(updater: RowUpdater) {
    const next = updater(rowsRef.current);
    rowsRef.current = next;
    setRows(next);
  }

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const sync = () => {
      setIsMobile(query.matches);
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
    };
  }, []);

  // After a stale ?batch= fell back to the latest setup, keep the address in
  // step with what is actually shown so a reload does not repeat the fallback.
  useEffect(() => {
    if (!initialBatch) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("batch") === initialBatch.id) return;
    url.searchParams.set("batch", initialBatch.id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [initialBatch]);

  useEffect(() => {
    if (mobileEditorOpen) return;
    const trigger = mobileEditorTriggerRef.current;
    mobileEditorTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, [mobileEditorOpen]);

  const hasUnsavedWork =
    starting ||
    adding ||
    Object.values(proofUploads).some((upload) => upload.status === "uploading") ||
    Object.values(agreementPdfUploads).some((upload) => upload.status === "uploading") ||
    rows.some(
      (row) =>
        !row.materializedAtIso &&
        (row.saveState === "saving" ||
          row.rowId === null ||
          row.persistedLocalVersion < row.localVersion),
    );

  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [hasUnsavedWork]);

  function setBatch(next: string) {
    batchIdRef.current = next;
    setBatchId(next);
    const url = new URL(window.location.href);
    url.searchParams.set("batch", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  async function ensureBatch(): Promise<string | null> {
    if (batchIdRef.current) return batchIdRef.current;
    if (batchPromiseRef.current) return batchPromiseRef.current;

    const operationKey =
      batchOperationKeyRef.current ?? randomOperationKey("active-work-import-batch");
    batchOperationKeyRef.current = operationKey;
    const request = (async () => {
      setStarting(true);
      setPageError(null);
      try {
        const result = await callAction(() => createImportBatchAction({ operationKey }));
        if (!result.ok) {
          setPageError(result.error);
          return null;
        }
        setBatch(result.data.batchId);
        return result.data.batchId;
      } finally {
        setStarting(false);
      }
    })();
    batchPromiseRef.current = request;
    try {
      return await request;
    } finally {
      if (batchPromiseRef.current === request) batchPromiseRef.current = null;
    }
  }

  function addRow(): Promise<void> {
    if (addPromiseRef.current) return addPromiseRef.current;
    if (
      initialBatch?.status === "completed" ||
      (rowsRef.current.length > 0 && rowsRef.current.every((row) => row.materializedAtIso !== null))
    ) {
      return Promise.resolve();
    }
    const request = (async () => {
      setAdding(true);
      try {
        const availableBatchId = await ensureBatch();
        if (!availableBatchId) return;
        const operationKey = randomOperationKey("active-work-import-row");
        const row: WorkspaceImportRow = {
          rowId: null,
          operationKey,
          revision: null,
          draft: newImportDraft(defaults),
          assessment: null,
          materializedAtIso: null,
          createdClientContactId: null,
          createdProjectId: null,
          createdPurchaseId: null,
          saveState: "saving",
          saveError: null,
          materializeError: null,
          localVersion: 0,
          persistedLocalVersion: -1,
        };
        updateRows((current) => [...current, row]);
        setSelectedOperationKey(operationKey);
        setMobileEditorOpen(true);
        await persistRow(operationKey);
      } finally {
        setAdding(false);
      }
    })();
    addPromiseRef.current = request;
    void request.then(
      () => {
        if (addPromiseRef.current === request) addPromiseRef.current = null;
      },
      () => {
        if (addPromiseRef.current === request) addPromiseRef.current = null;
      },
    );
    return request;
  }

  async function persistRow(operationKey: string): Promise<boolean> {
    const activeRequest = savePromises.current.get(operationKey);
    if (activeRequest) return activeRequest;

    const request = (async (): Promise<boolean> => {
      let recoveredConflict = false;
      for (;;) {
        const activeBatchId = batchIdRef.current;
        const current = rowsRef.current.find((row) => row.operationKey === operationKey);
        if (!current || current.materializedAtIso) return true;
        if (!activeBatchId) return false;

        const savedVersion = current.localVersion;
        updateRows((all) =>
          all.map((row) =>
            row.operationKey === operationKey
              ? { ...row, assessment: null, saveState: "saving", saveError: null }
              : row,
          ),
        );
        const result = await callAction(() =>
          saveImportRowAction({
            batchId: activeBatchId,
            rowOperationKey: current.operationKey,
            expectedRevision: current.revision,
            draftPayload: toServerDraftPayload(current.draft),
          }),
        );

        if (!result.ok) {
          // A CONFLICT here almost always means an earlier save reached Skitza
          // but its answer was lost, so our expectedRevision (or null for a
          // first save) is stale. Adopt the server's revision and retry once
          // with the local edits; a conflict that persists is surfaced as-is.
          if (result.code === "CONFLICT" && !recoveredConflict) {
            recoveredConflict = true;
            const adopted = await adoptServerRevision(activeBatchId, operationKey);
            if (adopted) continue;
          }
          const latest = rowsRef.current.find((row) => row.operationKey === operationKey);
          const newerDraftExists = Boolean(latest && latest.localVersion !== savedVersion);
          updateRows((all) =>
            all.map((row) =>
              row.operationKey === operationKey
                ? {
                    ...row,
                    assessment: null,
                    saveState: newerDraftExists ? "saving" : "error",
                    saveError: newerDraftExists ? null : result.error,
                  }
                : row,
            ),
          );
          if (newerDraftExists) continue;
          return false;
        }

        updateRows((all) =>
          all.map((row) => {
            if (row.operationKey !== operationKey) return row;
            const responseIsCurrent = row.localVersion === savedVersion;
            return {
              ...row,
              rowId: result.data.row.id,
              revision: result.data.row.draftRevision,
              persistedLocalVersion: Math.max(row.persistedLocalVersion, savedVersion),
              assessment: responseIsCurrent ? result.data.assessment : null,
              saveState: responseIsCurrent
                ? result.data.assessmentError
                  ? "unchecked"
                  : "saved"
                : "saving",
              saveError: responseIsCurrent ? result.data.assessmentError : null,
            };
          }),
        );

        recoveredConflict = false;
        const latest = rowsRef.current.find((row) => row.operationKey === operationKey);
        if (latest && latest.localVersion !== savedVersion) continue;
        if (!result.data.assessmentError) {
          window.setTimeout(() => {
            updateRows((all) =>
              all.map((row) =>
                row.operationKey === operationKey && row.saveState === "saved"
                  ? { ...row, saveState: "idle" }
                  : row,
              ),
            );
          }, 1800);
        }
        return true;
      }
    })();

    savePromises.current.set(operationKey, request);
    try {
      return await request;
    } finally {
      if (savePromises.current.get(operationKey) === request) {
        savePromises.current.delete(operationKey);
      }
    }
  }

  async function adoptServerRevision(batchId: string, operationKey: string): Promise<boolean> {
    const fresh = await callAction(() => loadImportBatchRowsAction({ batchId }));
    if (!fresh.ok) return false;
    const stored = fresh.data.rows.find((row) => row.operationKey === operationKey);
    if (!stored) return false;
    updateRows((all) =>
      all.map((row) =>
        row.operationKey === operationKey
          ? {
              ...row,
              rowId: stored.id,
              revision: stored.draftRevision,
              materializedAtIso: stored.materializedAtIso,
              createdClientContactId: stored.createdClientContactId,
              createdProjectId: stored.createdProjectId,
              createdPurchaseId: stored.createdPurchaseId,
            }
          : row,
      ),
    );
    return true;
  }

  function changeDraft(operationKey: string, draft: ActiveWorkImportDraft) {
    updateRows((current) =>
      current.map((row) =>
        row.operationKey === operationKey
          ? {
              ...row,
              draft,
              assessment: null,
              materializeError: null,
              localVersion: row.localVersion + 1,
              saveState: "saving",
              saveError: null,
            }
          : row,
      ),
    );
    void persistRow(operationKey);
  }

  async function flushPendingRows(operationKeys?: readonly string[]): Promise<boolean> {
    const allowed = operationKeys ? new Set(operationKeys) : null;
    const paymentOperationKeys = new Set(
      rowsRef.current
        .filter((row) => !allowed || allowed.has(row.operationKey))
        .flatMap((row) => row.draft.payments.map((payment) => payment.operationKey)),
    );
    await Promise.all([
      ...[...proofPromisesRef.current]
        .filter(([paymentOperationKey]) => paymentOperationKeys.has(paymentOperationKey))
        .map(([, request]) => request),
      ...[...agreementPdfPromisesRef.current]
        .filter(([rowOperationKey]) => !allowed || allowed.has(rowOperationKey))
        .map(([, request]) => request),
    ]);
    const pending = rowsRef.current.filter(
      (row) =>
        !row.materializedAtIso &&
        (!allowed || allowed.has(row.operationKey)) &&
        (row.rowId === null ||
          row.persistedLocalVersion < row.localVersion ||
          row.saveState === "error" ||
          row.saveState === "unchecked" ||
          savePromises.current.has(row.operationKey)),
    );
    const results = await Promise.all(pending.map((row) => persistRow(row.operationKey)));
    return results.every(Boolean);
  }

  async function leaveWorkspace() {
    if (leaving) return;
    setLeaving(true);
    let saved = false;
    try {
      const pendingAdd = addPromiseRef.current;
      if (pendingAdd) await pendingAdd;
      saved = await flushPendingRows();
    } finally {
      if (!saved) setLeaving(false);
    }
    if (!saved) {
      setPageError("We couldn't save every change. Please try again before leaving.");
      return;
    }
    router.push("/dashboard/clients-projects");
  }

  async function closeMobileEditor(operationKey: string) {
    const saved = await flushPendingRows([operationKey]);
    if (saved) {
      editorMemoryRef.current.delete(operationKey);
      setMobileEditorOpen(false);
    }
  }

  function latestReasons(operationKey: string): readonly ImportReasonView[] {
    const latest = rowsRef.current.find((row) => row.operationKey === operationKey);
    if (!latest) return [];
    if (latest.materializeError) {
      return [{ code: "materialize_failed", field: "row", message: latest.materializeError }];
    }
    return rowDisplayReasons(
      latest.assessment,
      latest.draft,
      activeClientOptions,
      archivedClientOptions,
    ).filter((reason) => reason.code !== "checking");
  }

  async function continueEditorStep(
    operationKey: string,
    step: ImportEditorStep,
  ): Promise<readonly ImportReasonView[]> {
    const saved = await flushPendingRows([operationKey]);
    if (!saved) {
      const latest = rowsRef.current.find((row) => row.operationKey === operationKey);
      return [
        {
          code: "save_failed",
          field:
            step === "Client"
              ? "client.save"
              : step === "Project"
                ? "project.save"
                : "payments",
          message: latest?.saveError ?? "This item could not be saved. Try again.",
        },
      ];
    }
    return latestReasons(operationKey);
  }

  async function saveForLater(operationKey: string): Promise<boolean> {
    const saved = await flushPendingRows([operationKey]);
    if (!saved) return false;
    // Deliberately leaving an item forgets its editor position: reopening starts
    // at step 1 again. Memory only bridges layout switches of the open item.
    editorMemoryRef.current.delete(operationKey);
    setMobileEditorOpen(false);
    setSelectedOperationKey(null);
    return true;
  }

  async function finishItem(operationKey: string): Promise<readonly ImportReasonView[]> {
    const reasons = await continueEditorStep(operationKey, "Payments");
    const latest = rowsRef.current.find((row) => row.operationKey === operationKey);
    if (
      reasons.length > 0 ||
      !latest ||
      !isRowReady(latest.assessment, latest.draft, activeClientOptions, archivedClientOptions)
    ) {
      return reasons.length > 0
        ? reasons
        : [
            {
              code: "assessment_incomplete",
              field: "row",
              message: "Check this item again before finishing it.",
            },
          ];
    }

    const currentRows = rowsRef.current;
    const currentIndex = currentRows.findIndex((row) => row.operationKey === operationKey);
    const orderedCandidates = [
      ...currentRows.slice(currentIndex + 1),
      ...currentRows.slice(0, Math.max(0, currentIndex)),
    ];
    const nextUnfinished = orderedCandidates.find(
      (row) =>
        !row.materializedAtIso &&
        !isRowReady(row.assessment, row.draft, activeClientOptions, archivedClientOptions),
    );
    editorMemoryRef.current.delete(operationKey);
    if (nextUnfinished) {
      setSelectedOperationKey(nextUnfinished.operationKey);
      setMobileEditorOpen(isMobile);
    } else {
      setSelectedOperationKey(null);
      setMobileEditorOpen(false);
    }
    return [];
  }

  function removeIsBlocked(target: WorkspaceImportRow): boolean {
    return (
      target.saveState === "saving" ||
      target.persistedLocalVersion < target.localVersion ||
      agreementPdfUploads[target.operationKey]?.status === "uploading" ||
      target.draft.payments.some(
        (payment) => proofUploads[payment.operationKey]?.status === "uploading",
      ) ||
      savePromises.current.has(target.operationKey)
    );
  }

  async function removeRow(target: WorkspaceImportRow) {
    const latest = rowsRef.current.find((row) => row.operationKey === target.operationKey);
    if (!latest || removeIsBlocked(latest)) return;
    const confirmed = window.confirm(
      "Remove this draft? Created clients, projects, agreements, and payments cannot be removed here.",
    );
    if (!confirmed) return;
    const activeBatchId = batchIdRef.current;
    const targetRowId = target.rowId;
    if (targetRowId && activeBatchId) {
      const result = await callAction(() =>
        deleteImportRowAction({ batchId: activeBatchId, rowId: targetRowId }),
      );
      if (!result.ok) {
        setPageError(result.error);
        return;
      }
    }
    updateRows((current) => current.filter((row) => row.operationKey !== target.operationKey));
    editorMemoryRef.current.delete(target.operationKey);
    // Removing an item is a deliberate exit: nothing else opens in its place.
    setSelectedOperationKey(null);
    setMobileEditorOpen(false);
  }

  async function restoreClientForRow(operationKey: string, client: ArchivedClientOption) {
    if (restoringClientId) return;
    setRestoringClientId(client.id);
    setPageError(null);
    let result: Awaited<ReturnType<typeof restoreImportClientAction>>;
    try {
      result = await callAction(() => restoreImportClientAction({ id: client.id }));
    } finally {
      setRestoringClientId(null);
    }
    if (!result.ok) {
      setPageError(result.error);
      return;
    }
    setArchivedClientOptions((current) => current.filter((option) => option.id !== client.id));
    setActiveClientOptions((current) =>
      current.some((option) => option.id === client.id) ? current : [...current, client],
    );
    const latest = rowsRef.current.find((row) => row.operationKey === operationKey);
    if (!latest) return;
    changeDraft(operationKey, {
      ...latest.draft,
      client: {
        ...latest.draft.client,
        existingClientId: client.id,
        name: client.name,
        email: client.email,
      },
    });
  }

  async function loadSetupOptions(): Promise<boolean> {
    const activeBatchId = batchIdRef.current;
    if (!activeBatchId) return false;
    setLoadingSetup(true);
    let result: Awaited<ReturnType<typeof loadImportSetupOptionsAction>>;
    try {
      result = await callAction(() => loadImportSetupOptionsAction({ batchId: activeBatchId }));
    } finally {
      setLoadingSetup(false);
    }
    if (!result.ok) {
      setSetupOptions(null);
      setReviewError(result.error);
      return false;
    }
    setSetupOptions(result.data);
    if (setupShowsPriorAttempt(result.data)) setSetupAttempted(true);
    const eligibleClients = new Set(
      result.data.clients.filter((client) => client.invitationEligible).map((client) => client.id),
    );
    setSelectedClientIds(
      (current) => new Set([...current].filter((id) => eligibleClients.has(id))),
    );
    return true;
  }

  async function openReviewFlow() {
    if (openingReview) return;
    setOpeningReview(true);
    setReviewError(null);
    let saved = false;
    try {
      saved = await flushPendingRows();
    } finally {
      setOpeningReview(false);
    }
    if (!saved) {
      setPageError("We couldn't save every change. Please try again before reviewing.");
      return;
    }
    const hasCreated = rowsRef.current.some((row) => row.materializedAtIso !== null);
    const hasUnfinished = rowsRef.current.some((row) => row.materializedAtIso === null);
    setReviewStage(hasUnfinished ? "review" : "setup");
    setReviewOpen(true);
    if (!hasUnfinished && hasCreated && !setupOptions) {
      await loadSetupOptions();
    }
  }

  async function materializeReadyRows() {
    const activeBatchId = batchIdRef.current;
    if (!activeBatchId || creating) return;
    const readyRows = rowsRef.current.filter(
      (row) =>
        row.rowId &&
        !row.materializedAtIso &&
        !row.materializeError &&
        isRowReady(row.assessment, row.draft, activeClientOptions, archivedClientOptions),
    );
    const retryableFailedRows = rowsRef.current.filter(
      (row) =>
        row.rowId &&
        !row.materializedAtIso &&
        row.materializeError &&
        isRowReady(row.assessment, row.draft, activeClientOptions, archivedClientOptions),
    );
    const rowsToMaterialize = readyRows.length > 0 ? readyRows : retryableFailedRows;
    const requests = rowsToMaterialize.flatMap((row) =>
      row.rowId && row.assessment?.state === "ready"
        ? [{ rowId: row.rowId, expectedCreationDigest: row.assessment.creationDigest }]
        : [],
    );
    if (requests.length === 0) return;

    setCreating(true);
    setReviewError(null);
    let result: Awaited<ReturnType<typeof materializeImportRowsAction>>;
    try {
      result = await callAction(() =>
        materializeImportRowsAction({
          batchId: activeBatchId,
          rows: requests,
        }),
      );
    } finally {
      setCreating(false);
    }
    if (!result.ok) {
      setReviewError(result.error);
      return;
    }

    const outcomeByRowId = new Map(result.data.outcomes.map((outcome) => [outcome.rowId, outcome]));
    const rowById = new Map(
      rowsRef.current.flatMap((row) => (row.rowId ? ([[row.rowId, row]] as const) : [])),
    );
    const createdClientOptions = result.data.outcomes.flatMap<ExistingClientOption>((outcome) => {
      if (outcome.state !== "created") return [];
      const sourceRow = rowById.get(outcome.rowId);
      if (!sourceRow) return [];
      return [
        {
          id: outcome.clientContactId,
          name: sourceRow.draft.client.name.trim(),
          email: sourceRow.draft.client.email.trim(),
        },
      ];
    });
    if (createdClientOptions.length > 0) {
      setActiveClientOptions((current) => {
        const knownIds = new Set(current.map((client) => client.id));
        const additions = createdClientOptions.filter((client) => {
          if (knownIds.has(client.id)) return false;
          knownIds.add(client.id);
          return true;
        });
        return additions.length > 0 ? [...current, ...additions] : current;
      });
    }
    updateRows((current) =>
      current.map((row) => {
        if (!row.rowId) return row;
        const outcome = outcomeByRowId.get(row.rowId);
        if (!outcome) return row;
        if (outcome.state === "created") {
          return {
            ...row,
            materializedAtIso: outcome.materializedAtIso,
            createdClientContactId: outcome.clientContactId,
            createdProjectId: outcome.projectId,
            createdPurchaseId: outcome.purchaseId,
            materializeError: null,
            saveState: "idle",
            saveError: null,
          };
        }
        if (outcome.state === "needs_info") {
          return {
            ...row,
            assessment: { state: "needs_info", reasons: outcome.reasons },
            materializeError: null,
          };
        }
        return { ...row, materializeError: materializeErrorMessage(outcome.code, outcome.message) };
      }),
    );

    const createdTotal = rowsRef.current.filter((row) => row.materializedAtIso !== null).length;
    const failedTotal = result.data.outcomes.filter(
      (outcome) => outcome.state !== "created",
    ).length;
    const unansweredTotal = requests.length - result.data.outcomes.length;
    if (createdTotal > 0) {
      setReviewStage("setup");
      if (result.data.error) {
        setReviewError(
          `${result.data.error} ${String(unansweredTotal)} ${unansweredTotal === 1 ? "item was" : "items were"} not created yet; the saved details are unchanged.`,
        );
      } else if (failedTotal > 0) {
        setReviewError(
          `${String(failedTotal)} ${failedTotal === 1 ? "draft was" : "drafts were"} not created. The saved details are unchanged.`,
        );
      }
      await loadSetupOptions();
      return;
    }
    setReviewError(
      result.data.error ?? "Nothing was created. Review the messages below and try again.",
    );
  }

  function uploadProofForRow(
    operationKey: string,
    paymentOperationKey: string,
    file: File,
  ): Promise<boolean> {
    const existing = proofPromisesRef.current.get(paymentOperationKey);
    if (existing) return existing;
    const request = (async (): Promise<boolean> => {
      const contentType = importProofContentType(file);
      if (!contentType) {
        setProofUploads((current) => ({
          ...current,
          [paymentOperationKey]: {
            status: "error",
            error: "Choose a JPG, PNG, WebP, HEIC, or PDF file.",
          },
        }));
        return false;
      }
      if (file.size <= 0 || file.size > 15 * 1024 * 1024 || file.name.length > 200) {
        setProofUploads((current) => ({
          ...current,
          [paymentOperationKey]: {
            status: "error",
            error: "Choose a file up to 15 MB with a shorter file name.",
          },
        }));
        return false;
      }
      setProofUploads((current) => ({
        ...current,
        [paymentOperationKey]: { status: "uploading", error: null },
      }));
      const saved = await persistRow(operationKey);
      const row = rowsRef.current.find((item) => item.operationKey === operationKey);
      if (!saved || !row?.rowId || !batchIdRef.current) {
        setProofUploads((current) => ({
          ...current,
          [paymentOperationKey]: {
            status: "error",
            error: "Save this payment before adding proof.",
          },
        }));
        return false;
      }
      const activeBatchId = batchIdRef.current;
      const activeRowId = row.rowId;
      const prepared = await callAction(() =>
        prepareImportProofAction({
          batchId: activeBatchId,
          rowId: activeRowId,
          paymentOperationKey,
          originalFileName: file.name,
          contentType,
          sizeBytes: file.size,
        }),
      );
      if (!prepared.ok) {
        setProofUploads((current) => ({
          ...current,
          [paymentOperationKey]: { status: "error", error: prepared.error },
        }));
        return false;
      }
      let uploadError: string | null = null;
      try {
        const response = await fetch(prepared.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!response.ok) {
          // A signed upload link that was refused is not a connection problem:
          // 403 means the link expired, anything else is the storage service.
          console.error("[active-work-import] proof upload refused", {
            status: response.status,
          });
          uploadError =
            response.status === 403
              ? "The upload link expired. Attach the file again."
              : `The storage service refused the upload (status ${String(response.status)}). Try again in a moment.`;
        }
      } catch (error) {
        console.error("[active-work-import] proof upload did not reach storage", error);
        uploadError = "The proof upload did not finish. Check your connection and try again.";
      }
      if (uploadError) {
        const error = uploadError;
        setProofUploads((current) => ({
          ...current,
          [paymentOperationKey]: { status: "error", error },
        }));
        return false;
      }
      const latest = rowsRef.current.find((item) => item.operationKey === operationKey);
      if (!latest) return false;
      changeDraft(operationKey, {
        ...latest.draft,
        payments: latest.draft.payments.map((payment) =>
          payment.operationKey === paymentOperationKey
            ? {
                ...payment,
                proofUploadToken: prepared.data.uploadToken,
                proofFileName: file.name,
              }
            : payment,
        ),
      });
      const proofSaved = await persistRow(operationKey);
      setProofUploads((current) => ({
        ...current,
        [paymentOperationKey]: proofSaved
          ? { status: "done", error: null }
          : {
              status: "error",
              error: "The proof uploaded, but the draft did not save. Try again.",
            },
      }));
      return proofSaved;
    })();
    proofPromisesRef.current.set(paymentOperationKey, request);
    void request.then(
      () => {
        if (proofPromisesRef.current.get(paymentOperationKey) === request) {
          proofPromisesRef.current.delete(paymentOperationKey);
        }
      },
      () => {
        if (proofPromisesRef.current.get(paymentOperationKey) === request) {
          proofPromisesRef.current.delete(paymentOperationKey);
        }
      },
    );
    return request;
  }

  function uploadAgreementPdfForRow(operationKey: string, file: File): Promise<boolean> {
    const existing = agreementPdfPromisesRef.current.get(operationKey);
    if (existing) return existing;
    const setStatus = (status: ProofUploadView) => {
      setAgreementPdfUploads((current) => ({ ...current, [operationKey]: status }));
    };
    const request = (async (): Promise<boolean> => {
      const fileError = agreementPdfFileError({
        originalFileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (fileError) {
        setStatus({ status: "error", error: fileError });
        return false;
      }
      setStatus({ status: "uploading", error: null });
      const saved = await persistRow(operationKey);
      const row = rowsRef.current.find((item) => item.operationKey === operationKey);
      if (!saved || !row?.rowId || !batchIdRef.current) {
        setStatus({ status: "error", error: "Save this item before attaching the agreement." });
        return false;
      }
      const prepared = await callAction(() =>
        prepareImportAgreementPdfAction({
          batchId: batchIdRef.current as string,
          rowId: row.rowId as string,
          originalFileName: file.name,
          contentType: "application/pdf",
          sizeBytes: file.size,
        }),
      );
      if (!prepared.ok) {
        setStatus({ status: "error", error: prepared.error });
        return false;
      }
      let uploadError: string | null = null;
      try {
        const response = await fetch(prepared.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        });
        if (!response.ok) {
          console.error("[active-work-import] agreement PDF upload refused", {
            status: response.status,
          });
          uploadError =
            response.status === 403
              ? "The upload link expired. Attach the file again."
              : `The storage service refused the upload (status ${String(response.status)}). Try again in a moment.`;
        }
      } catch (error) {
        console.error("[active-work-import] agreement PDF upload did not reach storage", error);
        uploadError = "The PDF upload did not finish. Check your connection and try again.";
      }
      if (uploadError) {
        setStatus({ status: "error", error: uploadError });
        return false;
      }
      const latest = rowsRef.current.find((item) => item.operationKey === operationKey);
      if (!latest) return false;
      changeDraft(operationKey, {
        ...latest.draft,
        agreement: {
          ...latest.draft.agreement,
          agreementPdf: {
            uploadToken: prepared.data.uploadToken,
            fileName: file.name,
            sizeBytes: file.size,
          },
        },
      });
      const referenceSaved = await persistRow(operationKey);
      setStatus(
        referenceSaved
          ? { status: "done", error: null }
          : { status: "error", error: "The PDF uploaded, but the draft did not save. Try again." },
      );
      return referenceSaved;
    })();
    agreementPdfPromisesRef.current.set(operationKey, request);
    void request.then(
      () => {
        if (agreementPdfPromisesRef.current.get(operationKey) === request) {
          agreementPdfPromisesRef.current.delete(operationKey);
        }
      },
      () => {
        if (agreementPdfPromisesRef.current.get(operationKey) === request) {
          agreementPdfPromisesRef.current.delete(operationKey);
        }
      },
    );
    return request;
  }

  async function finishSetup() {
    const activeBatchId = batchIdRef.current;
    if (!activeBatchId || !setupOptions || finishing) return;
    const operationKey =
      finishOperationKeyRef.current ?? randomOperationKey("active-work-import-finish");
    finishOperationKeyRef.current = operationKey;
    setSetupAttempted(true);
    setFinishing(true);
    setReviewError(null);
    let result: Awaited<ReturnType<typeof finishImportSetupAction>>;
    try {
      result = await callAction(() =>
        finishImportSetupAction({
          batchId: activeBatchId,
          operationKey,
          expectedSetupDigest: setupOptions.setupDigest,
          selectedClientContactIds: [...selectedClientIds],
        }),
      );
    } finally {
      setFinishing(false);
    }
    if (!result.ok) {
      if (result.code === "CONFLICT") {
        finishOperationKeyRef.current = null;
        await loadSetupOptions();
      }
      setReviewError(result.error);
      return;
    }
    finishOperationKeyRef.current = null;
    setFinishResult(result.data);
    const failedClients = new Set(
      result.data.invitations
        .filter((invitation) => invitation.status === "failed")
        .map((invitation) => invitation.clientContactId),
    );
    // "requested" means the provider only acknowledged the send. The batch is
    // not finished yet: stay here, keep those clients selected so the next
    // Finish setup checks them again, and say so without an error tone.
    const requestedClients = new Set(
      result.data.invitations
        .filter((invitation) => invitation.status === "requested")
        .map((invitation) => invitation.clientContactId),
    );
    const failedInstallments = new Set(
      result.data.reminders
        .filter((reminder) => reminder.status === "failed")
        .map((reminder) => reminder.installmentId),
    );
    if (failedClients.size > 0 || failedInstallments.size > 0 || requestedClients.size > 0) {
      setSelectedClientIds(new Set([...failedClients, ...requestedClients]));
      await loadSetupOptions();
      if (failedClients.size > 0 || failedInstallments.size > 0) {
        setReviewError(
          "Some invitations or payment reminders did not finish. Created work is safe; review the status and try again.",
        );
      }
      return;
    }
    // Invitations and reminders can all succeed while the import stays open,
    // because saved drafts were never created. Say so here instead of leaving
    // and letting the wizard come back on the next visit with no explanation.
    if (!result.data.batch.completed) {
      await loadSetupOptions();
      setReviewError(unfinishedImportMessage(result.data.batch.unfinishedDraftCount));
      return;
    }
    router.push("/dashboard/clients-projects");
  }

  const effectiveReadyOperationKeys = new Set(
    rows
      .filter(
        (row) =>
          !row.materializedAtIso &&
          !row.materializeError &&
          isRowReady(row.assessment, row.draft, activeClientOptions, archivedClientOptions),
      )
      .map((row) => row.operationKey),
  );
  const retryableFailedOperationKeys = new Set(
    rows
      .filter(
        (row) =>
          !row.materializedAtIso &&
          row.materializeError &&
          isRowReady(row.assessment, row.draft, activeClientOptions, archivedClientOptions),
      )
      .map((row) => row.operationKey),
  );
  const readyCount = effectiveReadyOperationKeys.size;
  const retryableFailedCount = retryableFailedOperationKeys.size;
  const reviewableCount = readyCount + retryableFailedCount;
  const createdCount = rows.filter((row) => row.materializedAtIso !== null).length;
  const needsInfoCount = rows.length - readyCount - createdCount;
  const hasUnfinishedDrafts = rows.some((row) => row.materializedAtIso === null);
  const batchIsTerminal =
    initialBatch?.status === "completed" || (rows.length > 0 && !hasUnfinishedDrafts);
  const selectedRow = rows.find((row) => row.operationKey === selectedOperationKey) ?? null;
  const selectedIndex = selectedRow ? rows.indexOf(selectedRow) : -1;
  const mobileEditorVisible = isMobile && mobileEditorOpen && selectedRow !== null;
  // Both phone surfaces are hand-rolled `aria-modal` overlays portalled onto
  // document.body rather than Radix dialogs, so nothing else holds the page
  // behind them still. Without the lock iOS scrolls that page to reveal a
  // focused field when the keyboard opens, and the fixed overlay travels with
  // it — the editor slides off the top and the workspace shows through below.
  useBodyScrollLock(mobileEditorVisible || (isMobile && reviewOpen));
  const reviewActionLabel = openingReview
    ? "Preparing review…"
    : reviewableCount > 0
      ? readyCount > 0
        ? `Review ${String(readyCount)} ready ${readyCount === 1 ? "item" : "items"}`
        : `Review ${String(retryableFailedCount)} ${retryableFailedCount === 1 ? "item" : "items"} to retry`
      : hasUnfinishedDrafts
        ? `Review ${String(needsInfoCount)} ${needsInfoCount === 1 ? "item" : "items"} needing info`
        : "Finish setup";
  const mobilePortalTarget = typeof document === "undefined" ? null : document.body;
  const reviewPanel = reviewOpen ? (
    <ReviewAndFinish
      stage={reviewStage}
      rows={rows}
      clients={activeClientOptions}
      archivedClients={archivedClientOptions}
      effectiveReadyOperationKeys={effectiveReadyOperationKeys}
      retryableFailedOperationKeys={retryableFailedOperationKeys}
      canReturnToItems={hasUnfinishedDrafts && !batchIsTerminal}
      setupAttempted={setupAttempted}
      setupOptions={setupOptions}
      loadingSetup={loadingSetup}
      creating={creating}
      finishing={finishing}
      error={reviewError}
      finishResult={finishResult}
      selectedClientIds={selectedClientIds}
      onBack={() => {
        setReviewOpen(false);
        setReviewError(null);
      }}
      onCreate={() => {
        void materializeReadyRows();
      }}
      onReloadSetup={() => {
        void loadSetupOptions();
      }}
      onToggleClient={(id, selected) => {
        // A different set of invitations is a different reviewed action: the
        // operation key that belonged to the earlier choice must not be reused.
        finishOperationKeyRef.current = null;
        setSelectedClientIds((current) => {
          const next = new Set(current);
          if (selected) next.add(id);
          else next.delete(id);
          return next;
        });
      }}
      onDone={() => {
        void finishSetup();
      }}
    />
  ) : null;

  return (
    <div
      data-active-import-workspace
      aria-hidden={mobileEditorVisible ? true : undefined}
      inert={mobileEditorVisible ? true : undefined}
      className="sk-page-enter mx-auto flex max-w-[1600px] min-w-0 flex-col px-3 pt-2 pb-28 sm:px-5 sm:pt-3 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:px-6 lg:pb-4"
    >
      <header
        className={`${reviewOpen ? "hidden" : "flex"} min-w-0 shrink-0 items-center gap-2 border-b border-[rgb(var(--border-subtle))] pb-2.5 max-[374px]:grid max-[374px]:grid-cols-[2.75rem_minmax(0,1fr)_auto] max-[374px]:gap-x-2 max-[374px]:gap-y-1.5 sm:gap-3`}
      >
        <button
          type="button"
          onClick={() => {
            void leaveWorkspace();
          }}
          disabled={leaving}
          className="sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] sm:h-10 sm:w-auto sm:gap-1.5 sm:rounded-[var(--radius-md)] sm:pr-3"
          aria-label={leaving ? "Saving before leaving" : "Clients & Projects"}
        >
          <ArrowLeft size={17} strokeWidth={2.2} aria-hidden />
          <span className="hidden text-[11px] font-semibold sm:inline">
            {leaving ? "Saving…" : "Clients & Projects"}
          </span>
        </button>
        <div className="min-w-0 flex-1 max-[374px]:contents">
          <h1 className="font-syne truncate text-[17px] leading-tight font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] max-[374px]:col-span-2 max-[374px]:overflow-visible max-[374px]:text-clip sm:text-[20px]">
            Bring in active work
          </h1>
          <p
            aria-label="Import progress"
            aria-live="polite"
            aria-atomic="true"
            className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10.5px] font-semibold text-[rgb(var(--fg-muted))] max-[374px]:col-span-2 max-[374px]:mt-0 max-[374px]:gap-1 max-[374px]:overflow-visible max-[374px]:text-[10px] max-[374px]:text-clip sm:text-[11.5px]"
          >
            <span className="shrink-0 text-[rgb(var(--fg-default))]">
              {String(rows.length)} {rows.length === 1 ? "item" : "items"}
            </span>
            <span aria-hidden>·</span>
            <span className="shrink-0 text-[rgb(var(--fg-success-text))]">
              {String(readyCount)} Ready
            </span>
            <span aria-hidden>·</span>
            <span className="truncate text-[rgb(var(--fg-warning-text))] max-[374px]:overflow-visible max-[374px]:text-clip">
              {String(needsInfoCount)} Need info
            </span>
            {createdCount > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0">{String(createdCount)} Created</span>
              </>
            ) : null}
          </p>
        </div>
        {rows.length > 0 && !reviewOpen && !batchIsTerminal ? (
          <button
            type="button"
            onClick={() => {
              void addRow();
            }}
            disabled={starting || adding}
            aria-label="Add new client"
            className="sk-press inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-bold text-[rgb(var(--fg-default))] shadow-[var(--shadow-sm)] hover:bg-[rgb(var(--bg-overlay))] disabled:cursor-not-allowed disabled:opacity-50 max-[374px]:px-2 sm:px-4 sm:text-[13px]"
          >
            <Plus size={15} strokeWidth={2.4} aria-hidden />
            <span className="hidden sm:inline">Add new client</span>
            <span className="sm:hidden">Add</span>
          </button>
        ) : null}
        {rows.length > 0 && !reviewOpen ? (
          <button
            type="button"
            onClick={() => {
              void openReviewFlow();
            }}
            disabled={openingReview}
            aria-label={reviewActionLabel}
            className="sk-press inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[12px] font-bold text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)] disabled:cursor-not-allowed disabled:opacity-50 max-[374px]:px-2 sm:min-w-36 sm:px-4 sm:text-[13px]"
          >
            <span className="sm:hidden">
              {openingReview
                ? "Preparing…"
                : hasUnfinishedDrafts
                  ? `Review ${String(Math.max(readyCount, needsInfoCount, retryableFailedCount))}`
                  : "Finish setup"}
            </span>
            <span className="hidden sm:inline">{reviewActionLabel}</span>
            {!openingReview ? <ChevronRight size={14} strokeWidth={2.2} aria-hidden /> : null}
          </button>
        ) : null}
      </header>

      {initialNotice && !reviewOpen ? (
        <p
          role="status"
          className="mt-2 shrink-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[11.5px] text-[rgb(var(--fg-muted))]"
        >
          {initialNotice}
        </p>
      ) : null}

      {pageError ? (
        <div
          role="alert"
          className="mt-2 shrink-0 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.28)] bg-[rgb(var(--fg-danger)/0.07)] p-3 text-[11.5px] text-[rgb(var(--fg-danger-text))]"
        >
          {pageError}
        </div>
      ) : null}

      {reviewOpen && reviewPanel ? (
        isMobile && mobilePortalTarget ? (
          createPortal(reviewPanel, mobilePortalTarget)
        ) : (
          <div className="mt-3 min-w-0 lg:flex lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            {reviewPanel}
          </div>
        )
      ) : (
        <>
          <div className="mt-3 grid min-w-0 items-start gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(22rem,0.96fr)_minmax(0,1.44fr)] lg:items-stretch">
            <ImportRowList
              rows={rows}
              clients={activeClientOptions}
              archivedClients={archivedClientOptions}
              selectedOperationKey={selectedOperationKey}
              canAdd={!batchIsTerminal}
              addDisabled={starting || adding}
              onSelect={(operationKey, trigger) => {
                if (isMobile) mobileEditorTriggerRef.current = trigger;
                setSelectedOperationKey(operationKey);
                setMobileEditorOpen(isMobile);
              }}
              onAdd={() => {
                void addRow();
              }}
            />

            <div className="hidden min-w-0 lg:block lg:h-full lg:min-h-0">
              {selectedRow && !mobileEditorVisible ? (
                <ImportRowEditor
                  key={selectedRow.operationKey}
                  row={selectedRow}
                  index={selectedIndex}
                  clients={activeClientOptions}
                  archivedClients={archivedClientOptions}
                  templates={templates}
                  mobile={false}
                  onBack={() => undefined}
                  onChange={(draft) => {
                    changeDraft(selectedRow.operationKey, draft);
                  }}
                  editorMemory={editorMemoryRef.current}
                  onContinueStep={(step) => continueEditorStep(selectedRow.operationKey, step)}
                  onFinishItem={() => finishItem(selectedRow.operationKey)}
                  onSaveForLater={() => saveForLater(selectedRow.operationKey)}
                  onRemove={() => {
                    void removeRow(selectedRow);
                  }}
                  removeDisabled={removeIsBlocked(selectedRow)}
                  restoringClientId={restoringClientId}
                  onRestoreClient={(client) => {
                    void restoreClientForRow(selectedRow.operationKey, client);
                  }}
                  proofUploads={proofUploads}
                  onUploadProof={(paymentOperationKey, file) => {
                    void uploadProofForRow(selectedRow.operationKey, paymentOperationKey, file);
                  }}
                  agreementPdfUpload={agreementPdfUploads[selectedRow.operationKey]}
                  onUploadAgreementPdf={(file) => {
                    void uploadAgreementPdfForRow(selectedRow.operationKey, file);
                  }}
                />
              ) : (
                <div className="flex h-full min-h-[24rem] items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.55)] p-8 text-center text-[13px] text-[rgb(var(--fg-muted))] shadow-[var(--shadow-sm)]">
                  Select an item from the queue.
                </div>
              )}
            </div>
          </div>

          {mobileEditorVisible && mobilePortalTarget
            ? createPortal(
                <ImportRowEditor
                  key={selectedRow.operationKey}
                  row={selectedRow}
                  index={selectedIndex}
                  clients={activeClientOptions}
                  archivedClients={archivedClientOptions}
                  templates={templates}
                  mobile
                  onBack={() => {
                    void closeMobileEditor(selectedRow.operationKey);
                  }}
                  onChange={(draft) => {
                    changeDraft(selectedRow.operationKey, draft);
                  }}
                  editorMemory={editorMemoryRef.current}
                  onContinueStep={(step) => continueEditorStep(selectedRow.operationKey, step)}
                  onFinishItem={() => finishItem(selectedRow.operationKey)}
                  onSaveForLater={() => saveForLater(selectedRow.operationKey)}
                  onRemove={() => {
                    void removeRow(selectedRow);
                  }}
                  removeDisabled={removeIsBlocked(selectedRow)}
                  restoringClientId={restoringClientId}
                  onRestoreClient={(client) => {
                    void restoreClientForRow(selectedRow.operationKey, client);
                  }}
                  proofUploads={proofUploads}
                  onUploadProof={(paymentOperationKey, file) => {
                    void uploadProofForRow(selectedRow.operationKey, paymentOperationKey, file);
                  }}
                  agreementPdfUpload={agreementPdfUploads[selectedRow.operationKey]}
                  onUploadAgreementPdf={(file) => {
                    void uploadAgreementPdfForRow(selectedRow.operationKey, file);
                  }}
                />,
                mobilePortalTarget,
              )
            : null}
        </>
      )}

      {starting ? (
        <p role="status" className="mt-4 text-center text-[12px] text-[rgb(var(--fg-muted))]">
          Starting your saved setup…
        </p>
      ) : null}
    </div>
  );
}
