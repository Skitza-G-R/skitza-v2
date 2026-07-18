/**
 * Existing upload, comment, and song-space writers lock the raw project UUID.
 * Keep this helper un-prefixed so lifecycle transitions and empty-draft deletion
 * serialize with those established write boundaries.
 */
export function projectAdvisoryLockKey(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) throw new Error("Project id must not be empty");
  return normalized;
}
