"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type DragEvent,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { Select } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { WORKFLOW_STAGES, type WorkflowStage } from "~/lib/clients/workflow-stage";
import {
  abortMultipartAction,
  addVersionAction,
  cancelFirstVersionUploadAction,
  completeFirstVersionUploadAction,
  completeMultipartAction,
  deleteVersionAction,
  initMultipartAction,
  prepareFirstVersionUploadAction,
  setTrackStageAction,
  signPartAction,
} from "~/app/(producer)/dashboard/clients-projects/upload-actions";
import {
  cancelInitializedUploadIfRequested,
  createUploadCancellationRequest,
  markResumableProgress,
  markVersionCleanupRequested,
  persistResumableEntry,
  removeResumableEntry,
  removeVersionCleanupEntry,
  requestExactMultipartCancellation,
  requestUploadCancellation,
  requestVersionCleanup,
  startMultipartCancellationRecovery,
  type ResumableEntry,
  type UploadCancellationRequest,
  uploadCancellationRequested,
} from "~/lib/audio/use-multipart-upload";
import {
  beginManagedUpload,
  cancelManagedUpload,
  requireUploadRuntimeAccountId,
  type ManagedUploadHandle,
} from "~/lib/audio/upload-manager";

// One file-first surface serves all contextual entry points. New Songs use
// a temporary intent and become durable only when Song + V1 commit together;
// existing Songs retain the hardened multipart Version path.

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const NEW_SONG_VALUE = "__new__";
const OFFLINE_UPLOAD_MESSAGE =
  "Reconnect to upload. This attempt has not started; your file and form details remain here.";

type ActiveMultipartUpload = ResumableEntry & {
  key: string;
  uploadId: string;
  trackVersionId: string;
  sizeBytes: number;
  completionToken: string;
};

// M1 — some drag-and-drop scenarios (Finder, certain browsers) hand us
// a File with an empty `type`. The audio/ prefix check rejects those
// files even when the filename ends in .wav / .flac / .m4a. Fall back
// to an extension whitelist so the producer's correctly-named file
// isn't refused for a missing MIME hint.
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".m4a", ".aiff", ".aif"];

function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  const lower = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface UploadTrackModalTrack {
  id: string;
  title: string;
  /** Used to auto-bump the default version label (V{N+1}). */
  versionCount: number;
  /** Public surfaces that will immediately resolve to this completed upload. */
  publicExposure?: "none" | "link" | "portfolio" | "link_and_portfolio";
}

export interface UploadTrackModalProject {
  id: string;
  title: string;
  clientName?: string | null;
  tracks: UploadTrackModalTrack[];
}

const EMPTY_TRACKS: UploadTrackModalTrack[] = [];
const EMPTY_PROJECTS: UploadTrackModalProject[] = [];

export interface UploadTrackModalProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  /** Legacy caller compatibility; V1 destination binding is now resolved server-side. */
  purchaseId?: string | null;
  mode: "library" | "new-song" | "new-version";
  /** Pre-selected when mode === "new-version". Required for that mode. */
  trackId?: string;
  /** Pre-populated version label (e.g. "V4"). Falls back to V{versionCount+1}. */
  defaultLabel?: string;
  tracks?: UploadTrackModalTrack[];
  projects?: UploadTrackModalProject[];
  /** Fired after the upload chain finishes — parent can refresh. */
  onCreated?: () => void;
}

export function UploadTrackModal({
  open,
  onClose,
  projectId,
  mode,
  trackId,
  defaultLabel,
  tracks = EMPTY_TRACKS,
  projects = EMPTY_PROJECTS,
  onCreated,
}: UploadTrackModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Destination details stay hidden until the producer chooses a file.
  const initialProjectId =
    mode !== "library" || (projectId && projects.some((project) => project.id === projectId))
      ? (projectId ?? projects[0]?.id ?? "")
      : (projects[0]?.id ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const initialPick = mode === "new-version" && trackId ? trackId : NEW_SONG_VALUE;
  const [selectedTrackId, setSelectedTrackId] = useState<string>(initialPick);
  const [newSongName, setNewSongName] = useState("");
  const [label, setLabel] = useState(defaultLabel ?? "V1");
  const [stage, setStage] = useState<"no-change" | WorkflowStage>("no-change");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Active upload state — kept in a ref so the abort handler reads the
  // freshest value even if the user closes mid-upload before React
  // commits a re-render. The ref also lets us detect "in flight" for
  // the Cancel button's destructive label.
  const activeUploadRef = useRef<ActiveMultipartUpload | null>(null);
  const activeFirstVersionIntentRef = useRef<string | null>(null);
  const activeCancellationRef = useRef<UploadCancellationRequest | null>(null);
  const activePutAbortRef = useRef<AbortController | null>(null);
  const managedUploadRef = useRef<ManagedUploadHandle | null>(null);
  const firstVersionOperationKeyRef = useRef("");

  useEffect(() => startMultipartCancellationRecovery(), []);

  // Reset every time the modal opens. Carrying state across open/close
  // is confusing — same precedent as new-client-modal.
  useEffect(() => {
    if (!open) return;
    const startPick = mode === "new-version" && trackId ? trackId : NEW_SONG_VALUE;
    setSelectedProjectId(initialProjectId);
    setSelectedTrackId(startPick);
    setNewSongName("");
    setLabel(defaultLabel ?? deriveNextLabel(tracks, startPick));
    setStage("no-change");
    setDescription("");
    setFile(null);
    setProgress(0);
    setUploadError(null);
    setIsDragging(false);
    activeUploadRef.current = null;
    activeFirstVersionIntentRef.current = null;
    firstVersionOperationKeyRef.current = crypto.randomUUID();
  }, [open, mode, trackId, initialProjectId, defaultLabel, tracks, projects]);

  useEffect(() => {
    if (online) {
      setUploadError((current) => (current === OFFLINE_UPLOAD_MESSAGE ? null : current));
    }
  }, [online]);

  const destinationTracks = useMemo(
    () =>
      mode === "library"
        ? (projects.find((candidate) => candidate.id === selectedProjectId)?.tracks ?? [])
        : tracks,
    [mode, projects, selectedProjectId, tracks],
  );

  // When the user picks a different existing track, auto-bump the
  // default label to V{N+1} for that track. We only do this if the
  // label is still "factory default" (empty or last derived) — once
  // the producer typed their own, we leave it alone.
  const derivedLabel = useMemo(
    () => deriveNextLabel(destinationTracks, selectedTrackId),
    [destinationTracks, selectedTrackId],
  );
  const [labelTouched, setLabelTouched] = useState(false);
  useEffect(() => {
    if (!labelTouched) {
      setLabel(defaultLabel ?? derivedLabel);
    }
  }, [derivedLabel, defaultLabel, labelTouched]);

  const isNewSong = mode === "new-song" || selectedTrackId === NEW_SONG_VALUE;
  const selectedPublicExposure =
    destinationTracks.find((track) => track.id === selectedTrackId)?.publicExposure ?? "none";
  const needsSongName = isNewSong && newSongName.trim().length === 0;
  const visibleUploadError = !online ? OFFLINE_UPLOAD_MESSAGE : uploadError;
  const submitDisabled =
    pending ||
    !online ||
    !file ||
    (!isNewSong && label.trim().length === 0) ||
    needsSongName ||
    !selectedProjectId ||
    (mode === "new-version" && !trackId);

  // ─── File handlers ─────────────────────────────────────────────────
  const handleFilePick = (f: File | null) => {
    if (pending) return;
    const previousIntentId = activeFirstVersionIntentRef.current;
    if (previousIntentId) {
      activeFirstVersionIntentRef.current = null;
      void cancelFirstVersionUploadAction({ intentId: previousIntentId });
      firstVersionOperationKeyRef.current = crypto.randomUUID();
    }
    if (!f) {
      setFile(null);
      return;
    }
    if (!isAudioFile(f)) {
      toast("Please pick an audio file (WAV / MP3).", "error");
      return;
    }
    setUploadError(null);
    setFile(f);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    handleFilePick(f);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0] ?? null;
    handleFilePick(f);
  };

  // ─── Submit / orchestration ────────────────────────────────────────
  function blockOfflineUpload(): boolean {
    const currentlyOnline = typeof navigator === "undefined" ? online : navigator.onLine;
    if (currentlyOnline) return false;
    setUploadError(OFFLINE_UPLOAD_MESSAGE);
    return true;
  }

  const handleClose = () => {
    const cancellation = activeCancellationRef.current;
    if (cancellation) requestUploadCancellation(cancellation);
    activePutAbortRef.current?.abort();
    const managed = managedUploadRef.current;
    if (managed) {
      void cancelManagedUpload(managed.id);
    }
    const firstVersionIntentId = activeFirstVersionIntentRef.current;
    if (firstVersionIntentId) {
      void cancelFirstVersionUploadAction({ intentId: firstVersionIntentId }).finally(() => {
        if (activeFirstVersionIntentRef.current === firstVersionIntentId) {
          activeFirstVersionIntentRef.current = null;
        }
      });
    }
    // Publish and reconcile an exact cancellation. Keep the identity in
    // the ref until that finishes so any upload failure can safely await
    // the same idempotent cancellation before deleting its placeholder.
    const active = activeUploadRef.current;
    if (active) {
      const versionCleanup = markVersionCleanupRequested(
        active.trackVersionId,
        new Date(),
        active.accountId,
      );
      void requestExactMultipartCancellation(active, abortMultipartAction).then(async (result) => {
        if (result.ok) {
          if (activeUploadRef.current === active) activeUploadRef.current = null;
          await requestVersionCleanup(versionCleanup, deleteVersionAction);
        }
      });
    }
    onClose();
  };

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blockOfflineUpload()) return;
    if (submitDisabled) return;
    // submitDisabled already guarantees `file !== null` (one of its
    // disqualifying predicates), so TS has narrowed file to File here.
    // We re-bind via const so the async closure below keeps the
    // narrowed type even after React re-renders.
    const submittedFile = file;
    startUpload(submittedFile);
  };

  function finishSuccessfulUpload(managed: ManagedUploadHandle) {
    managed.succeed();
    toast("Upload complete", "success");
    onCreated?.();
    router.refresh();
    onClose();
  }

  function startFirstVersionUpload(submittedFile: File) {
    if (blockOfflineUpload()) return;
    setUploadError(null);
    const cancellation = createUploadCancellationRequest();
    activeCancellationRef.current = cancellation;
    const putAbort = new AbortController();
    activePutAbortRef.current = putAbort;
    const managed = beginManagedUpload({
      fileName: submittedFile.name,
      label: mode === "library" ? "Upload audio" : "Add Song",
    });
    managedUploadRef.current = managed;
    let finishOperation: () => void = () => {};
    const operationFinished = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
    managed.setCancel(async () => {
      requestUploadCancellation(cancellation);
      putAbort.abort();
      await operationFinished;
      return { ok: activeFirstVersionIntentRef.current === null };
    });
    managed.setRetry(() => {
      if (blockOfflineUpload()) return Promise.reject(new Error(OFFLINE_UPLOAD_MESSAGE));
      managed.dismiss();
      startFirstVersionUpload(submittedFile);
      return Promise.resolve();
    });

    startTransition(async () => {
      setProgress(0);
      managed.setPreparing();
      try {
        let durationMs: number | undefined;
        try {
          durationMs = await getDurationMs(submittedFile);
        } catch {
          // Duration is decorative; the upload remains valid without it.
        }
        const trimmedDescription = description.trim();
        const prepared = await prepareFirstVersionUploadAction({
          operationKey: firstVersionOperationKeyRef.current,
          projectId: selectedProjectId,
          title: newSongName.trim(),
          label: "V1",
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          filename: submittedFile.name,
          sizeBytes: submittedFile.size,
          contentType: audioContentType(submittedFile),
          ...(durationMs ? { durationMs } : {}),
        });
        if (!prepared.ok) throw new Error(prepared.error);
        if (prepared.data.status === "completed") {
          activeFirstVersionIntentRef.current = null;
          finishSuccessfulUpload(managed);
          return;
        }

        const intentId = prepared.data.intentId;
        activeFirstVersionIntentRef.current = intentId;
        if (uploadCancellationRequested(cancellation)) {
          await cancelFirstVersionUploadAction({ intentId });
          activeFirstVersionIntentRef.current = null;
          throw new Error("Upload stopped.");
        }

        setProgress(8);
        managed.setUploading(8);
        const putResponse = await fetch(prepared.data.uploadUrl, {
          method: "PUT",
          body: submittedFile,
          headers: prepared.data.headers,
          signal: putAbort.signal,
        });
        if (!putResponse.ok) {
          throw new Error(`Audio upload failed: ${String(putResponse.status)}`);
        }
        if (uploadCancellationRequested(cancellation)) {
          await cancelFirstVersionUploadAction({ intentId });
          activeFirstVersionIntentRef.current = null;
          throw new Error("Upload stopped.");
        }
        setProgress(90);
        managed.setUploading(90);
        managed.setCompleting();
        const completed = await completeFirstVersionUploadAction({ intentId });
        if (!completed.ok) throw new Error(completed.error);
        activeFirstVersionIntentRef.current = null;
        if (stage !== "no-change") {
          const stageResult = await setTrackStageAction({
            trackId: completed.data.trackId,
            workflowStage: stage,
          });
          if (!stageResult.ok) {
            toast(`Uploaded — but stage didn't update: ${stageResult.error}`, "error");
          }
        }
        setProgress(100);
        finishSuccessfulUpload(managed);
      } catch (error) {
        const intentId = activeFirstVersionIntentRef.current;
        if (intentId && uploadCancellationRequested(cancellation)) {
          await cancelFirstVersionUploadAction({ intentId });
          activeFirstVersionIntentRef.current = null;
        }
        const message = error instanceof Error ? error.message : "Upload failed. Please retry.";
        toast(message, "error");
        setUploadError(message);
        setProgress(0);
        managed.fail(message);
      } finally {
        finishOperation();
        if (activeCancellationRef.current === cancellation) activeCancellationRef.current = null;
        if (activePutAbortRef.current === putAbort) activePutAbortRef.current = null;
        if (managedUploadRef.current === managed) managedUploadRef.current = null;
      }
    });
  }

  function startUpload(submittedFile: File) {
    if (isNewSong) {
      startFirstVersionUpload(submittedFile);
      return;
    }
    if (blockOfflineUpload()) return;
    setUploadError(null);
    const uploadAccountId = requireUploadRuntimeAccountId();
    const cancellation = createUploadCancellationRequest();
    activeCancellationRef.current = cancellation;
    const putAbort = new AbortController();
    activePutAbortRef.current = putAbort;
    const managed = beginManagedUpload({
      fileName: submittedFile.name,
      label: mode === "new-version" ? "Upload new version" : "Add song",
    });
    managedUploadRef.current = managed;
    let finishOperation: () => void = () => {};
    const operationFinished = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
    managed.setCancel(async () => {
      requestUploadCancellation(cancellation);
      putAbort.abort();
      await operationFinished;
      return { ok: activeUploadRef.current === null };
    });
    managed.setRetry(() => {
      if (blockOfflineUpload()) {
        return Promise.reject(new Error(OFFLINE_UPLOAD_MESSAGE));
      }
      managed.dismiss();
      startUpload(submittedFile);
      return Promise.resolve();
    });

    startTransition(async () => {
      setProgress(0);
      managed.setPreparing();
      // Track the version row id outside the try so a catch can clean up
      // the orphan when any later step (R2 init, chunk PUT, finalise)
      // fails. I1 — without this, a failed upload left a permanent
      // audioUrl=null row in the DB even after R2 multipart was aborted.
      let createdVersionId: string | null = null;
      let versionCleanup: ReturnType<typeof markVersionCleanupRequested> | null = null;
      try {
        const resolvedTrackId = selectedTrackId;

        // 2. Create the track_versions row with audioUrl=null. The R2
        //    completion step patches this same row once parts upload.
        //    description is forwarded only when non-empty so the column
        //    stays NULL for blank textareas rather than storing "".
        const trimmedDescription = description.trim();
        const vres = await addVersionAction({
          trackId: resolvedTrackId,
          label: label.trim(),
          audioUrl: null,
          ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
        });
        if (!vres.ok) throw new Error(vres.error);
        const versionId = vres.data.id;
        createdVersionId = versionId;
        versionCleanup = markVersionCleanupRequested(versionId, new Date(), uploadAccountId);
        if (uploadCancellationRequested(cancellation)) throw new Error("Upload stopped.");

        // 3. Init multipart upload on R2.
        const ires = await initMultipartAction({
          trackVersionId: versionId,
          filename: submittedFile.name,
          sizeBytes: submittedFile.size,
          contentType: submittedFile.type || "audio/mpeg",
        });
        if (!ires.ok) throw new Error(ires.error);
        const { uploadId, key, completionToken } = ires.data;
        const parts: { partNumber: number; eTag: string }[] = [];
        const recoveryStartedAt = new Date().toISOString();
        const recoveryEntry: ActiveMultipartUpload = {
          accountId: uploadAccountId,
          key,
          uploadId,
          trackVersionId: versionId,
          sizeBytes: submittedFile.size,
          totalBytes: submittedFile.size,
          completionToken,
          completed: parts,
          createdAt: recoveryStartedAt,
          lastProgressAt: recoveryStartedAt,
        };
        activeUploadRef.current = recoveryEntry;
        persistResumableEntry(recoveryEntry);
        managed.setUploading(0);
        const initializedCancellation = await cancelInitializedUploadIfRequested(
          cancellation,
          recoveryEntry,
          abortMultipartAction,
        );
        if (initializedCancellation) {
          if (initializedCancellation.ok && activeUploadRef.current === recoveryEntry) {
            activeUploadRef.current = null;
          }
          throw new Error("Upload stopped.");
        }

        // 4. Slice + sign + PUT each chunk in series. We stay serial
        //    rather than parallel so the progress bar tracks honestly
        //    and a network blip aborts cleanly without orphaning N
        //    parallel signed URLs.
        const partCount = Math.max(1, Math.ceil(submittedFile.size / CHUNK_SIZE));
        for (let i = 0; i < partCount; i++) {
          if (uploadCancellationRequested(cancellation)) throw new Error("Upload stopped.");
          const partNumber = i + 1;
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, submittedFile.size);
          const chunk = submittedFile.slice(start, end);

          const sres = await signPartAction({
            key,
            uploadId,
            partNumber,
            trackVersionId: versionId,
          });
          if (!sres.ok) throw new Error(sres.error);
          if (uploadCancellationRequested(cancellation)) throw new Error("Upload stopped.");

          const putRes = await fetch(sres.data.url, {
            method: "PUT",
            body: chunk,
            signal: putAbort.signal,
          });
          if (!putRes.ok) {
            throw new Error(`Part ${String(partNumber)} upload failed: ${String(putRes.status)}`);
          }
          if (uploadCancellationRequested(cancellation)) throw new Error("Upload stopped.");
          const eTag = (putRes.headers.get("ETag") ?? "").replaceAll('"', "");
          parts.push({ partNumber, eTag });
          markResumableProgress(recoveryEntry);
          const nextProgress = Math.round((parts.length / partCount) * 100);
          setProgress(nextProgress);
          managed.setUploading(nextProgress);
        }

        // 5. Best-effort duration probe via <audio> metadata. We never
        //    block the upload on this — duration is decorative, not
        //    load-bearing.
        let durationMs: number | undefined;
        try {
          durationMs = await getDurationMs(submittedFile);
        } catch {
          // Skip — completeMultipart accepts undefined durationMs.
        }
        if (uploadCancellationRequested(cancellation)) throw new Error("Upload stopped.");

        // 6. Finalise the multipart on R2 + patch the trackVersion row.
        managed.setCompleting();
        const cres = await completeMultipartAction({
          key,
          uploadId,
          parts,
          trackVersionId: versionId,
          sizeBytes: submittedFile.size,
          completionToken,
          acknowledgePublicExposure: selectedPublicExposure !== "none",
          ...(durationMs ? { durationMs } : {}),
        });
        if (!cres.ok) throw new Error(cres.error);
        removeResumableEntry(uploadId, uploadAccountId);
        removeVersionCleanupEntry(versionId, uploadAccountId);
        activeUploadRef.current = null;
        managed.succeed();

        // 7. Optional stage advance. We treat a stage failure as a soft
        //    error — the upload itself succeeded, we just couldn't
        //    bump the workflow. Surface a friendly toast.
        if (stage !== "no-change") {
          const stres = await setTrackStageAction({
            trackId: resolvedTrackId,
            workflowStage: stage,
          });
          if (!stres.ok) {
            toast(`Uploaded — but stage didn't update: ${stres.error}`, "error");
          }
        }

        // Clear the orphan-cleanup handle — the row is now legitimate.
        createdVersionId = null;
        finishSuccessfulUpload(managed);
      } catch (err) {
        // A pending multipart identity must be durably cancelled and
        // reconciled before its placeholder can be deleted. If cancel
        // fails, leave both the row and identity available for retry.
        if (versionCleanup === null && createdVersionId) {
          versionCleanup = markVersionCleanupRequested(
            createdVersionId,
            new Date(),
            uploadAccountId,
          );
        }
        const active = activeUploadRef.current;
        let cancellationFinished = active === null;
        if (active) {
          const aborted = await requestExactMultipartCancellation(active, abortMultipartAction);
          cancellationFinished = aborted.ok;
          if (aborted.ok && activeUploadRef.current === active) {
            activeUploadRef.current = null;
          }
        }
        if (versionCleanup && cancellationFinished) {
          await requestVersionCleanup(versionCleanup, deleteVersionAction);
        }
        const msg = err instanceof Error ? err.message : "Upload failed. Please retry.";
        toast(msg, "error");
        setUploadError(msg);
        setProgress(0);
        managed.fail(msg);
      } finally {
        finishOperation();
        if (activeCancellationRef.current === cancellation) {
          activeCancellationRef.current = null;
        }
        if (activePutAbortRef.current === putAbort) {
          activePutAbortRef.current = null;
        }
        if (managedUploadRef.current === managed) {
          managedUploadRef.current = null;
        }
      }
    });
  }

  // Display label for the locked song picker (new-version mode).
  const lockedSongTitle = useMemo(() => {
    if (mode !== "new-version" || !trackId) return null;
    return tracks.find((t) => t.id === trackId)?.title ?? "(this song)";
  }, [mode, trackId, tracks]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          aria-describedby="upload-track-modal-body"
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] flex-col overflow-hidden rounded-[18px] bg-[rgb(var(--bg-background))] p-0 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)] md:-translate-x-1/2 md:-translate-y-1/2"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                {mode === "library"
                  ? "Upload audio"
                  : mode === "new-version"
                    ? "Upload new Version"
                    : "Add Song"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="upload-track-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                {mode === "library"
                  ? "Choose a file first, then where it belongs."
                  : mode === "new-version"
                    ? "Add the next audio file to this Song."
                    : "Choose the first audio file for this Song."}
              </DialogPrimitive.Description>
            </div>
            <button
              type="button"
              aria-label="Close"
              onPointerDown={(event) => {
                event.preventDefault();
                handleClose();
              }}
              onClick={handleClose}
              className="-mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
            >
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-4">
              <div className="flex flex-col gap-3">
                {/* The file always comes first. Destination details appear only afterward. */}
                <div>
                  <FieldLabel htmlFor="upload-track-file" required>
                    Audio file
                  </FieldLabel>
                  <div
                    role="button"
                    aria-disabled={pending}
                    tabIndex={pending ? -1 : 0}
                    onClick={() => {
                      if (!pending) fileInputRef.current?.click();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => {
                      setIsDragging(false);
                    }}
                    onDrop={handleDrop}
                    className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-5 text-center transition-colors hover:bg-[rgb(17_16_9/0.04)]"
                    style={{
                      borderColor: isDragging
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--brand-primary)/0.40)",
                      background: isDragging
                        ? "rgb(var(--brand-primary)/0.10)"
                        : "rgb(var(--brand-primary)/0.04)",
                    }}
                  >
                    <UploadCloud
                      size={22}
                      strokeWidth={1.8}
                      aria-hidden
                      className="text-[rgb(var(--brand-primary))]"
                    />
                    {file ? (
                      <div className="max-w-full min-w-0">
                        <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                          {file.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))]">
                          {formatBytes(file.size)} · Click to replace
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                          Drop WAV / MP3 here
                        </p>
                        <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))]">
                          or click to browse
                        </p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    id="upload-track-file"
                    type="file"
                    accept="audio/*,.mp3,.m4a,.wav,.flac,.aif,.aiff"
                    disabled={pending}
                    onChange={handleFileInputChange}
                    className="sr-only"
                  />
                </div>

                {file ? (
                  <>
                    {mode === "library" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel
                            htmlFor={
                              projects.length === 0
                                ? "upload-track-project-empty"
                                : "upload-track-project"
                            }
                            required
                          >
                            Project
                          </FieldLabel>
                          {projects.length === 0 ? (
                            <p
                              id="upload-track-project-empty"
                              className="mt-1 min-h-10 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[13px] text-[rgb(var(--fg-muted))]"
                            >
                              No active Projects
                            </p>
                          ) : (
                            <Select
                              id="upload-track-project"
                              aria-label="Project"
                              value={selectedProjectId}
                              disabled={pending}
                              onChange={(event) => {
                                setSelectedProjectId(event.target.value);
                                setSelectedTrackId(NEW_SONG_VALUE);
                                setLabelTouched(false);
                              }}
                              className="mt-1"
                            >
                              {projects.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.title}
                                  {candidate.clientName ? ` · ${candidate.clientName}` : ""}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>
                        <div>
                          <FieldLabel
                            htmlFor={
                              destinationTracks.length === 0
                                ? "upload-track-destination-locked"
                                : "upload-track-song"
                            }
                            required
                          >
                            Destination
                          </FieldLabel>
                          {destinationTracks.length === 0 ? (
                            <p
                              id="upload-track-destination-locked"
                              className="mt-1 min-h-10 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--fg-default))]"
                            >
                              New Song
                            </p>
                          ) : (
                            <Select
                              id="upload-track-song"
                              value={selectedTrackId}
                              disabled={pending}
                              onChange={(event) => {
                                setSelectedTrackId(event.target.value);
                                setLabelTouched(false);
                              }}
                              className="mt-1"
                            >
                              <option value={NEW_SONG_VALUE}>New Song</option>
                              {destinationTracks.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  New Version — {candidate.title}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {mode === "new-version" && trackId ? (
                      <div>
                        <FieldLabel htmlFor="upload-track-song-locked">Song</FieldLabel>
                        <p
                          id="upload-track-song-locked"
                          className="mt-1 truncate rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))]"
                          style={{ borderColor: "rgb(var(--border-subtle))" }}
                        >
                          {lockedSongTitle}
                        </p>
                      </div>
                    ) : isNewSong ? (
                      <div>
                        <FieldLabel htmlFor="upload-track-new-song-name" required>
                          Song title
                        </FieldLabel>
                        <input
                          id="upload-track-new-song-name"
                          type="text"
                          required
                          autoFocus
                          value={newSongName}
                          disabled={pending}
                          maxLength={120}
                          onChange={(event) => {
                            setNewSongName(event.target.value);
                          }}
                          placeholder="Name this Song"
                          className="mt-1 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                          style={{ borderColor: "rgb(var(--border-subtle))" }}
                        />
                      </div>
                    ) : null}

                    {selectedPublicExposure !== "none" ? (
                      <div
                        role="status"
                        className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.1)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[rgb(var(--fg-default))]"
                      >
                        <span className="font-semibold">This song is public.</span> When this upload
                        finishes, the new version will appear on its
                        {selectedPublicExposure === "link"
                          ? " public link"
                          : selectedPublicExposure === "portfolio"
                            ? " portfolio"
                            : " public link and portfolio"}{" "}
                        automatically.
                      </div>
                    ) : null}

                    {/* ─── Version label ──────────────────────────────── */}
                    {!isNewSong ? (
                      <div>
                        <FieldLabel htmlFor="upload-track-label" required>
                          Version label
                        </FieldLabel>
                        <input
                          id="upload-track-label"
                          type="text"
                          required
                          value={label}
                          maxLength={40}
                          onChange={(e) => {
                            setLabel(e.target.value);
                            setLabelTouched(true);
                          }}
                          placeholder="V2 / Mix / Master"
                          className="mt-1 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                          style={{ borderColor: "rgb(var(--border-subtle))" }}
                        />
                      </div>
                    ) : null}

                    <details className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
                      <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.6)] focus-visible:outline-none focus-visible:ring-inset">
                        Stage and notes (optional)
                      </summary>
                      <div className="grid gap-3 border-t border-[rgb(var(--border-subtle))] p-3">
                        <div>
                          <FieldLabel htmlFor="upload-track-stage">Advance to stage</FieldLabel>
                          <select
                            id="upload-track-stage"
                            value={stage}
                            onChange={(e) => {
                              setStage(e.target.value as "no-change" | WorkflowStage);
                            }}
                            className="mt-1 w-full rounded-[10px] border bg-[rgb(var(--bg-background))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                            style={{ borderColor: "rgb(var(--border-subtle))" }}
                          >
                            <option value="no-change">No change</option>
                            {WORKFLOW_STAGES.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel htmlFor="upload-track-description">
                            Notes for artist
                          </FieldLabel>
                          <textarea
                            id="upload-track-description"
                            value={description}
                            rows={2}
                            maxLength={500}
                            onChange={(e) => {
                              setDescription(e.target.value);
                            }}
                            placeholder="What changed in this version?"
                            className="mt-1 w-full resize-y rounded-[10px] border bg-[rgb(var(--bg-background))] px-3 py-2 text-[14px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                            style={{ borderColor: "rgb(var(--border-subtle))" }}
                          />
                        </div>
                      </div>
                    </details>
                  </>
                ) : null}

                {/* ─── Progress bar ───────────────────────────────── */}
                {pending ? (
                  <div>
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full"
                      style={{ background: "rgb(17_16_9/0.08)" }}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    >
                      <div
                        className="h-full transition-[width]"
                        style={{
                          width: `${String(progress)}%`,
                          background: "rgb(var(--brand-primary))",
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-[rgb(var(--fg-muted))]">
                      Uploading… {progress}%
                    </p>
                  </div>
                ) : null}

                {file && projects.length === 0 && mode === "library" ? (
                  <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
                    Create or activate a Project before uploading audio.
                  </p>
                ) : null}

                {visibleUploadError ? (
                  <p
                    id="upload-track-error"
                    role="alert"
                    className="text-sm text-[rgb(var(--fg-danger))]"
                  >
                    {visibleUploadError}
                  </p>
                ) : null}
              </div>
            </div>

            {/* ─── Action row ─────────────────────────────────── */}
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] sm:min-h-0"
              >
                {pending ? "Stop uploading" : "Cancel"}
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                aria-describedby={visibleUploadError ? "upload-track-error" : undefined}
                className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none sm:min-h-0"
                style={{ background: "rgb(var(--brand-primary))" }}
              >
                {pending ? "Uploading…" : !online ? "Reconnect to upload" : "Upload"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[10.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
    >
      {children}
      {required ? (
        <span aria-hidden className="ml-0.5 text-[rgb(var(--fg-danger))]">
          *
        </span>
      ) : null}
    </label>
  );
}

// Derive the next sensible version label for a given track id. For a
// new song we suggest "V1"; otherwise V{N+1} based on the upstream
// versionCount. The producer can always overwrite.
function deriveNextLabel(tracks: UploadTrackModalTrack[], trackIdOrNew: string): string {
  if (trackIdOrNew === NEW_SONG_VALUE) return "V1";
  const t = tracks.find((row) => row.id === trackIdOrNew);
  const next = (t?.versionCount ?? 0) + 1;
  return `V${String(next)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function audioContentType(file: File): string {
  if (file.type.startsWith("audio/")) return file.type.toLowerCase();
  const extension = file.name.toLowerCase().split(".").pop();
  switch (extension) {
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/x-m4a";
    case "aif":
    case "aiff":
      return "audio/aiff";
    default:
      return "audio/mpeg";
  }
}

// Best-effort duration probe. Wrapped in a 3s race so a malformed
// audio file can't hang the upload. Failure throws → caller skips.
async function getDurationMs(file: File): Promise<number> {
  const probe = new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(Math.round(audio.duration * 1000));
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => {
      reject(new Error("Could not read duration"));
    };
    audio.src = URL.createObjectURL(file);
  });
  const timeout = new Promise<number>((_, reject) => {
    setTimeout(() => {
      reject(new Error("Duration probe timed out"));
    }, 3000);
  });
  return Promise.race([probe, timeout]);
}
