"use client";

import Link from "next/link";
import type { DragEvent } from "react";
import { ChevronRight, GripVertical } from "lucide-react";

import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import {
  stageColor,
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";

// The Album Page tracklist row.
//
// Grid columns (verbatim from BUILD-NOTES §6.4):
//   22px · 30px · 38px · minmax(0,1fr) · 130px · 180px · 22px
//   ──── ─── ──── ─────────────── ───── ───── ───
//   drag  idx  cover  title + meta  stage pill  progress  chevron
//
// Container is a <div draggable>; navigation is handled by a Link
// overlaid via `absolute inset-0 z-0`. Cells layer above the overlay
// with `relative z-10` so the link still receives clicks that fall on
// gaps. This mirrors the ClientCard/ProjectRow reorder protocol and
// avoids the browser-level "draggable anchor" footgun where a
// near-drag-then-release on an <a> can hijack the click into a drag
// with no drop and never navigate.

export interface TrackRowData {
  id: string;
  title: string;
  workflowStage: WorkflowStage;
  /** 0..100 — drives the trailing progress bar. */
  progress: number;
  /** Latest version label (e.g. "v3", "Master") — optional. */
  currentVersion?: string;
  /** Number of unresolved comments across all versions — optional. */
  noteCount?: number;
  /** Duration of the latest version in ms — optional. */
  durationMs?: number;
}

export interface TrackRowProps {
  projectId: string;
  track: TrackRowData;
  /** 1-based row index (rendered as "01", "02"…). */
  index: number;
  onDragStart?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, id: string) => void;
}

// Inline mm:ss formatter — duplicated from persistent-player's
// `fmtTime` because that module is "use client" and pulls a heavy
// dependency tree we don't need here for a 4-line formatter.
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

export function TrackRow({
  projectId,
  track,
  index,
  onDragStart,
  onDragOver,
  onDrop,
}: TrackRowProps) {
  const indexLabel = String(index).padStart(2, "0");
  const coverBg = producerGradient(track.title);
  const stageHue = stageColor(track.workflowStage);
  const clampedProgress = Math.max(0, Math.min(100, Math.round(track.progress)));

  // Meta line — version · notes · duration. Each segment is optional;
  // a track with no version yet (no audio uploaded) shows just the title.
  const metaParts: string[] = [];
  if (track.currentVersion) metaParts.push(track.currentVersion);
  if (typeof track.noteCount === "number" && track.noteCount > 0) {
    metaParts.push(`${String(track.noteCount)} note${track.noteCount === 1 ? "" : "s"}`);
  }
  if (typeof track.durationMs === "number" && track.durationMs > 0) {
    metaParts.push(formatDuration(track.durationMs));
  }
  const meta = metaParts.join(" · ");

  return (
    <div
      draggable="true"
      data-id={track.id}
      onDragStart={onDragStart ? (e) => { onDragStart(e, track.id); } : undefined}
      onDragOver={onDragOver ? (e) => { onDragOver(e, track.id); } : undefined}
      onDrop={onDrop ? (e) => { onDrop(e, track.id); } : undefined}
      className="group relative grid items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2 transition-colors hover:bg-[rgb(var(--bg-elevated))]"
      style={{
        gridTemplateColumns: "22px 30px 38px minmax(0,1fr) 130px 180px 22px",
        borderColor: "rgb(var(--border-subtle))",
        background: "rgb(var(--bg-background))",
      }}
    >
      <Link
        href={`/dashboard/clients-projects/${projectId}/songs/${track.id}`}
        className="absolute inset-0 z-0 rounded-[var(--radius-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        aria-label={`Open ${track.title}`}
      />

      {/* 1 — Drag handle (hidden until group hover) */}
      <span
        aria-hidden
        className="relative z-10 flex h-5 w-5 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        <GripVertical size={14} />
      </span>

      {/* 2 — Index (mono "01", "02"…) */}
      <span
        className="relative z-10 font-mono text-[12px] tabular-nums"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {indexLabel}
      </span>

      {/* 3 — 38px gradient cover tile */}
      <span
        aria-hidden
        className="relative z-10 h-[38px] w-[38px] shrink-0 rounded-[var(--radius-sm)]"
        style={{ background: coverBg }}
      />

      {/* 4 — Title + meta (truncates) */}
      <div className="relative z-10 min-w-0">
        <p
          className="truncate text-[14px] font-medium leading-tight transition-colors group-hover:text-[rgb(var(--brand-primary))]"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          {track.title}
        </p>
        {meta ? (
          <p
            className="mt-0.5 truncate text-[11px]"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            {meta}
          </p>
        ) : null}
      </div>

      {/* 5 — Stage pill (colored dot + label) */}
      <span
        className="relative z-10 inline-flex items-center gap-1.5 self-center justify-self-start rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
        style={{
          color: stageHue,
          borderColor: stageHue,
          background: "transparent",
        }}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: stageHue }}
        />
        {stageLabel(track.workflowStage)}
      </span>

      {/* 6 — Progress bar + % */}
      <div className="relative z-10 flex items-center gap-2">
        <div
          className="relative h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: "rgb(var(--border-subtle))" }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${String(clampedProgress)}%`,
              background: "rgb(var(--brand-primary))",
            }}
          />
        </div>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {clampedProgress}%
        </span>
      </div>

      {/* 7 — Chevron (decorative — the whole row is the link) */}
      <span
        aria-hidden
        className="relative z-10 flex h-5 w-5 items-center justify-center"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        <ChevronRight size={16} />
      </span>
    </div>
  );
}
