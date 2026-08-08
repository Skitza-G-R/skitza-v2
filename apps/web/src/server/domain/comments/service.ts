export type CommentProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type WritableCommentTarget = {
  versionId: string;
  versionTrackId: string;
  trackId: string;
  trackProjectId: string;
  trackArchivedAt: Date | null;
  versionAudioDeletedAt: Date | null;
  projectId: string;
  projectLifecycleStatus: CommentProjectLifecycleStatus;
};

export type ExpectedCommentTarget = {
  versionId: string;
  trackId: string;
  projectId: string;
};

export class CommentDomainError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INACTIVE",
    message: string,
  ) {
    super(message);
    this.name = "CommentDomainError";
  }
}

/**
 * Checks the exact locked version -> track -> project chain at the write boundary.
 * Completed/canceled work remains readable, but only active or paused work accepts
 * new discussion.
 */
export function assertWritableCommentTarget(
  target: WritableCommentTarget | null,
  expected: ExpectedCommentTarget,
): asserts target is WritableCommentTarget {
  if (
    !target ||
    target.versionId !== expected.versionId ||
    target.versionTrackId !== expected.trackId ||
    target.trackId !== expected.trackId ||
    target.trackProjectId !== expected.projectId ||
    target.projectId !== expected.projectId
  ) {
    throw new CommentDomainError("NOT_FOUND", "The comment target was not found");
  }

  if (
    target.trackArchivedAt !== null ||
    target.versionAudioDeletedAt !== null ||
    (target.projectLifecycleStatus !== "active" && target.projectLifecycleStatus !== "paused")
  ) {
    throw new CommentDomainError(
      "INACTIVE",
      "Comments are closed for this project, Song, or deleted Version",
    );
  }
}
