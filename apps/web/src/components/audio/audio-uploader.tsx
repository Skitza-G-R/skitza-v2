"use client";

import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";

import { cn } from "~/lib/cn";
import { useMultipartUpload } from "~/lib/audio/use-multipart-upload";

// AudioUploader — a drop-zone card wrapping `useMultipartUpload`.
//
// Presentational only: no ownership checks, no R2 calls. Those live in
// the hook + Server Actions. This component's job is the feel: a
// rack-panel-looking dashed card that reacts to drag, shows a live
// progress bar during multipart uploads, and surfaces plain-English
// errors for both client-side rejections (size/type) and server-side
// failures from the hook's internal state.
//
// The native file picker is opened via the visually hidden
// `getInputProps()` input — any click/keyboard activation on the root
// triggers it. `react-dropzone` handles focus management.

const MAX_SIZE_BYTES = 500 * 1024 * 1024;

interface AudioUploaderProps {
  trackVersionId: string;
  onComplete: (r: { url: string; key: string }) => void;
  className?: string;
}

export function AudioUploader({
  trackVersionId,
  onComplete,
  className,
}: AudioUploaderProps) {
  const { state, upload } = useMultipartUpload();
  const [rejectError, setRejectError] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[]) => {
      setRejectError(null);
      const f = accepted[0];
      if (!f) return;
      void upload({ file: f, trackVersionId, onComplete });
    },
    [upload, trackVersionId, onComplete],
  );

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const first = rejections[0]?.errors[0];
    if (!first) {
      setRejectError("That file wasn't accepted. Try another.");
      return;
    }
    if (first.code === "file-too-large") {
      setRejectError("File is too large. Max 500 MB.");
    } else if (first.code === "file-invalid-type") {
      setRejectError(
        "That's not an audio file. Try WAV, MP3, FLAC, M4A, or AIFF.",
      );
    } else {
      setRejectError(first.message);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { "audio/*": [".wav", ".mp3", ".flac", ".m4a", ".aiff"] },
    maxSize: MAX_SIZE_BYTES,
    multiple: false,
  });

  const busy =
    state.kind === "signing" ||
    state.kind === "uploading" ||
    state.kind === "completing";

  const progress =
    state.kind === "uploading"
      ? state.progress
      : state.kind === "completing"
        ? 100
        : 0;

  return (
    <div
      {...getRootProps()}
      aria-label="Upload audio file"
      className={cn(
        "relative flex min-h-[180px] flex-col items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed p-6 text-center transition-colors duration-150 ease-out cursor-pointer select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
        isDragActive
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--bg-overlay))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]",
        busy ? "cursor-wait" : "",
        className,
      )}
    >
      <input {...getInputProps()} />

      {state.kind === "idle" && rejectError === null && (
        <div>
          <p className="font-display text-lg text-[rgb(var(--fg-primary))]">
            Drop your track
          </p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            WAV, MP3, FLAC, M4A or AIFF — up to 500 MB
          </p>
        </div>
      )}

      {state.kind === "idle" && rejectError !== null && (
        <div>
          <p className="font-medium text-[rgb(var(--fg-danger))]">
            {rejectError}
          </p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            Click or drop another file to try again.
          </p>
        </div>
      )}

      {(state.kind === "signing" || state.kind === "uploading") && (
        <div className="w-full max-w-sm">
          <p className="text-sm tabular-nums text-[rgb(var(--fg-secondary))]">
            {state.kind === "signing"
              ? "Preparing…"
              : `Uploading · ${String(progress)}%`}
          </p>
          <div className="mt-3 h-1 w-full overflow-hidden rounded bg-[rgb(var(--bg-sunken))]">
            <div
              className="h-full bg-[rgb(var(--brand-primary))] transition-all duration-150 ease-out"
              style={{ width: `${String(progress)}%` }}
            />
          </div>
        </div>
      )}

      {state.kind === "completing" && (
        <p className="text-sm text-[rgb(var(--fg-muted))]">Finishing up…</p>
      )}

      {state.kind === "done" && (
        <p className="font-medium text-[rgb(var(--fg-success))]">
          Uploaded <span aria-hidden="true">✓</span>
        </p>
      )}

      {state.kind === "error" && (
        <div>
          <p className="font-medium text-[rgb(var(--fg-danger))]">
            {state.message}
          </p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            Click or drop another file to try again.
          </p>
        </div>
      )}
    </div>
  );
}
