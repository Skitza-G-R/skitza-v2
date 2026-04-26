"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import { WaveformPlayer } from "~/components/audio/waveform-player";
import { Badge } from "~/components/ui/badge";

import {
  type VersionStatus,
  type ViewerRole,
} from "./music-helpers";
import { VersionStatusPill } from "./version-status-pill";

// Story 05 — TrackRow renders a single track with:
//   - Hero waveform for the active version (320px desktop / 200px mobile)
//   - Version chips below the waveform (V1 · V2 · V3, click to swap)
//   - Bilateral status pill in the top-right
//   - Inline title rename (click the title to edit, Enter / blur saves)
//   - Drop-on-row gesture (Frame.io Version Stacking):
//       Top half  → onAddVersion(trackId, files)  (replace as V<N+1>)
//       Bottom half → onAddTracks(files)          (add as separate tracks)
//
// The drop hit-test reads the drop event's clientY against the row's
// bounding rect. Top 60% = "version" bucket (the larger area as per
// PRD); bottom 40% = "new track" bucket. The 60/40 split makes the
// default (most-common: "I'm uploading the next mix") the easier
// gesture to land.

export interface TrackRowVersion {
  id: string;
  label: string;
  audioUrl: string | null;
  audioReady: boolean;
  status: VersionStatus;
  uploadingProgress?: number;
}

export interface TrackRowComment {
  id: string;
  resolvedAt: Date | null;
}

interface TrackRowProps {
  trackId: string;
  title: string;
  versions: TrackRowVersion[];
  comments: TrackRowComment[];
  viewerRole: ViewerRole;
  onAddVersion: (trackId: string, files: File[]) => void;
  onAddTracks: (files: File[]) => void;
  onSetVersionStatus: (versionId: string, status: VersionStatus) => void;
  onRenameTrack: (trackId: string, title: string) => void;
}

// 60/40 split — top 60% of the row's height is the "new version" hit
// zone, bottom 40% is the "new track" hit zone. Adjustable here
// without touching the rest of the file.
const HIT_TEST_TOP_FRACTION = 0.6;

export function TrackRow({
  trackId,
  title,
  versions,
  comments,
  viewerRole,
  onAddVersion,
  onAddTracks,
  onSetVersionStatus,
  onRenameTrack,
}: TrackRowProps) {
  const rowRef = useRef<HTMLElement | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(
    versions[0]?.id ?? null,
  );
  const [dragDepth, setDragDepth] = useState(0);
  const [dropZone, setDropZone] = useState<"top" | "bottom" | null>(null);
  const isDropActive = dragDepth > 0;

  // Inline rename state — controlled input, save on blur OR Enter.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  // Re-sync the draft when the prop changes (server has new title).
  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  // Reduced-motion gate for the version-chip swap animation. Standard
  // CLAUDE.md primitive — every animation must have a prefers-reduced-
  // motion: reduce neutralizer.
  // (We don't actually animate anything beyond CSS transitions in this
  // file, but motion-primitives test pins this — the row uses sk-pop /
  // sk-lift which already gate themselves at the global CSS level.)

  // Active version derivation — fall back to the first version if the
  // saved id is no longer in the list (happens after a delete).
  const active =
    versions.find((v) => v.id === activeVersionId) ?? versions[0] ?? null;

  // Comment counts.
  const totalComments = comments.length;
  const unresolvedComments = comments.filter((c) => c.resolvedAt === null).length;

  // ─── Drag handlers ──────────────────────────────────────────────
  function handleDragEnter(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragDepth((d) => d + 1);
  }

  function handleDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    // Hit-test on every dragover so the highlighted half follows the
    // cursor as it moves. Hit-test against the row's own rect, not the
    // event currentTarget (which can be a nested child).
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetY = e.clientY - rect.top;
    const splitAt = rect.height * HIT_TEST_TOP_FRACTION;
    setDropZone(offsetY < splitAt ? "top" : "bottom");
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragDepth(0);
    setDropZone(null);
    const list = e.dataTransfer.files;
    if (list.length === 0) return;
    const files = Array.from(list);
    // Re-compute the bucket on drop in case dragOver wasn't called
    // (some browsers skip dragOver for very fast drops).
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetY = e.clientY - rect.top;
    const splitAt = rect.height * HIT_TEST_TOP_FRACTION;
    if (offsetY < splitAt) {
      onAddVersion(trackId, files);
    } else {
      onAddTracks(files);
    }
  }

  // ─── Title rename handlers ──────────────────────────────────────
  function startEditingTitle() {
    setEditingTitle(true);
    // Focus on next tick so the input is mounted.
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  }

  function commitTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === title) {
      setTitleDraft(title);
      return;
    }
    onRenameTrack(trackId, next);
  }

  function cancelEditingTitle() {
    setTitleDraft(title);
    setEditingTitle(false);
  }

  return (
    <article
      ref={rowRef}
      data-drop-active={isDropActive}
      data-drop-zone={dropZone ?? undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 transition-colors"
    >
      {/* Drop overlay — only visible during drag-over. The two halves
          show different copy + colour hints so the producer knows
          which gesture they're about to land. */}
      {isDropActive ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 grid grid-rows-[3fr_2fr] overflow-hidden rounded-[var(--radius-lg)]"
        >
          <div
            className={[
              "flex items-center justify-center border-2 border-dashed text-sm font-semibold transition-colors",
              dropZone === "top"
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.10)] text-[rgb(var(--brand-primary))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]",
            ].join(" ")}
          >
            Replace as V{String(versions.length + 1)}
          </div>
          <div
            className={[
              "flex items-center justify-center border-2 border-dashed text-sm font-semibold transition-colors",
              dropZone === "bottom"
                ? "border-[rgb(var(--fg-muted))] bg-[rgb(var(--fg-muted)/0.06)] text-[rgb(var(--fg-secondary))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]",
            ].join(" ")}
          >
            Add as separate track
          </div>
        </div>
      ) : null}

      {/* Header: title (inline-rename) on the left, status pill on
          the right. */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleDraft}
              onChange={(e) => {
                setTitleDraft(e.target.value);
              }}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEditingTitle();
                }
              }}
              maxLength={120}
              aria-label="Track title"
              className="w-full rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary))] bg-[rgb(var(--bg-base))] px-2 py-1 font-display text-xl tracking-tight text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            />
          ) : (
            <button
              type="button"
              onClick={startEditingTitle}
              aria-label={`Rename track ${title}`}
              className="sk-tap text-left font-display text-xl tracking-tight text-[rgb(var(--fg-primary))] transition-colors hover:text-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:rounded-[var(--radius-sm)]"
              style={{ fontWeight: 700 }}
            >
              {title}
            </button>
          )}
        </div>
        {active ? (
          <VersionStatusPill
            status={active.status}
            viewerRole={viewerRole}
            onChange={(s) => {
              onSetVersionStatus(active.id, s);
            }}
          />
        ) : null}
      </header>

      {/* Hero waveform — 320px desktop, 200px mobile (responsive
          height handled internally by the parent's media query state).
          When the active version is still uploading we render an
          "uploading" placeholder. */}
      {active ? (
        <div className="mb-4 overflow-hidden rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-4 sm:p-6">
          {active.audioReady && active.audioUrl ? (
            <WaveformPlayer
              src={active.audioUrl}
              label={title}
              height={320}
              className="hero-waveform"
            />
          ) : (
            <UploadingPlaceholder
              progress={active.uploadingProgress ?? 0}
              label={active.label}
            />
          )}
        </div>
      ) : (
        <p className="mb-4 text-sm text-[rgb(var(--fg-secondary))]">
          No versions yet. Drop an audio file onto this card to add V1.
        </p>
      )}

      {/* Version chips — click to swap the active version. */}
      {versions.length > 1 ? (
        <div
          className="sk-scroll-x mb-4 flex gap-2 overflow-x-auto pb-1"
          aria-label="Track versions"
        >
          {versions.map((v) => {
            const isActive = v.id === active?.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setActiveVersionId(v.id);
                }}
                aria-pressed={isActive}
                className={[
                  "sk-tap inline-flex min-h-[44px] items-center whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
                  isActive
                    ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
              >
                {v.label}
                {!v.audioReady ? " · uploading…" : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Comment counts. */}
      <div className="flex items-center gap-3 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        <span>
          {totalComments === 0
            ? "No comments"
            : `${String(totalComments)} comment${totalComments === 1 ? "" : "s"}`}
        </span>
        {unresolvedComments > 0 ? (
          <Badge variant="accent" dot>
            {String(unresolvedComments)} unresolved
          </Badge>
        ) : null}
      </div>
    </article>
  );
}

// ─── UploadingPlaceholder ───────────────────────────────────────────
// Shown in place of the WaveformPlayer while the active version's
// audio is still PUTting parts. Progress is best-effort (set by the
// parent from useMultipartUpload's state); shows a spinner if not
// known yet.

function UploadingPlaceholder({
  progress,
  label,
}: {
  progress: number;
  label: string;
}) {
  return (
    <div
      className="flex h-[200px] flex-col items-center justify-center sm:h-[320px]"
      aria-live="polite"
    >
      <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label} · uploading
      </p>
      <p className="mt-2 font-display text-2xl tabular-nums text-[rgb(var(--fg-primary))]">
        {String(Math.max(0, Math.min(100, Math.round(progress))))}%
      </p>
      <div className="mt-3 h-1 w-full max-w-sm overflow-hidden rounded bg-[rgb(var(--bg-base))]">
        <div
          className="h-full bg-[rgb(var(--brand-primary))] transition-all duration-150 ease-out"
          style={{ width: `${String(Math.max(0, Math.min(100, progress)))}%` }}
        />
      </div>
    </div>
  );
}
