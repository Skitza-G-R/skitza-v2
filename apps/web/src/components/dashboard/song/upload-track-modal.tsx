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

import { useToast } from "~/components/ui/toast";
import { WORKFLOW_STAGES, type WorkflowStage } from "~/lib/clients/workflow-stage";
import {
  abortMultipartAction,
  addTrackAction,
  addVersionAction,
  completeMultipartAction,
  deleteVersionAction,
  initMultipartAction,
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

// UploadTrackModal — single modal that serves all 3 upload entry points
// (Album Songs tab "+ Add song", Song Space hero "Upload new version",
// Versions-tab AddVersionDropZone). DESIGN.md §6.4, BUILD-NOTES §7.3.
//
// Architecture decisions:
//   - Form fields: song picker / version label / stage (optional) /
//     description (optional) / file drop zone.
//   - Submit orchestrates the chain client-side: addTrack? -> addVersion
//     (audioUrl=null) -> initMultipart -> signPart×N -> chunked PUT to R2
//     -> completeMultipart -> setTrackStage (optional).
//   - 5MB chunks. signPart fires per-chunk; chunk PUT goes through
//     window.fetch (NOT a Server Action — chunked PUT must happen in
//     the browser to keep the body on the user's connection).
//   - Server Actions only. No client-side tRPC. Mirrors invite-modal /
//     new-client-modal precedent.
//   - On close mid-upload, fire abortMultipartAction to reclaim R2.
//
// Three modes selected by the parent:
//   - "new-song"    — "+ Add song" entry. Song picker shows "+ New song"
//                     plus any existing tracks; description applies to
//                     the new version.
//   - "new-version" — Song Space + drop-zone entries. trackId pre-locked
//                     so the song picker renders as plain text.
//
// Mode "new-version" without a trackId is invalid; the modal asserts
// at runtime by hiding the song picker and disabling submit.

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const NEW_SONG_VALUE = "__new__";

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

export interface UploadTrackModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Exact active purchase selected by the owned project read model. */
  purchaseId?: string | null;
  mode: "new-song" | "new-version";
  /** Pre-selected when mode === "new-version". Required for that mode. */
  trackId?: string;
  /** Pre-populated version label (e.g. "V4"). Falls back to V{versionCount+1}. */
  defaultLabel?: string;
  tracks: UploadTrackModalTrack[];
  /** Fired after the upload chain finishes — parent can refresh. */
  onCreated?: () => void;
}

export function UploadTrackModal({
  open,
  onClose,
  projectId,
  purchaseId,
  mode,
  trackId,
  defaultLabel,
  tracks,
  onCreated,
}: UploadTrackModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Form state ────────────────────────────────────────────────────
  // Song picker: in new-song mode, default to NEW_SONG_VALUE; in
  // new-version mode, the trackId locks the picker (no dropdown).
  const initialPick = mode === "new-version" && trackId ? trackId : NEW_SONG_VALUE;
  const [selectedTrackId, setSelectedTrackId] = useState<string>(initialPick);
  const [newSongName, setNewSongName] = useState("");
  const [label, setLabel] = useState(defaultLabel ?? "V1");
  const [stage, setStage] = useState<"no-change" | WorkflowStage>("no-change");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [allocatedNewTrackId, setAllocatedNewTrackId] = useState<string | null>(null);
  const [allocatedNewTrackTitle, setAllocatedNewTrackTitle] = useState<string | null>(null);

  // Active upload state — kept in a ref so the abort handler reads the
  // freshest value even if the user closes mid-upload before React
  // commits a re-render. The ref also lets us detect "in flight" for
  // the Cancel button's destructive label.
  const activeUploadRef = useRef<ActiveMultipartUpload | null>(null);
  const activeCancellationRef = useRef<UploadCancellationRequest | null>(null);
  // A new-song submit allocates its purchased song space before the
  // version and audio steps begin. Keep that exact track for retries in
  // this modal session so a later failure cannot consume another space.
  const allocatedNewTrackIdRef = useRef<string | null>(null);
  const songSpaceOperationKeyRef = useRef("");

  useEffect(() => startMultipartCancellationRecovery(), []);

  useEffect(() => {
    if (!open) {
      allocatedNewTrackIdRef.current = null;
      songSpaceOperationKeyRef.current = "";
      setAllocatedNewTrackId(null);
      setAllocatedNewTrackTitle(null);
    }
  }, [open]);

  // Reset every time the modal opens. Carrying state across open/close
  // is confusing — same precedent as new-client-modal.
  useEffect(() => {
    if (!open) return;
    const startPick = mode === "new-version" && trackId ? trackId : NEW_SONG_VALUE;
    setSelectedTrackId(startPick);
    setNewSongName("");
    setLabel(defaultLabel ?? deriveNextLabel(tracks, startPick));
    setStage("no-change");
    setDescription("");
    setFile(null);
    setProgress(0);
    setIsDragging(false);
    setAllocatedNewTrackTitle(null);
    activeUploadRef.current = null;
    songSpaceOperationKeyRef.current = crypto.randomUUID();
  }, [open, mode, trackId, defaultLabel, tracks]);

  // When the user picks a different existing track, auto-bump the
  // default label to V{N+1} for that track. We only do this if the
  // label is still "factory default" (empty or last derived) — once
  // the producer typed their own, we leave it alone.
  const derivedLabel = useMemo(
    () => deriveNextLabel(tracks, selectedTrackId),
    [tracks, selectedTrackId],
  );
  const [labelTouched, setLabelTouched] = useState(false);
  useEffect(() => {
    if (!labelTouched) {
      setLabel(defaultLabel ?? derivedLabel);
    }
  }, [derivedLabel, defaultLabel, labelTouched]);

  const isNewSong = selectedTrackId === NEW_SONG_VALUE;
  const selectedPublicExposure =
    tracks.find((track) => track.id === selectedTrackId)?.publicExposure ?? "none";
  const needsSongName = isNewSong && newSongName.trim().length === 0;
  const submitDisabled =
    pending ||
    !file ||
    label.trim().length === 0 ||
    needsSongName ||
    (isNewSong && !purchaseId && !allocatedNewTrackId) ||
    (mode === "new-version" && !trackId);

  // ─── File handlers ─────────────────────────────────────────────────
  const handleFilePick = (f: File | null) => {
    if (!f) {
      setFile(null);
      return;
    }
    if (!isAudioFile(f)) {
      toast("Please pick an audio file (WAV / MP3).", "error");
      return;
    }
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
  const handleClose = () => {
    allocatedNewTrackIdRef.current = null;
    setAllocatedNewTrackId(null);
    const cancellation = activeCancellationRef.current;
    if (cancellation) requestUploadCancellation(cancellation);
    // Publish and reconcile an exact cancellation. Keep the identity in
    // the ref until that finishes so any upload failure can safely await
    // the same idempotent cancellation before deleting its placeholder.
    const active = activeUploadRef.current;
    if (active) {
      const versionCleanup = markVersionCleanupRequested(active.trackVersionId);
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
    if (submitDisabled) return;
    // submitDisabled already guarantees `file !== null` (one of its
    // disqualifying predicates), so TS has narrowed file to File here.
    // We re-bind via const so the async closure below keeps the
    // narrowed type even after React re-renders.
    const submittedFile = file;
    const cancellation = createUploadCancellationRequest();
    activeCancellationRef.current = cancellation;

    startTransition(async () => {
      setProgress(0);
      // Track the version row id outside the try so a catch can clean up
      // the orphan when any later step (R2 init, chunk PUT, finalise)
      // fails. I1 — without this, a failed upload left a permanent
      // audioUrl=null row in the DB even after R2 multipart was aborted.
      let createdVersionId: string | null = null;
      let versionCleanup: ReturnType<typeof markVersionCleanupRequested> | null = null;
      try {
        // 1. Resolve trackId — create a new project_tracks row if the
        //    producer picked "+ New song", else use the existing id.
        const retainedTrackId = allocatedNewTrackIdRef.current;
        let resolvedTrackId = retainedTrackId ?? selectedTrackId;
        if (!retainedTrackId && isNewSong) {
          if (!purchaseId) {
            throw new Error("No active purchase has an available song space.");
          }
          const res = await addTrackAction({
            projectId,
            purchaseId,
            operationKey: songSpaceOperationKeyRef.current,
            title: newSongName.trim(),
          });
          if (!res.ok) throw new Error(res.error);
          // Closing while allocation was in flight ends the modal
          // session. Do not repopulate its retry identity afterward.
          if (uploadCancellationRequested(cancellation)) {
            throw new Error("Upload stopped.");
          }
          allocatedNewTrackIdRef.current = res.data.id;
          setAllocatedNewTrackId(res.data.id);
          setAllocatedNewTrackTitle(res.data.title);
          resolvedTrackId = res.data.id;
        }

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
        versionCleanup = markVersionCleanupRequested(versionId);
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
          });
          if (!putRes.ok) {
            throw new Error(`Part ${String(partNumber)} upload failed: ${String(putRes.status)}`);
          }
          if (uploadCancellationRequested(cancellation)) throw new Error("Upload stopped.");
          const eTag = (putRes.headers.get("ETag") ?? "").replaceAll('"', "");
          parts.push({ partNumber, eTag });
          markResumableProgress(recoveryEntry);
          setProgress(Math.round((parts.length / partCount) * 100));
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
        removeResumableEntry(uploadId);
        removeVersionCleanupEntry(versionId);
        activeUploadRef.current = null;

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
        allocatedNewTrackIdRef.current = null;
        setAllocatedNewTrackId(null);
        setAllocatedNewTrackTitle(null);
        toast("Upload complete", "success");
        onCreated?.();
        router.refresh();
        onClose();
      } catch (err) {
        // A pending multipart identity must be durably cancelled and
        // reconciled before its placeholder can be deleted. If cancel
        // fails, leave both the row and identity available for retry.
        if (versionCleanup === null && createdVersionId) {
          versionCleanup = markVersionCleanupRequested(createdVersionId);
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
        setProgress(0);
      } finally {
        if (activeCancellationRef.current === cancellation) {
          activeCancellationRef.current = null;
        }
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
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] overflow-y-auto rounded-[18px] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)] md:-translate-x-1/2 md:-translate-y-1/2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                {mode === "new-version" ? "Upload new version" : "Add song"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="upload-track-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                {mode === "new-version"
                  ? "Send a new mix for review."
                  : "Upload an audio file and we'll notify the artist."}
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

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            {/* ─── Song picker ─────────────────────────────────── */}
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
            ) : allocatedNewTrackId ? (
              <div>
                <FieldLabel htmlFor="upload-track-song-allocated">Song</FieldLabel>
                <p
                  id="upload-track-song-allocated"
                  className="mt-1 truncate rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))]"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                >
                  {allocatedNewTrackTitle ?? newSongName}
                </p>
                <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
                  This purchased song space is allocated. Retry the upload for this song.
                </p>
              </div>
            ) : (
              <div>
                <FieldLabel htmlFor="upload-track-song">Song</FieldLabel>
                <select
                  id="upload-track-song"
                  value={selectedTrackId}
                  disabled={pending}
                  onChange={(e) => {
                    setSelectedTrackId(e.target.value);
                    setLabelTouched(false);
                  }}
                  className="mt-1 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                >
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                  <option value={NEW_SONG_VALUE}>+ New song</option>
                </select>
                {isNewSong ? (
                  <input
                    id="upload-track-new-song-name"
                    type="text"
                    required
                    autoFocus
                    value={newSongName}
                    disabled={pending}
                    maxLength={120}
                    onChange={(e) => {
                      setNewSongName(e.target.value);
                    }}
                    placeholder="New song title"
                    className="mt-2 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                    style={{ borderColor: "rgb(var(--border-subtle))" }}
                  />
                ) : null}
              </div>
            )}

            {selectedPublicExposure !== "none" ? (
              <div
                role="status"
                className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.1)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[rgb(var(--fg-default))]"
              >
                <span className="font-semibold">This song is public.</span> When this upload
                finishes, the new version will appear on its{
                  selectedPublicExposure === "link"
                    ? " public link"
                    : selectedPublicExposure === "portfolio"
                      ? " portfolio"
                      : " public link and portfolio"
                } automatically.
              </div>
            ) : null}

            {/* ─── Version label ──────────────────────────────── */}
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
                  <FieldLabel htmlFor="upload-track-description">Notes for artist</FieldLabel>
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

            {/* ─── File drop zone ─────────────────────────────── */}
            <div>
              <FieldLabel htmlFor="upload-track-file" required>
                Audio file
              </FieldLabel>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => {
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
                className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-4 text-center transition-colors hover:bg-[rgb(17_16_9/0.04)]"
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
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                      {file.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))]">
                      {formatBytes(file.size)}
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
                accept="audio/*"
                onChange={handleFileInputChange}
                className="sr-only"
              />
            </div>

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

            {isNewSong && !purchaseId && !allocatedNewTrackId ? (
              <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
                No active purchase has an available song space.
              </p>
            ) : null}

            {/* ─── Action row ─────────────────────────────────── */}
            <div className="sticky bottom-0 -mx-5 mt-1 -mb-5 flex flex-col-reverse gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
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
                className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none sm:min-h-0"
                style={{ background: "rgb(var(--brand-primary))" }}
              >
                {pending ? "Uploading…" : "Upload"}
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
