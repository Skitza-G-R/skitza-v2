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
import {
  WORKFLOW_STAGES,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";
import {
  abortMultipartAction,
  addTrackAction,
  addVersionAction,
  completeMultipartAction,
  initMultipartAction,
  setTrackStageAction,
  signPartAction,
} from "~/app/(producer)/dashboard/clients-projects/upload-actions";

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

export interface UploadTrackModalTrack {
  id: string;
  title: string;
  /** Used to auto-bump the default version label (v{N+1}). */
  versionCount: number;
}

export interface UploadTrackModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  mode: "new-song" | "new-version";
  /** Pre-selected when mode === "new-version". Required for that mode. */
  trackId?: string;
  /** Pre-populated version label (e.g. "v4"). Falls back to v{versionCount+1}. */
  defaultLabel?: string;
  tracks: UploadTrackModalTrack[];
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
  const initialPick =
    mode === "new-version" && trackId
      ? trackId
      : NEW_SONG_VALUE;
  const [selectedTrackId, setSelectedTrackId] = useState<string>(initialPick);
  const [newSongName, setNewSongName] = useState("");
  const [label, setLabel] = useState(defaultLabel ?? "v1");
  const [stage, setStage] = useState<"no-change" | WorkflowStage>(
    "no-change",
  );
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);

  // Active upload state — kept in a ref so the abort handler reads the
  // freshest value even if the user closes mid-upload before React
  // commits a re-render. The ref also lets us detect "in flight" for
  // the Cancel button's destructive label.
  const activeUploadRef = useRef<{ key: string; uploadId: string } | null>(
    null,
  );

  // Reset every time the modal opens. Carrying state across open/close
  // is confusing — same precedent as new-client-modal.
  useEffect(() => {
    if (!open) return;
    const startPick =
      mode === "new-version" && trackId ? trackId : NEW_SONG_VALUE;
    setSelectedTrackId(startPick);
    setNewSongName("");
    setLabel(defaultLabel ?? deriveNextLabel(tracks, startPick));
    setStage("no-change");
    setDescription("");
    setFile(null);
    setProgress(0);
    setIsDragging(false);
    activeUploadRef.current = null;
  }, [open, mode, trackId, defaultLabel, tracks]);

  // When the user picks a different existing track, auto-bump the
  // default label to v{N+1} for that track. We only do this if the
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
  const needsSongName = isNewSong && newSongName.trim().length === 0;
  const submitDisabled =
    pending ||
    !file ||
    label.trim().length === 0 ||
    needsSongName ||
    (mode === "new-version" && !trackId);

  // ─── File handlers ─────────────────────────────────────────────────
  const handleFilePick = (f: File | null) => {
    if (!f) {
      setFile(null);
      return;
    }
    if (!f.type.startsWith("audio/")) {
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
    // If an upload is mid-flight, abort R2 to reclaim storage. Best
    // effort — we still close the modal even if the abort fails.
    const active = activeUploadRef.current;
    if (active) {
      void abortMultipartAction({
        key: active.key,
        uploadId: active.uploadId,
      });
      activeUploadRef.current = null;
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

    startTransition(async () => {
      setProgress(0);
      try {
        // 1. Resolve trackId — create a new project_tracks row if the
        //    producer picked "+ New song", else use the existing id.
        let resolvedTrackId = selectedTrackId;
        if (isNewSong) {
          const res = await addTrackAction({
            projectId,
            title: newSongName.trim(),
          });
          if (!res.ok) throw new Error(res.error);
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
          ...(trimmedDescription.length > 0
            ? { description: trimmedDescription }
            : {}),
        });
        if (!vres.ok) throw new Error(vres.error);
        const versionId = vres.data.id;

        // 3. Init multipart upload on R2.
        const ires = await initMultipartAction({
          trackVersionId: versionId,
          filename: submittedFile.name,
          sizeBytes: submittedFile.size,
          contentType: submittedFile.type || "audio/mpeg",
        });
        if (!ires.ok) throw new Error(ires.error);
        const { uploadId, key } = ires.data;
        activeUploadRef.current = { uploadId, key };

        // 4. Slice + sign + PUT each chunk in series. We stay serial
        //    rather than parallel so the progress bar tracks honestly
        //    and a network blip aborts cleanly without orphaning N
        //    parallel signed URLs.
        const partCount = Math.max(
          1,
          Math.ceil(submittedFile.size / CHUNK_SIZE),
        );
        const parts: { partNumber: number; eTag: string }[] = [];
        for (let i = 0; i < partCount; i++) {
          const partNumber = i + 1;
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, submittedFile.size);
          const chunk = submittedFile.slice(start, end);

          const sres = await signPartAction({ key, uploadId, partNumber });
          if (!sres.ok) throw new Error(sres.error);

          const putRes = await fetch(sres.data.url, {
            method: "PUT",
            body: chunk,
          });
          if (!putRes.ok) {
            // Cleanup before bubbling up — leaves R2 in a tidy state.
            await abortMultipartAction({ key, uploadId });
            activeUploadRef.current = null;
            throw new Error(
              `Part ${String(partNumber)} upload failed: ${String(putRes.status)}`,
            );
          }
          const eTag = (putRes.headers.get("ETag") ?? "").replaceAll('"', "");
          parts.push({ partNumber, eTag });
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

        // 6. Finalise the multipart on R2 + patch the trackVersion row.
        const cres = await completeMultipartAction({
          key,
          uploadId,
          parts,
          trackVersionId: versionId,
          sizeBytes: submittedFile.size,
          ...(durationMs ? { durationMs } : {}),
        });
        if (!cres.ok) throw new Error(cres.error);
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
            toast(
              `Uploaded — but stage didn't update: ${stres.error}`,
              "error",
            );
          }
        }

        toast("Upload complete", "success");
        onCreated?.();
        router.refresh();
        onClose();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Upload failed. Please retry.";
        toast(msg, "error");
        setProgress(0);
        activeUploadRef.current = null;
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
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[520px] rounded-[18px] bg-[rgb(var(--bg-background))] p-6 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
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
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="sk-press -mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            {/* ─── Song picker ─────────────────────────────────── */}
            {mode === "new-version" && trackId ? (
              <div>
                <FieldLabel htmlFor="upload-track-song-locked">
                  Song
                </FieldLabel>
                <p
                  id="upload-track-song-locked"
                  className="mt-1 truncate rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))]"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                >
                  {lockedSongTitle}
                </p>
              </div>
            ) : (
              <div>
                <FieldLabel htmlFor="upload-track-song">Song</FieldLabel>
                <select
                  id="upload-track-song"
                  value={selectedTrackId}
                  onChange={(e) => {
                    setSelectedTrackId(e.target.value);
                    setLabelTouched(false);
                  }}
                  className="mt-1 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
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
                    maxLength={120}
                    onChange={(e) => {
                      setNewSongName(e.target.value);
                    }}
                    placeholder="New song title"
                    className="mt-2 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                    style={{ borderColor: "rgb(var(--border-subtle))" }}
                  />
                ) : null}
              </div>
            )}

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
                placeholder="v2 / Mix / Master"
                className="mt-1 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              />
            </div>

            {/* ─── Stage selector ─────────────────────────────── */}
            <div>
              <FieldLabel htmlFor="upload-track-stage">
                Advance to stage{" "}
                <span className="text-[rgb(var(--fg-muted))]">(optional)</span>
              </FieldLabel>
              <select
                id="upload-track-stage"
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value as "no-change" | WorkflowStage);
                }}
                className="mt-1 w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
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

            {/* ─── Description ────────────────────────────────── */}
            <div>
              <FieldLabel htmlFor="upload-track-description">
                Description{" "}
                <span className="text-[rgb(var(--fg-muted))]">(optional)</span>
              </FieldLabel>
              <textarea
                id="upload-track-description"
                value={description}
                rows={2}
                maxLength={500}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                placeholder="Notes for the artist about this version"
                className="mt-1 w-full resize-y rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              />
            </div>

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
                className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-6 text-center transition-colors hover:bg-[rgb(17_16_9/0.04)]"
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

            {/* ─── Action row ─────────────────────────────────── */}
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={pending}
                className="sk-press inline-flex items-center justify-center rounded-[10px] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                className="sk-press inline-flex items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none"
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
      className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
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
// new song we suggest "v1"; otherwise v{N+1} based on the upstream
// versionCount. The producer can always overwrite.
function deriveNextLabel(
  tracks: UploadTrackModalTrack[],
  trackIdOrNew: string,
): string {
  if (trackIdOrNew === NEW_SONG_VALUE) return "v1";
  const t = tracks.find((row) => row.id === trackIdOrNew);
  const next = (t?.versionCount ?? 0) + 1;
  return `v${String(next)}`;
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
