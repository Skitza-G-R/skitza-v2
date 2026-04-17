"use client";

import { useCallback, useState } from "react";

import {
  abortAudioUpload,
  completeAudioUpload,
  initAudioUpload,
  signAudioPart,
} from "~/app/(app)/dashboard/audio-upload-actions";

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
const PART_SIZE = 5 * 1024 * 1024; // 5 MB per part

export type ResumableEntry = {
  uploadId: string;
  key: string;
  trackVersionId: string;
  completed: Array<{ partNumber: number; eTag: string }>;
  totalBytes: number;
};

// Enumerate in-progress uploads persisted to localStorage. Used by the
// dashboard to surface a "resume?" prompt on page load. Malformed
// entries are silently skipped rather than blocking the whole read.
export function resumableUploads(): ResumableEntry[] {
  if (typeof localStorage === "undefined") return [];
  const out: ResumableEntry[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as ResumableEntry);
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

export function useMultipartUpload() {
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  const upload = useCallback(
    async (opts: {
      file: File;
      trackVersionId: string;
      onComplete: (r: { url: string; key: string }) => void;
    }) => {
      setState({ kind: "signing" });
      const init = await initAudioUpload({
        trackVersionId: opts.trackVersionId,
        filename: opts.file.name,
        sizeBytes: opts.file.size,
        contentType: opts.file.type || "application/octet-stream",
      });
      if (!init.ok) {
        setState({ kind: "error", message: init.error });
        return;
      }
      const parts = computeParts(opts.file.size, PART_SIZE);
      const completed: Array<{ partNumber: number; eTag: string }> = [];
      setState({ kind: "uploading", progress: 0 });
      for (const p of parts) {
        const signed = await signAudioPart({
          key: init.data.key,
          uploadId: init.data.uploadId,
          partNumber: p.partNumber,
        });
        if (!signed.ok) {
          setState({ kind: "error", message: signed.error });
          return;
        }
        const blob = opts.file.slice(p.start, p.end);
        let resp: Response;
        try {
          resp = await fetch(signed.data.url, { method: "PUT", body: blob });
        } catch (e) {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : "Network error",
          });
          return;
        }
        if (!resp.ok) {
          setState({
            kind: "error",
            message: `Part ${String(p.partNumber)} failed (HTTP ${String(resp.status)})`,
          });
          return;
        }
        const eTag = (resp.headers.get("etag") ?? "").replace(/"/g, "");
        completed.push({ partNumber: p.partNumber, eTag });
        const entry: ResumableEntry = {
          uploadId: init.data.uploadId,
          key: init.data.key,
          trackVersionId: opts.trackVersionId,
          completed,
          totalBytes: opts.file.size,
        };
        localStorage.setItem(
          `${STORAGE_PREFIX}${init.data.uploadId}`,
          JSON.stringify(entry),
        );
        setState({
          kind: "uploading",
          progress: Math.round((completed.length / parts.length) * 100),
        });
      }
      setState({ kind: "completing" });
      const done = await completeAudioUpload({
        key: init.data.key,
        uploadId: init.data.uploadId,
        parts: completed,
        trackVersionId: opts.trackVersionId,
        sizeBytes: opts.file.size,
      });
      if (!done.ok) {
        setState({ kind: "error", message: done.error });
        return;
      }
      localStorage.removeItem(`${STORAGE_PREFIX}${init.data.uploadId}`);
      setState({ kind: "done", url: done.data.url, key: done.data.key });
      opts.onComplete({ url: done.data.url, key: done.data.key });
    },
    [],
  );

  const cancel = useCallback(
    async (entry: { uploadId: string; key: string }) => {
      await abortAudioUpload(entry);
      localStorage.removeItem(`${STORAGE_PREFIX}${entry.uploadId}`);
    },
    [],
  );

  return { state, upload, cancel };
}
