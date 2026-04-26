"use client";

import { useRef, useState, type DragEvent } from "react";

// Story 05 — DropZone primitive for the Music tab redesign.
//
// Two variants share one component:
//   - "empty"  — full-bleed (~280px tall), main empty-state slot
//   - "pinned" — slim (~80px), pinned to the top of a populated list
//
// The component owns the visual + drag affordances. The actual upload
// kick-off (server action calls + multipart pipeline) lives in the
// parent via the `onFilesSelected` callback. Both drag-and-drop and
// click-to-pick funnel through that callback so the parent has one
// integration point regardless of how the user added the file.
//
// Multi-file is allowed because the acceptance criteria say "Multi-file
// drop: each file becomes its own track row by default." We pass File[]
// up; the parent decides what to do with each (typically: each becomes
// its own track via createTrackFromUploadAction).

interface DropZoneProps {
  variant: "empty" | "pinned";
  onFilesSelected: (files: File[]) => void;
  /**
   * Disable interaction during in-flight uploads — keeps the drop
   * affordance from kicking off another upload while the previous one
   * is still finishing.
   */
  disabled?: boolean;
  /**
   * Optional override on the empty-state copy. Defaults to "Drop audio
   * files or click to choose." which matches PRD §11.6.
   */
  emptyCopy?: string;
}

const ACCEPT_AUDIO = "audio/*,.wav,.mp3,.flac,.m4a,.aif,.aiff";

export function DropZone({
  variant,
  onFilesSelected,
  disabled = false,
  emptyCopy = "Drop audio files or click to choose.",
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Track drag-over state via a counter so child elements bubbling
  // their own dragenter/dragleave events don't cause flicker.
  const [dragDepth, setDragDepth] = useState(0);
  const isDragOver = dragDepth > 0;

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    setDragDepth((d) => d + 1);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    // preventDefault on dragOver is required to enable drop. Without
    // this, dropping a file on the zone would navigate the browser to
    // the file URL — same fix the AudioUploader's react-dropzone does
    // internally.
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragDepth(0);
    if (disabled) return;
    const list = e.dataTransfer.files;
    if (list.length === 0) return;
    onFilesSelected(Array.from(list));
  }

  function handleClick() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    // Enter / Space activate the file picker — matches button semantics
    // since the wrapper is role="button". Standard a11y pattern.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    onFilesSelected(Array.from(list));
    // Reset so the same file can be re-picked (browsers de-dupe by
    // path otherwise).
    e.target.value = "";
  }

  // ─── Variant styling ─────────────────────────────────────────────
  const isEmpty = variant === "empty";
  const sizeClasses = isEmpty
    ? "min-h-[280px] py-12"
    : "min-h-[80px] py-4";

  const baseClasses =
    "relative flex w-full flex-col items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed px-6 text-center transition-colors duration-150 ease-out cursor-pointer select-none";

  const focusClasses =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]";

  const stateClasses = isDragOver
    ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]";

  const disabledClasses = disabled ? "cursor-not-allowed opacity-60" : "";

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={isEmpty ? "Upload audio files" : "Add another track"}
      aria-disabled={disabled}
      data-drag-over={isDragOver}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        baseClasses,
        sizeClasses,
        focusClasses,
        stateClasses,
        disabledClasses,
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_AUDIO}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleInputChange}
      />
      {isEmpty ? (
        <>
          <p className="font-display text-lg text-[rgb(var(--fg-primary))]">
            {emptyCopy}
          </p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            WAV, MP3, FLAC, M4A or AIFF — up to 500 MB. Drop multiple files at
            once and each becomes its own track.
          </p>
        </>
      ) : (
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
          {isDragOver
            ? "Drop to add tracks…"
            : "Drop audio here or click to add another track."}
        </p>
      )}
    </div>
  );
}
