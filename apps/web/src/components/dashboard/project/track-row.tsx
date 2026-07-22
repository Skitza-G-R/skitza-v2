"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import {
  stageColor,
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";

// The Album Page tracklist row.
//
// Grid columns (verbatim from BUILD-NOTES §6.4):
//   30px · 38px · minmax(0,1fr) · 130px · 180px · 22px
//   ──── ──── ─────────────── ───── ───── ───
//   idx  cover  title + meta  stage pill  progress  chevron
//
// The semantic Link is the row container, so every visible desktop and
// mobile cell — including whitespace — has the same navigation target.
// Reorder UI stays absent until a persisted album-track ordering
// contract exists.

export interface TrackRowData {
  id: string;
  title: string;
  /** Optional artist credit shown to listeners. */
  artist: string | null;
  workflowStage: WorkflowStage;
  /** 0..100 — drives the trailing progress bar. */
  progress: number;
  /** Latest version label (e.g. "v3", "Master") — optional. */
  currentVersion?: string;
  /** Number of unresolved comments across all versions — optional. */
  noteCount?: number;
  /** Duration of the latest version in ms — optional. */
  durationMs?: number;
  /**
   * Total number of versions for this track. Drives the auto-bumped
   * default version label in the UploadTrackModal (v{N+1}). Defaults
   * to 0 if the parent doesn't supply it.
   */
  versionCount?: number;
}

export interface TrackRowProps {
  projectId: string;
  track: TrackRowData;
  /** 1-based row index (rendered as "01", "02"…). */
  index: number;
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

export function TrackRow({ projectId, track, index }: TrackRowProps) {
  const indexLabel = String(index).padStart(2, "0");
  const coverBg = producerGradient(track.title);
  const stageHue = stageColor(track.workflowStage);
  const clampedProgress = Math.max(0, Math.min(100, Math.round(track.progress)));

  // Meta line — version · notes · duration. Each segment is optional;
  // a track with no version yet (no audio uploaded) shows just the title.
  const metaParts: string[] = [];
  if (track.artist) metaParts.push(track.artist);
  if (track.currentVersion) metaParts.push(track.currentVersion);
  if (typeof track.noteCount === "number" && track.noteCount > 0) {
    metaParts.push(`${String(track.noteCount)} note${track.noteCount === 1 ? "" : "s"}`);
  }
  if (typeof track.durationMs === "number" && track.durationMs > 0) {
    metaParts.push(formatDuration(track.durationMs));
  }
  const meta = metaParts.join(" · ");

  return (
    <Link
      href={`/dashboard/clients-projects/${projectId}/songs/${track.id}`}
      className="group relative block rounded-[var(--radius-md)] border transition-colors hover:bg-[rgb(var(--bg-elevated))] active:bg-[rgb(var(--bg-elevated))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        background: "rgb(var(--bg-background))",
      }}
      aria-label={`Open ${track.title}`}
    >
      {/* Desktop (md+) — six-column grid. Hidden below md because the
          fixed tracks (~420px) pushed phones to a 521px layout and
          crushed the minmax(0,1fr) title column to 0px. */}
      <div
        className="hidden items-center gap-3 px-3 py-2 md:grid"
        style={{
          gridTemplateColumns: "30px 38px minmax(0,1fr) 130px 180px 22px",
        }}
      >
        {/* 1 — Index (mono "01", "02"…) */}
        <span
          className="font-mono text-[12px] tabular-nums"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {indexLabel}
        </span>

      {/* 2 — 38px gradient cover tile */}
      <span
        aria-hidden
        className="h-[38px] w-[38px] shrink-0 rounded-[var(--radius-sm)]"
        style={{ background: coverBg }}
      />

      {/* 3 — Title + meta (truncates) */}
      <div className="min-w-0">
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

      {/* 4 — Stage pill (colored dot + label) */}
      <span
        className="inline-flex items-center gap-1.5 self-center justify-self-start rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
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

      {/* 5 — Progress bar + % */}
      <div className="flex items-center gap-2">
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

      {/* 6 — Chevron (decorative — the whole row is the link) */}
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        <ChevronRight size={16} />
      </span>
      </div>

      {/* Mobile (<md) — Spotify-style 64px two-line row. */}
      <div
        aria-hidden
        className="flex min-h-[64px] items-center gap-3 px-3 py-2.5 md:hidden"
      >
        <span
          className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)]"
          style={{ background: coverBg }}
        />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[15px] font-medium leading-tight"
            style={{ color: "rgb(var(--fg-default))" }}
          >
            {track.title}
          </span>
          <span
            className="mt-0.5 flex items-center gap-1.5 text-[12px]"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: stageHue }}
            />
            <span className="min-w-0 truncate">
              {stageLabel(track.workflowStage)}
              {meta ? ` · ${meta}` : ""}
            </span>
          </span>
          <span
            className="mt-1.5 block h-[2px] max-w-[180px] overflow-hidden rounded-full"
            style={{ background: "rgb(var(--border-subtle))" }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${String(clampedProgress)}%`,
                background: "rgb(var(--brand-primary))",
              }}
            />
          </span>
        </span>
        <ChevronRight
          size={16}
          className="shrink-0"
          style={{ color: "rgb(var(--fg-muted))" }}
        />
      </div>
    </Link>
  );
}
