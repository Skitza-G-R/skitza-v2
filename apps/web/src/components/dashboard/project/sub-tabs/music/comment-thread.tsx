"use client";

import { useState } from "react";

import { useToast } from "~/components/ui/toast";
import {
  resolveCommentAction,
  unresolveCommentAction,
} from "~/app/(app)/dashboard/projects/actions";

import { formatRangeAnchor } from "./music-helpers";

// Story 06 — single-comment row inside the comments panel.
//
// Renders: author name, time anchor (point or range), body, optional
// `(from V<N>)` subscript when the comment was authored on a different
// version than the one currently active, and a resolve / unresolve
// toggle.
//
// Optimistic UX: the resolve toggle flips local state synchronously,
// then fires the server action in the background. On error, we revert
// + toast — the comment row stays mounted (no surprise disappearance).
//
// Voice memo comments are deferred to v2 per PRD §11.6 — out of scope.

export interface CommentThreadProps {
  /** Comment row from the projectRoom.music payload. */
  comment: {
    id: string;
    versionId: string;
    versionLabel: string;
    authorName: string;
    body: string;
    timestampMs: number;
    endTimestampMs: number | null;
    fromProducer: boolean;
    createdAt: Date;
    /**
     * Resolved comments don't appear in the panel, but the prop type
     * stays union-shaped so the ComentsPanel can pass through the same
     * row when an optimistic resolve is in flight (we re-render with
     * resolvedAt non-null until the server confirms).
     */
    resolvedAt: Date | null;
  };
  /**
   * The version the producer is currently viewing. When this differs
   * from `comment.versionId`, we render a `(from V<N>)` subscript next
   * to the timestamp so the producer knows the feedback belongs to an
   * earlier mix that hasn't been addressed yet.
   */
  activeVersionId: string;
  /** projectId — needed for the revalidatePath call inside the action. */
  projectId: string;
}

export function CommentThread({
  comment,
  activeVersionId,
  projectId,
}: CommentThreadProps) {
  const { toast } = useToast();
  // Optimistic toggle state: locally mark a comment as resolved /
  // unresolved before the server confirms. Reverts on error.
  const initialResolved = comment.resolvedAt !== null;
  const [optimisticResolved, setOptimisticResolved] = useState(initialResolved);
  const [pending, setPending] = useState(false);

  const isFromOtherVersion = comment.versionId !== activeVersionId;
  const anchor = formatRangeAnchor(
    comment.timestampMs,
    comment.endTimestampMs,
  );
  const isRange = comment.endTimestampMs !== null;

  async function handleToggleResolve() {
    if (pending) return;
    const next = !optimisticResolved;
    setOptimisticResolved(next);
    setPending(true);
    try {
      const res = next
        ? await resolveCommentAction({
            projectId,
            commentId: comment.id,
          })
        : await unresolveCommentAction({
            projectId,
            commentId: comment.id,
          });
      if (!res.ok) {
        toast(res.error, "error");
        setOptimisticResolved(!next);
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Couldn't update comment.",
        "error",
      );
      setOptimisticResolved(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      data-comment-id={comment.id}
      data-resolved={optimisticResolved}
      data-range={isRange}
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3"
    >
      <header className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm text-[rgb(var(--fg-primary))]">
          {comment.authorName}
        </span>
        <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
          {anchor}
        </span>
        {isFromOtherVersion ? (
          <span
            className="font-mono text-xs text-[rgb(var(--fg-muted))]"
            aria-label={`From ${comment.versionLabel}`}
          >
            (from {comment.versionLabel})
          </span>
        ) : null}
      </header>
      <p className="text-sm text-[rgb(var(--fg-secondary))] whitespace-pre-wrap">
        {comment.body}
      </p>
      <footer className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void handleToggleResolve();
          }}
          disabled={pending}
          aria-pressed={optimisticResolved}
          className={[
            "sk-tap inline-flex min-h-[44px] items-center rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-[0.66rem] uppercase tracking-wider transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
            "disabled:cursor-not-allowed disabled:opacity-60",
            optimisticResolved
              ? "border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
              : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
          ].join(" ")}
        >
          {optimisticResolved ? "Resolved" : "Resolve"}
        </button>
      </footer>
    </article>
  );
}
