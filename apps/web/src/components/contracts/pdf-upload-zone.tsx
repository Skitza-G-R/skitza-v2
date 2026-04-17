"use client";

import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";

import { cn } from "~/lib/cn";
import { uploadPdf, createDraftContract } from "~/app/(app)/dashboard/contracts/actions";

// Specialised dropzone for .pdf files — mirrors audio-uploader.tsx's
// feel but routes through the contract.uploadPdf path (presigned PUT
// to R2, then createDraft to mint the row). On success we hand the
// new contract id back to the parent, which redirects into the
// editor.
//
// State machine:
//   idle → signing → uploading → creating → done
//   any step can go to error with a human-readable message. We never
//   automatically retry; surface the error and let the producer drop
//   the file again.

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "uploading"; progress: number }
  | { kind: "creating" }
  | { kind: "error"; message: string };

const MAX_PDF_BYTES = 50 * 1024 * 1024;

interface PdfUploadZoneProps {
  defaultTitle?: string;
  onCreated: (contractId: string) => void;
  className?: string;
}

export function PdfUploadZone({
  defaultTitle,
  onCreated,
  className,
}: PdfUploadZoneProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const handleFile = useCallback(
    async (file: File) => {
      setPhase({ kind: "signing" });
      const signed = await uploadPdf({
        filename: file.name,
        sizeBytes: file.size,
      });
      if (!signed.ok) {
        setPhase({ kind: "error", message: signed.error });
        return;
      }

      // XHR gives us upload progress — fetch doesn't. Small but the UX
      // difference on a 30MB PDF over spotty wifi is the whole point of
      // showing a progress bar at all.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.data.url);
        xhr.setRequestHeader("Content-Type", "application/pdf");
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setPhase({ kind: "uploading", progress: pct });
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed (${String(xhr.status)})`));
        });
        xhr.addEventListener("error", () => {
          reject(new Error("Upload failed — network error."));
        });
        xhr.send(file);
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        setPhase({ kind: "error", message: msg });
        throw err;
      });

      setPhase({ kind: "creating" });
      const title =
        defaultTitle?.trim() || file.name.replace(/\.pdf$/i, "") || "Untitled contract";
      const created = await createDraftContract({
        title,
        pdfR2Key: signed.data.key,
      });
      if (!created.ok) {
        setPhase({ kind: "error", message: created.error });
        return;
      }
      onCreated(created.data.id);
    },
    [defaultTitle, onCreated],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const f = accepted[0];
      if (!f) return;
      void handleFile(f).catch(() => {
        // errors already surfaced via setPhase
      });
    },
    [handleFile],
  );

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const first = rejections[0]?.errors[0];
    if (!first) {
      setPhase({ kind: "error", message: "That file wasn't accepted." });
      return;
    }
    if (first.code === "file-too-large") {
      setPhase({ kind: "error", message: "PDF too large. Max 50 MB." });
    } else if (first.code === "file-invalid-type") {
      setPhase({ kind: "error", message: "Only .pdf files are supported." });
    } else {
      setPhase({ kind: "error", message: first.message });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { "application/pdf": [".pdf"] },
    maxSize: MAX_PDF_BYTES,
    multiple: false,
    disabled:
      phase.kind === "signing" ||
      phase.kind === "uploading" ||
      phase.kind === "creating",
  });

  const busy =
    phase.kind === "signing" ||
    phase.kind === "uploading" ||
    phase.kind === "creating";

  return (
    <div
      {...getRootProps()}
      aria-label="Upload PDF contract"
      className={cn(
        "relative flex min-h-[240px] flex-col items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed p-8 text-center transition-colors duration-150 ease-out cursor-pointer select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
        isDragActive
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--bg-overlay))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]",
        busy ? "cursor-wait" : "",
        className,
      )}
    >
      <input {...getInputProps()} />

      {phase.kind === "idle" && (
        <div>
          <p className="font-display text-xl text-[rgb(var(--fg-primary))]">
            Drop your contract PDF
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">
            .pdf, up to 50 MB. You&apos;ll place signature fields on the pages next.
          </p>
        </div>
      )}

      {phase.kind === "signing" && (
        <p className="text-sm text-[rgb(var(--fg-secondary))]">Preparing upload…</p>
      )}

      {phase.kind === "uploading" && (
        <div className="w-full max-w-sm">
          <p className="text-sm tabular-nums text-[rgb(var(--fg-secondary))]">
            Uploading · {String(phase.progress)}%
          </p>
          <div className="mt-3 h-1 w-full overflow-hidden rounded bg-[rgb(var(--bg-sunken))]">
            <div
              className="h-full bg-[rgb(var(--brand-primary))] transition-all duration-150 ease-out"
              style={{ width: `${String(phase.progress)}%` }}
            />
          </div>
        </div>
      )}

      {phase.kind === "creating" && (
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
          Creating draft contract…
        </p>
      )}

      {phase.kind === "error" && (
        <div>
          <p className="font-medium text-[rgb(var(--fg-danger))]">{phase.message}</p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            Drop another file to try again.
          </p>
        </div>
      )}
    </div>
  );
}
