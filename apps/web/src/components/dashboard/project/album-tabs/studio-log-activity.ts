import type { StudioLogActivityEntry } from "./studio-log-tab";

interface ProjectActivityVersion {
  id: string;
  label: string;
  uploadedAt: Date;
}

interface ProjectActivityComment {
  id: string;
  authorName: string;
  createdAt: Date;
}

interface BuildProjectActivityEntriesInput {
  projectId: string;
  projectCreatedAt: Date;
  versions: readonly ProjectActivityVersion[];
  comments: readonly ProjectActivityComment[];
}

const RECENT_ACTIVITY_LIMIT = 5;

function newestFirst<T extends { id: string }>(
  items: readonly T[],
  timestamp: (item: T) => Date,
): T[] {
  return [...items].sort(
    (left, right) =>
      timestamp(right).getTime() - timestamp(left).getTime() || left.id.localeCompare(right.id),
  );
}

export function buildProjectActivityEntries({
  projectId,
  projectCreatedAt,
  versions,
  comments,
}: BuildProjectActivityEntriesInput): StudioLogActivityEntry[] {
  const versionEntries: StudioLogActivityEntry[] = newestFirst(
    versions,
    (version) => version.uploadedAt,
  )
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map((version) => ({
      id: `version-${version.id}`,
      kind: "version",
      ts: version.uploadedAt,
      description: `New version uploaded — ${version.label}`,
    }));
  const commentEntries: StudioLogActivityEntry[] = newestFirst(
    comments,
    (comment) => comment.createdAt,
  )
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map((comment) => ({
      id: `comment-${comment.id}`,
      kind: "comment",
      ts: comment.createdAt,
      description: `${comment.authorName} left a note`,
    }));

  return [
    {
      id: `created-${projectId}`,
      kind: "created",
      ts: projectCreatedAt,
      description: "Project created",
    },
    ...versionEntries,
    ...commentEntries,
  ];
}
