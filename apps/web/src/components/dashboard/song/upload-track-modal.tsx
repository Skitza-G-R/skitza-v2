"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { UploadCloud, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  cancelStagedAudioUploadAction,
  finalizeAudioUploadAction,
  getAudioStorageUsageAction,
  reconcileAudioStorageUsageAction,
  setTrackStageAction,
  stageAudioUploadAction,
  type AudioStorageUsage,
} from "~/app/(producer)/dashboard/clients-projects/upload-actions";
import {
  AUDIO_STORAGE_FULL_MESSAGE,
  AUDIO_UPLOAD_MAX_BYTES,
  PRODUCER_AUDIO_STORAGE_LIMIT_BYTES,
} from "~/lib/audio/storage-limits";
import {
  createUploadCancellationRequest,
  requestUploadCancellation,
  type UploadCancellationRequest,
  uploadCancellationRequested,
} from "~/lib/audio/use-multipart-upload";
import {
  beginManagedUpload,
  cancelManagedUpload,
  type ManagedUploadHandle,
} from "~/lib/audio/upload-manager";
import { uploadStageFailure, uploadTransferFailure } from "~/lib/audio/upload-stage-errors";

import {
  NEW_SONG_DESTINATION,
  defaultLibraryUploadDestination,
  shouldShowLibraryUploadDestination,
} from "./upload-destination";

// One file-first surface serves all contextual entry points. Every supported
// audio file first transfers into a producer-scoped temporary intent. The
// producer's explicit final action is the only step that creates a Song or
// Version, so transfer can overlap metadata entry without ghost records.

const OFFLINE_UPLOAD_MESSAGE =
  "Reconnect to upload. This attempt has not started; your file and form details remain here.";
const READY_TO_RETRY_UPLOAD_MESSAGE = "Connection restored. Retry the audio transfer.";
const FILE_TOO_LARGE_MESSAGE = "Audio files can be up to 100 MB.";
const STORAGE_WARNING_MESSAGE =
  "You're close to the 1 GB beta limit. Delete old Versions or Songs you no longer need.";

type StagedUploadCancellationResult = { ok: true } | { ok: false; error: string };

type StagedTransferStatus = "idle" | "preparing" | "uploading" | "ready" | "error" | "cancelling";

type ActiveStagedUpload = {
  token: string;
  file: File;
  operationKey: string;
  intentId: string | null;
  cancellation: UploadCancellationRequest;
  putAbort: AbortController;
  managed: ManagedUploadHandle;
  duration: Promise<number | undefined>;
  finished: Promise<void>;
  finish: () => void;
  abandonRequested: boolean;
  cancel: () => Promise<StagedUploadCancellationResult>;
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
  canCreateNewSong: boolean;
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const online = useOnlineStatus();
  const [finalizing, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Destination details stay hidden until the producer chooses a file.
  const initialProjectId =
    mode !== "library" || (projectId && projects.some((project) => project.id === projectId))
      ? (projectId ?? projects[0]?.id ?? "")
      : (projects[0]?.id ?? "");
  const initialProject = projects.find((candidate) => candidate.id === initialProjectId);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const initialPick =
    mode === "new-version" && trackId
      ? trackId
      : mode === "library"
        ? defaultLibraryUploadDestination(initialProject)
        : NEW_SONG_DESTINATION;
  const [selectedTrackId, setSelectedTrackId] = useState<string>(initialPick);
  const [newSongName, setNewSongName] = useState("");
  const [label, setLabel] = useState(defaultLabel ?? "V1");
  const [stage, setStage] = useState<"no-change" | WorkflowStage>("no-change");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [transferStatus, setTransferStatus] = useState<StagedTransferStatus>("idle");
  const [stagedIntentId, setStagedIntentId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<AudioStorageUsage | null>(null);
  const [storageUsageLoading, setStorageUsageLoading] = useState(false);
  const [storageUsageError, setStorageUsageError] = useState<string | null>(null);
  const fileReplacementInFlightRef = useRef(false);
  const closingRef = useRef(false);

  // The staged intent is the complete cancellation/retry authority for every
  // destination. A generation token prevents a late callback from a replaced
  // file from mutating the new file's UI state.
  const activeStagedUploadRef = useRef<ActiveStagedUpload | null>(null);

  // Reset every time the modal opens. Carrying state across open/close
  // is confusing — same precedent as new-client-modal.
  useEffect(() => {
    if (!open) return;
    const startProject = projects.find((candidate) => candidate.id === initialProjectId);
    const startPick =
      mode === "new-version" && trackId
        ? trackId
        : mode === "library"
          ? defaultLibraryUploadDestination(startProject)
          : NEW_SONG_DESTINATION;
    setSelectedProjectId(initialProjectId);
    setSelectedTrackId(startPick);
    setNewSongName("");
    setLabel(defaultLabel ?? deriveNextLabel(tracks, startPick));
    setStage("no-change");
    setDescription("");
    setFile(null);
    setTransferStatus("idle");
    setStagedIntentId(null);
    setProgress(0);
    setUploadError(null);
    setIsDragging(false);
    fileReplacementInFlightRef.current = false;
    closingRef.current = false;
  }, [open, mode, trackId, initialProjectId, defaultLabel, tracks, projects]);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    setStorageUsage(null);
    setStorageUsageError(null);
    setStorageUsageLoading(true);
    void getAudioStorageUsageAction()
      .then((result) => {
        if (ignore) return;
        if (result.ok) {
          setStorageUsage(result.data);
          return;
        }
        setStorageUsageError("We couldn't check your storage. Close this window and try again.");
      })
      .catch(() => {
        if (!ignore) {
          setStorageUsageError("We couldn't check your storage. Close this window and try again.");
        }
      })
      .finally(() => {
        if (!ignore) setStorageUsageLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [open]);

  useEffect(() => {
    if (online) {
      setUploadError((current) =>
        current === OFFLINE_UPLOAD_MESSAGE ? READY_TO_RETRY_UPLOAD_MESSAGE : current,
      );
    }
  }, [online]);

  const selectedProject = useMemo(
    () => projects.find((candidate) => candidate.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const destinationTracks = mode === "library" ? (selectedProject?.tracks ?? []) : tracks;
  const showLibraryUploadDestination = shouldShowLibraryUploadDestination(selectedProject);

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

  const isNewSong = mode === "new-song" || selectedTrackId === NEW_SONG_DESTINATION;
  const selectedPublicExposure =
    destinationTracks.find((track) => track.id === selectedTrackId)?.publicExposure ?? "none";
  const needsSongName = isNewSong && newSongName.trim().length === 0;
  const projectedStorageBytes =
    storageUsage && file ? storageUsage.committedBytes + file.size : null;
  const storageLimitExceeded =
    stagedIntentId === null &&
    storageUsage !== null &&
    (storageUsage.isFull ||
      (projectedStorageBytes !== null && projectedStorageBytes > storageUsage.limitBytes));
  const visibleUploadError = !online
    ? OFFLINE_UPLOAD_MESSAGE
    : storageLimitExceeded && uploadError === AUDIO_STORAGE_FULL_MESSAGE
      ? null
      : uploadError;
  const storageWarningReached =
    storageUsage !== null &&
    !storageLimitExceeded &&
    (storageUsage.isAtOrAboveWarning ||
      (projectedStorageBytes !== null && projectedStorageBytes >= storageUsage.warningBytes));
  const submitDisabled =
    finalizing ||
    !online ||
    storageUsageLoading ||
    !storageUsage ||
    storageLimitExceeded ||
    !file ||
    transferStatus !== "ready" ||
    (!isNewSong && label.trim().length === 0) ||
    needsSongName ||
    !selectedProjectId ||
    (mode === "new-version" && !trackId);
  const filePickerDisabled = finalizing || transferStatus === "cancelling";
  const transferVisible =
    transferStatus === "preparing" ||
    transferStatus === "uploading" ||
    transferStatus === "ready" ||
    transferStatus === "cancelling";

  async function refreshStorageUsageAfterQuotaRejection(): Promise<void> {
    setStorageUsageLoading(true);
    setStorageUsageError(null);
    try {
      const result = await getAudioStorageUsageAction();
      if (!result.ok) {
        setStorageUsage(null);
        setStorageUsageError("We couldn't check your storage. Close this window and try again.");
        return;
      }
      setStorageUsage(result.data);
    } catch {
      setStorageUsage(null);
      setStorageUsageError("We couldn't check your storage. Close this window and try again.");
    } finally {
      setStorageUsageLoading(false);
    }
  }

  async function cleanUpOldUploads(): Promise<void> {
    setStorageUsageLoading(true);
    setStorageUsageError(null);
    try {
      const result = await reconcileAudioStorageUsageAction();
      if (!result.ok) {
        setStorageUsageError("We couldn't clean up old uploads. Try again.");
        return;
      }
      setStorageUsage(result.data);
    } catch {
      setStorageUsageError("We couldn't clean up old uploads. Try again.");
    } finally {
      setStorageUsageLoading(false);
    }
  }

  function isCurrentStagedUpload(attempt: ActiveStagedUpload): boolean {
    return activeStagedUploadRef.current?.token === attempt.token;
  }

  async function retireStagedUpload(attempt: ActiveStagedUpload): Promise<boolean> {
    if (isCurrentStagedUpload(attempt)) setTransferStatus("cancelling");
    const result = await attempt.cancel();
    if (!result.ok) {
      if (isCurrentStagedUpload(attempt)) {
        setTransferStatus("error");
        setUploadError(result.error);
      }
      return false;
    }
    if (isCurrentStagedUpload(attempt)) {
      activeStagedUploadRef.current = null;
      setStagedIntentId(null);
    }
    attempt.managed.dismiss();
    return true;
  }

  function blockOfflineUpload(): boolean {
    const currentlyOnline = typeof navigator === "undefined" ? online : navigator.onLine;
    if (currentlyOnline) return false;
    setUploadError(OFFLINE_UPLOAD_MESSAGE);
    return true;
  }

  async function startStagedAudioTransfer(stagedFile: File): Promise<void> {
    if (blockOfflineUpload()) {
      setTransferStatus("error");
      return;
    }

    const cancellation = createUploadCancellationRequest();
    const putAbort = new AbortController();
    const managed = beginManagedUpload({
      fileName: stagedFile.name,
      label:
        mode === "library"
          ? "Upload audio"
          : mode === "new-version"
            ? "Upload new Version"
            : "Add Song",
      terminalFeedback: "toast",
      // This modal renders its own attached progress bar, and closing it
      // cancels the transfer — a dock card would only duplicate the bar.
      showInDock: false,
    });
    let finishOperation: () => void = () => {};
    const operationFinished = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
    let cancellationSucceeded = false;
    let cancellationInFlight: Promise<StagedUploadCancellationResult> | null = null;
    const attempt: ActiveStagedUpload = {
      token: crypto.randomUUID(),
      file: stagedFile,
      operationKey: crypto.randomUUID(),
      intentId: null,
      cancellation,
      putAbort,
      managed,
      duration: getDurationMs(stagedFile).catch(() => undefined),
      finished: operationFinished,
      finish: finishOperation,
      abandonRequested: false,
      cancel: () => Promise.resolve({ ok: true }),
    };
    const cancelExactIntent = (): Promise<StagedUploadCancellationResult> => {
      if (cancellationSucceeded || !attempt.intentId) return Promise.resolve({ ok: true });
      if (cancellationInFlight) return cancellationInFlight;
      const intentId = attempt.intentId;
      const request = (async (): Promise<StagedUploadCancellationResult> => {
        try {
          const result = await cancelStagedAudioUploadAction({ intentId });
          if (!result.ok) return { ok: false, error: result.error };
          cancellationSucceeded = true;
          return { ok: true };
        } catch {
          return { ok: false, error: uploadStageFailure("cancellation") };
        }
      })();
      cancellationInFlight = request;
      void request.then(() => {
        if (!cancellationSucceeded && cancellationInFlight === request) {
          cancellationInFlight = null;
        }
      });
      return request;
    };
    attempt.cancel = async () => {
      requestUploadCancellation(cancellation);
      putAbort.abort();
      await attempt.finished;
      return cancelExactIntent();
    };
    activeStagedUploadRef.current = attempt;
    setStagedIntentId(null);
    managed.setCancel(async () => {
      const result = await attempt.cancel();
      if (result.ok && isCurrentStagedUpload(attempt)) {
        activeStagedUploadRef.current = null;
        setStagedIntentId(null);
        setFile(null);
        setProgress(0);
        setTransferStatus("idle");
      }
      return { ok: result.ok };
    });
    managed.setTerminalDispose(async () => {
      const result = await attempt.cancel();
      if (result.ok && isCurrentStagedUpload(attempt)) {
        activeStagedUploadRef.current = null;
        setStagedIntentId(null);
        setFile(null);
        setProgress(0);
        setTransferStatus("idle");
      }
      return { ok: result.ok };
    });
    managed.setRetry(async () => {
      if (blockOfflineUpload()) throw new Error(OFFLINE_UPLOAD_MESSAGE);
      if (attempt.abandonRequested) {
        const canceled = await attempt.cancel();
        if (!canceled.ok) throw new Error(canceled.error);
        if (isCurrentStagedUpload(attempt)) {
          activeStagedUploadRef.current = null;
          setStagedIntentId(null);
        }
        attempt.managed.dismiss();
        return;
      }
      if (!(await retireStagedUpload(attempt))) {
        throw new Error(uploadStageFailure("cancellation"));
      }
      setTransferStatus("idle");
      setUploadError(null);
      await startStagedAudioTransfer(stagedFile);
    });

    setTransferStatus("preparing");
    setProgress(0);
    setUploadError(null);
    managed.setPreparing();
    try {
      const prepared = await stageAudioUploadAction({
        operationKey: attempt.operationKey,
        filename: stagedFile.name,
        sizeBytes: stagedFile.size,
        contentType: audioContentType(stagedFile),
      });
      if (!prepared.ok) throw new Error(prepared.error);
      if (prepared.data.status === "completed") {
        activeStagedUploadRef.current = null;
        finishSuccessfulUpload(managed, prepared.data.versionId);
        return;
      }

      attempt.intentId = prepared.data.intentId;
      if (isCurrentStagedUpload(attempt)) setStagedIntentId(prepared.data.intentId);
      if (uploadCancellationRequested(cancellation)) {
        const canceled = await cancelExactIntent();
        if (!canceled.ok) throw new Error(canceled.error);
        throw new Error("Upload stopped.");
      }

      if (isCurrentStagedUpload(attempt)) {
        setTransferStatus("uploading");
        setProgress(8);
      }
      managed.setUploading(8);
      let putResponse: Response;
      try {
        putResponse = await fetch(prepared.data.uploadUrl, {
          method: "PUT",
          body: stagedFile,
          headers: prepared.data.headers,
          signal: putAbort.signal,
        });
      } catch {
        if (uploadCancellationRequested(cancellation)) throw new Error("Upload stopped.");
        throw new Error(uploadTransferFailure());
      }
      // Write-once retries may observe the exact prior PUT. Finalization is
      // still the authoritative token/size/type verification step.
      if (!putResponse.ok && putResponse.status !== 409 && putResponse.status !== 412) {
        throw new Error(uploadTransferFailure({ status: putResponse.status }));
      }
      if (uploadCancellationRequested(cancellation)) {
        const canceled = await cancelExactIntent();
        if (!canceled.ok) throw new Error(canceled.error);
        throw new Error("Upload stopped.");
      }
      if (isCurrentStagedUpload(attempt)) {
        setProgress(100);
        setTransferStatus("ready");
      }
      managed.setReadyToSave();
    } catch (error) {
      let message = error instanceof Error ? error.message : uploadStageFailure("initiation");
      if (uploadCancellationRequested(cancellation)) {
        const canceled = await cancelExactIntent();
        if (!canceled.ok) message = canceled.error;
      }
      if (isCurrentStagedUpload(attempt)) {
        setProgress(0);
        setTransferStatus("error");
        setUploadError(message);
      }
      if (message.includes(AUDIO_STORAGE_FULL_MESSAGE)) {
        managed.dismiss();
        if (isCurrentStagedUpload(attempt)) {
          activeStagedUploadRef.current = null;
          setStagedIntentId(null);
        }
        await refreshStorageUsageAfterQuotaRejection();
      } else if (message !== "Upload stopped.") {
        managed.fail(message);
      }
    } finally {
      attempt.finish();
    }
  }

  // ─── File handlers ─────────────────────────────────────────────────
  const handleFilePick = async (nextFile: File | null) => {
    if (finalizing || fileReplacementInFlightRef.current) return;
    if (nextFile && !isAudioFile(nextFile)) {
      toast("Please choose a supported audio file.", "error");
      return;
    }
    if (nextFile && nextFile.size > AUDIO_UPLOAD_MAX_BYTES) {
      setUploadError(FILE_TOO_LARGE_MESSAGE);
      toast(FILE_TOO_LARGE_MESSAGE, "error");
      return;
    }

    fileReplacementInFlightRef.current = true;
    try {
      const previous = activeStagedUploadRef.current;
      if (previous && !(await retireStagedUpload(previous))) return;

      setUploadError(null);
      setProgress(0);
      setFile(nextFile);
      if (!nextFile) {
        setTransferStatus("idle");
        return;
      }
      void startStagedAudioTransfer(nextFile);
    } finally {
      fileReplacementInFlightRef.current = false;
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    event.target.value = "";
    void handleFilePick(nextFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const nextFile = event.dataTransfer.files[0] ?? null;
    void handleFilePick(nextFile);
  };

  async function retryStagedTransfer(): Promise<void> {
    const attempt = activeStagedUploadRef.current;
    if (finalizing || blockOfflineUpload()) return;
    if (!attempt) {
      if (file) await startStagedAudioTransfer(file);
      return;
    }
    const retryFile = attempt.file;
    if (!(await retireStagedUpload(attempt))) return;
    setTransferStatus("idle");
    setUploadError(null);
    await startStagedAudioTransfer(retryFile);
  }

  const handleClose = () => {
    if (finalizing || closingRef.current) return;
    closingRef.current = true;
    const active = activeStagedUploadRef.current;
    if (active) {
      active.abandonRequested = true;
      requestUploadCancellation(active.cancellation);
      active.putAbort.abort();
      void cancelManagedUpload(active.managed.id).then(async (managedCanceled) => {
        if (managedCanceled) return;
        const result = await active.cancel();
        if (result.ok) active.managed.dismiss();
      });
    }
    onClose();
  };

  function versionHref(versionId: string): string {
    const requestedOrigin = searchParams.get("from");
    const projectOrigin = pathname.startsWith("/dashboard/clients-projects/")
      ? selectedProjectId
      : requestedOrigin;
    const base = `/dashboard/music/${encodeURIComponent(versionId)}`;
    return projectOrigin ? `${base}?from=${encodeURIComponent(projectOrigin)}` : base;
  }

  function finishSuccessfulUpload(managed: ManagedUploadHandle, versionId: string) {
    managed.succeed();
    toast("Upload complete", "success");
    onCreated?.();
    router.refresh();
    // Some callers canonicalize their modal-close route. Close first, then
    // make the exact Version replacement last so it cannot be overwritten.
    closingRef.current = true;
    onClose();
    router.replace(versionHref(versionId));
  }

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blockOfflineUpload() || submitDisabled) return;
    const attempt = activeStagedUploadRef.current;
    if (!attempt?.intentId) return;

    const submittedIntentId = attempt.intentId;
    const submittedProjectId = selectedProjectId;
    const submittedTrackId = selectedTrackId;
    const submittedTitle = newSongName.trim();
    const submittedLabel = isNewSong ? "V1" : label.trim();
    const submittedDescription = description.trim();
    const submittedStage = stage;
    const acknowledgesPublicExposure = selectedPublicExposure !== "none";
    attempt.managed.setCompleting();
    setUploadError(null);

    startTransition(async () => {
      try {
        const durationMs = await attempt.duration;
        const result = await finalizeAudioUploadAction({
          intentId: submittedIntentId,
          destination: isNewSong
            ? {
                kind: "new-song",
                projectId: submittedProjectId,
                title: submittedTitle,
              }
            : {
                kind: "new-version",
                projectId: submittedProjectId,
                trackId: submittedTrackId,
              },
          label: submittedLabel,
          ...(submittedDescription ? { description: submittedDescription } : {}),
          ...(durationMs ? { durationMs } : {}),
          acknowledgePublicExposure: acknowledgesPublicExposure,
        });
        if (!result.ok) throw new Error(result.error);

        if (submittedStage !== "no-change") {
          const stageResult = await setTrackStageAction({
            trackId: result.data.trackId,
            workflowStage: submittedStage,
          });
          if (!stageResult.ok) {
            toast(`Uploaded — but stage didn't update: ${stageResult.error}`, "error");
          }
        }
        if (isCurrentStagedUpload(attempt)) {
          activeStagedUploadRef.current = null;
          setStagedIntentId(null);
        }
        finishSuccessfulUpload(attempt.managed, result.data.versionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : uploadStageFailure("completion");
        setUploadError(message);
        setTransferStatus("ready");
        attempt.managed.setCancel(async () => {
          const result = await attempt.cancel();
          return { ok: result.ok };
        });
        attempt.managed.setReadyToSave();
        toast(message, "error");
      }
    });
  };

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
              }}
              onClick={handleClose}
              disabled={finalizing}
              className="-mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
            >
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-4">
              <div className="flex flex-col gap-3">
                <div
                  className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3"
                  aria-live="polite"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <StorageFigure
                      label="Used"
                      value={
                        storageUsageLoading
                          ? "Checking…"
                          : formatStorageBytes(storageUsage?.usedBytes)
                      }
                    />
                    <StorageFigure
                      label="Available"
                      value={
                        storageUsageLoading
                          ? "Checking…"
                          : formatStorageBytes(storageUsage?.availableBytes)
                      }
                    />
                  </div>
                  {file && storageUsage ? (
                    <div className="mt-2 border-t border-[rgb(var(--border-subtle))] pt-2 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                      After upload: {formatStorageBytes(projectedStorageBytes)} of 1 GB
                    </div>
                  ) : (
                    <div className="mt-2 border-t border-[rgb(var(--border-subtle))] pt-2 text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                      Beta audio limit: {formatStorageBytes(PRODUCER_AUDIO_STORAGE_LIMIT_BYTES)}
                    </div>
                  )}
                </div>

                {/* The file always comes first. Destination details appear only afterward. */}
                <div>
                  <FieldLabel htmlFor="upload-track-file" required>
                    Audio file
                  </FieldLabel>
                  <div
                    role="button"
                    aria-disabled={filePickerDisabled}
                    tabIndex={filePickerDisabled ? -1 : 0}
                    onClick={() => {
                      if (!filePickerDisabled) fileInputRef.current?.click();
                    }}
                    onKeyDown={(event) => {
                      if (!filePickerDisabled && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!filePickerDisabled) setIsDragging(true);
                    }}
                    onDragLeave={() => {
                      setIsDragging(false);
                    }}
                    onDrop={(event) => {
                      if (filePickerDisabled) {
                        event.preventDefault();
                        return;
                      }
                      handleDrop(event);
                    }}
                    className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-5 text-center transition-colors hover:bg-[rgb(17_16_9/0.04)] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
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
                          Drop an audio file here
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
                    disabled={filePickerDisabled}
                    onChange={handleFileInputChange}
                    className="sr-only"
                  />
                </div>

                {file ? (
                  <>
                    {mode === "library" ? (
                      <div
                        className={
                          showLibraryUploadDestination ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"
                        }
                      >
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
                              No Projects available for audio upload
                            </p>
                          ) : (
                            <Select
                              id="upload-track-project"
                              aria-label="Project"
                              value={selectedProjectId}
                              disabled={finalizing}
                              onChange={(event) => {
                                const nextProjectId = event.target.value;
                                const nextProject = projects.find(
                                  (candidate) => candidate.id === nextProjectId,
                                );
                                setSelectedProjectId(nextProjectId);
                                setSelectedTrackId(defaultLibraryUploadDestination(nextProject));
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
                        {showLibraryUploadDestination ? (
                          <div>
                            <FieldLabel htmlFor="upload-track-song" required>
                              Upload as
                            </FieldLabel>
                            <Select
                              id="upload-track-song"
                              value={selectedTrackId}
                              disabled={finalizing}
                              onChange={(event) => {
                                setSelectedTrackId(event.target.value);
                                setLabelTouched(false);
                              }}
                              className="mt-1"
                            >
                              {selectedProject?.canCreateNewSong ? (
                                <option value={NEW_SONG_DESTINATION}>New Song</option>
                              ) : null}
                              {destinationTracks.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  New Version — {candidate.title}
                                </option>
                              ))}
                            </Select>
                          </div>
                        ) : null}
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
                          disabled={finalizing}
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
                          disabled={finalizing}
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
                            disabled={finalizing}
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
                            disabled={finalizing}
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
                {transferVisible ? (
                  <div aria-live="polite">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full"
                      style={{ background: "rgb(17_16_9/0.08)" }}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                      aria-valuetext={
                        transferStatus === "ready"
                          ? "Audio ready to save"
                          : transferStatus === "cancelling"
                            ? "Stopping audio transfer"
                            : `Uploading audio, ${String(progress)} percent`
                      }
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
                      {transferStatus === "ready"
                        ? "Audio ready — finish the details, then save."
                        : transferStatus === "cancelling"
                          ? "Stopping audio transfer…"
                          : transferStatus === "preparing"
                            ? "Preparing secure audio transfer…"
                            : `Uploading audio… ${String(progress)}%`}
                    </p>
                  </div>
                ) : null}

                {file && projects.length === 0 && mode === "library" ? (
                  <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
                    No Project is currently ready for an audio upload.
                  </p>
                ) : null}

                {storageUsageError ? (
                  <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
                    {storageUsageError}
                  </p>
                ) : null}

                {storageLimitExceeded ? (
                  <div
                    id="upload-track-storage-error"
                    role="alert"
                    className="rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.1)] px-3 py-2.5 text-sm leading-snug text-[rgb(var(--fg-default))]"
                  >
                    <p>{AUDIO_STORAGE_FULL_MESSAGE}</p>
                    {storageUsage.isFull && storageUsage.reservedBytes > 0 ? (
                      <div className="mt-2">
                        <p className="text-xs text-[rgb(var(--fg-muted))]">
                          Cleanup only removes failed or canceled upload leftovers. It never removes
                          Songs or Versions.
                        </p>
                        <button
                          type="button"
                          onClick={() => void cleanUpOldUploads()}
                          disabled={storageUsageLoading}
                          className="mt-2 min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {storageUsageLoading ? "Cleaning up…" : "Clean up old uploads"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {storageWarningReached ? (
                  <p
                    role="status"
                    className="rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.1)] px-3 py-2.5 text-sm leading-snug text-[rgb(var(--fg-default))]"
                  >
                    {STORAGE_WARNING_MESSAGE}
                  </p>
                ) : null}

                {visibleUploadError ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                      id="upload-track-error"
                      role="alert"
                      className="text-sm text-[rgb(var(--fg-danger))]"
                    >
                      {visibleUploadError}
                    </p>
                    {file && transferStatus === "error" && !storageLimitExceeded ? (
                      <button
                        type="button"
                        onClick={() => void retryStagedTransfer()}
                        disabled={!online || finalizing}
                        className="sk-press min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 py-2 text-xs font-semibold text-[rgb(var(--fg-default))] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0"
                      >
                        Retry transfer
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {/* ─── Action row ─────────────────────────────────── */}
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleClose}
                disabled={finalizing}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] sm:min-h-0"
              >
                {finalizing
                  ? "Saving…"
                  : transferStatus === "preparing" || transferStatus === "uploading"
                    ? "Stop upload"
                    : "Cancel"}
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                aria-describedby={
                  storageLimitExceeded
                    ? "upload-track-storage-error"
                    : visibleUploadError
                      ? "upload-track-error"
                      : undefined
                }
                className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none sm:min-h-0"
                style={{ background: "rgb(var(--brand-primary))" }}
              >
                {finalizing
                  ? isNewSong
                    ? "Creating Song…"
                    : "Adding Version…"
                  : !online
                    ? "Reconnect to upload"
                    : transferStatus === "preparing" || transferStatus === "uploading"
                      ? "Uploading audio…"
                      : transferStatus === "cancelling"
                        ? "Stopping audio…"
                        : isNewSong
                          ? "Create Song"
                          : "Add Version"}
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

function StorageFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </div>
      <div className="mt-1 truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
        {value}
      </div>
    </div>
  );
}

// Derive the next sensible version label for a given track id. For a
// new song we suggest "V1"; otherwise V{N+1} based on the upstream
// versionCount. The producer can always overwrite.
function deriveNextLabel(tracks: UploadTrackModalTrack[], trackIdOrNew: string): string {
  if (trackIdOrNew === NEW_SONG_DESTINATION) return "V1";
  const t = tracks.find((row) => row.id === trackIdOrNew);
  const next = (t?.versionCount ?? 0) + 1;
  return `V${String(next)}`;
}

function formatBytes(bytes: number): string {
  return formatStorageBytes(bytes);
}

function formatStorageBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1_000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${trimTrailingZeros(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) return `${trimTrailingZeros(bytes / 1_000_000)} MB`;
  return `${trimTrailingZeros(bytes / 1_000_000_000, 2)} GB`;
}

function trimTrailingZeros(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.?0+$/, "");
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
