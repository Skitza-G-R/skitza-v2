"use client";

import { CommentThread, type CommentThreadProps } from "./comment-thread";
import { partitionComments } from "./music-helpers";

// Story 06 — list of comments for a track, partitioned into:
//   1. onActive — comments authored on the active version (top of list).
//   2. fromOtherVersions — unresolved comments from earlier versions
//      (rendered with `(from V<N>)` subscript by CommentThread).
//   3. resolved — never rendered. Surfaced by the helper for symmetry
//      / future audit views, but the panel discards it.
//
// The bucketing logic lives in partitionComments (pure helper) so
// branch coverage is exercised by music-helpers.test.ts. This file is
// intentionally a thin presentational shell.

type Comment = CommentThreadProps["comment"];

export interface CommentsPanelProps {
  /**
   * The full unresolved-comments payload for the track (from the
   * projectRoom.music procedure). Pre-sorted by created_at DESC.
   */
  comments: Comment[];
  /** The version the producer is currently scrubbing on. */
  activeVersionId: string;
  /** projectId — pass-through to the resolve actions in CommentThread. */
  projectId: string;
}

export function CommentsPanel({
  comments,
  activeVersionId,
  projectId,
}: CommentsPanelProps) {
  const partition = partitionComments(comments, activeVersionId);
  const { onActive, fromOtherVersions } = partition;

  const isEmpty = onActive.length === 0 && fromOtherVersions.length === 0;

  if (isEmpty) {
    return (
      <div
        className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-4 text-center"
        role="status"
      >
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          No comments on this version yet — drag the waveform to leave one.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Comments"
      className="space-y-3"
      data-comments-panel
    >
      {/* Active-version comments — top of the list. */}
      {onActive.length > 0 ? (
        <div className="space-y-2" data-bucket="active">
          {onActive.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              activeVersionId={activeVersionId}
              projectId={projectId}
            />
          ))}
        </div>
      ) : null}

      {/* Cross-version unresolved — appended below, with subscripts.
          Visually separated by a subtle divider so the producer knows
          these belong to earlier mixes. */}
      {fromOtherVersions.length > 0 ? (
        <div
          className="space-y-2 border-t border-[rgb(var(--border-subtle))] pt-3"
          data-bucket="fromOtherVersions"
        >
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            From earlier versions
          </p>
          {fromOtherVersions.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              activeVersionId={activeVersionId}
              projectId={projectId}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
