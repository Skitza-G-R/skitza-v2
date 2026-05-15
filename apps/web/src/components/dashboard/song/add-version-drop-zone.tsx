"use client";

import { type DragEvent, useState } from "react";
import { Plus } from "lucide-react";

// AddVersionDropZone — the slim drop-zone that sits as the FIRST row of
// the Versions tab in the Song Space (DESIGN.md §4.4, BUILD-NOTES §5.4).
// Reuses the VersionRow grid geometry so it slots in flush above the
// version list.
//
// Phase 4 wires this to the Upload Track modal: when the parent passes
// `onClick`, the row is clickable AND accepts dragged files (the file
// goes into the modal's pre-populate slot via `onFileDrop`). Without
// `onClick`, the row falls back to a disabled stub (defensive — most
// real callers do pass it).

interface AddVersionDropZoneProps {
  /** Phase 4 — opens the Upload Track modal. Disabled when not passed. */
  onClick?: () => void;
  /**
   * Phase 4 — fires when a file is dropped onto the row, BEFORE the
   * modal opens. Optional: if absent, the drop still triggers `onClick`
   * but the file is dropped on the floor. Stretch goal: pre-populate
   * the modal's file slot via this callback — left for a follow-up.
   */
  onFileDrop?: (file: File) => void;
}

export function AddVersionDropZone({
  onClick,
  onFileDrop,
}: AddVersionDropZoneProps) {
  const disabled = !onClick;
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    // `disabled === !onClick`, so this guard implies onClick is set.
    if (!onClick) return;
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && onFileDrop) onFileDrop(file);
    // Whether or not we had a file, treat the drop as "open the modal"
    // so the producer doesn't lose their click in a silent failure.
    onClick();
  };
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      disabled={disabled}
      aria-label="Add a new version"
      data-dragging={isDragging || undefined}
      className="group relative grid w-full items-center gap-3 rounded-[var(--radius-md)] border border-dashed px-3 py-2 text-left transition-colors hover:bg-[rgb(var(--bg-elevated))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent"
      style={{
        gridTemplateColumns: "36px minmax(0,1fr) 48px 48px 56px 32px",
        borderColor: "rgb(var(--brand-primary)/0.40)",
        background: "rgb(var(--brand-primary)/0.04)",
      }}
    >
      {/* 1 — "+" circle icon (replaces the cover tile) */}
      <span
        aria-hidden
        className="relative z-10 inline-flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border"
        style={{
          background: "rgb(var(--brand-primary)/0.12)",
          borderColor: "rgb(var(--brand-primary)/0.40)",
          color: "rgb(var(--brand-primary))",
        }}
      >
        <Plus size={18} />
      </span>

      {/* 2 — Headline + hint (occupies the title+meta cell) */}
      <div className="relative z-10 min-w-0">
        <p
          className="truncate text-[14px] font-medium leading-tight"
          style={{ color: "rgb(var(--brand-primary))" }}
        >
          Add a new version
        </p>
        <p
          className="mt-0.5 truncate text-[11px]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          Drop WAV / MP3 here, or click to browse
        </p>
      </div>

      {/* 3-6 — Empty placeholder cells. We keep them in the DOM (as
              empty spans) so the row's grid columns line up perfectly
              with every VersionRow below it. */}
      <span aria-hidden className="relative z-10" />
      <span aria-hidden className="relative z-10" />
      <span aria-hidden className="relative z-10" />
      <span aria-hidden className="relative z-10" />
    </button>
  );
}
