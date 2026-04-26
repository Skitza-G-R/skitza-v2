// Project Dashboard — Open comments list (Story 04, PRD §11.5).
//
// Top 2-3 unresolved comment threads. The procedure returns up to 3
// (filtered to fromProducer=false) — we render them in order. Each
// row is a Link to the Music tab at the comment's anchor — the Music
// tab consumes the searchParams to scroll-to + highlight the matching
// comment.
//
// Empty list → render nothing (silent empty per story spec).

import Link from "next/link";

import {
  buildCommentJumpHref,
  formatTimestamp,
  truncateBody,
} from "./dashboard-helpers";

export interface OpenCommentRow {
  id: string;
  trackId: string;
  trackTitle: string;
  versionId: string;
  timestampMs: number;
  endTimestampMs: number | null;
  body: string;
  authorName: string;
  createdAt: Date;
  // The procedure also returns reply counts on the unresolved threads
  // — Story 04's procedure doesn't expose this yet (ships in S05/S06
  // when threading lands). For now we render the open threads as
  // single-message rows.
  replyCount?: number;
}

export interface OpenCommentsListProps {
  comments: OpenCommentRow[];
  projectId: string;
}

export function OpenCommentsList({ comments, projectId }: OpenCommentsListProps) {
  if (comments.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Open comments"
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          Open comments
        </h3>
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
          {String(comments.length)}
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {comments.map((comment) => {
          const href = buildCommentJumpHref({
            projectId,
            versionId: comment.versionId,
            commentId: comment.id,
          });
          const ts = formatTimestamp(comment.timestampMs);
          const preview = truncateBody(comment.body, 80);
          return (
            <li key={comment.id}>
              <Link
                href={href}
                className={[
                  "group flex flex-col gap-1 rounded-[var(--radius-md)] border border-transparent px-3 py-2 transition-colors",
                  "hover:border-[rgb(var(--border-subtle))] hover:bg-[rgb(var(--bg-base))]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
                    {comment.trackTitle || "Track"}
                  </span>
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
                    {ts}
                  </span>
                  <span className="text-xs text-[rgb(var(--fg-secondary))] truncate">
                    · {comment.authorName}
                  </span>
                  {comment.replyCount && comment.replyCount > 0 ? (
                    <span className="ml-auto font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                      {String(comment.replyCount)} {comment.replyCount === 1 ? "reply" : "replies"}
                    </span>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-sm text-[rgb(var(--fg-secondary))]">
                  {preview}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
