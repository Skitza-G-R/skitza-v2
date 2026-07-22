export type ProjectReorderResult = { ok: true } | { ok: false; error: string };

/**
 * A Server Action success can revalidate the page before a newer queued
 * reorder has settled. Keep the optimistic latest order authoritative during
 * that window so the prop refresh cannot make its failure look stale.
 */
export function canSyncProjectProps(pendingGeneration: number | null): boolean {
  return pendingGeneration === null;
}

/**
 * Moves a project beside its adjacent displayed row, then writes that visible
 * order back into the same full-list slots. Filtered-out rows keep their
 * placement, and a sorted view can safely switch back to custom order.
 */
export function moveProjectRelativeToVisibleRows<T extends { id: string }>(
  projects: T[],
  visibleProjectIds: string[],
  projectId: string,
  direction: "up" | "down",
): T[] | null {
  const visibleIndex = visibleProjectIds.indexOf(projectId);
  const targetVisibleIndex = direction === "up" ? visibleIndex - 1 : visibleIndex + 1;
  if (
    visibleIndex < 0 ||
    targetVisibleIndex < 0 ||
    targetVisibleIndex >= visibleProjectIds.length
  ) {
    return null;
  }

  const reorderedVisibleIds = visibleProjectIds.slice();
  const [movedId] = reorderedVisibleIds.splice(visibleIndex, 1);
  if (!movedId) return null;
  reorderedVisibleIds.splice(targetVisibleIndex, 0, movedId);

  const visibleIdSet = new Set(visibleProjectIds);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const visibleSlots = projects.flatMap((project, index) =>
    visibleIdSet.has(project.id) ? [index] : [],
  );
  if (visibleSlots.length !== reorderedVisibleIds.length) return null;

  const next = projects.slice();
  for (const [visibleOrderIndex, projectIndex] of visibleSlots.entries()) {
    const reorderedId = reorderedVisibleIds[visibleOrderIndex];
    const reorderedProject = reorderedId ? projectsById.get(reorderedId) : undefined;
    if (!reorderedProject) return null;
    next[projectIndex] = reorderedProject;
  }
  return next;
}

/**
 * Runs reorder writes one at a time. The server uses last-writer-wins,
 * so a newer order must never reach it before an older write finishes.
 */
export function serializeProjectOrderPersistence(
  previous: Promise<void>,
  task: () => Promise<void>,
): Promise<void> {
  return previous.catch(() => undefined).then(task);
}

interface PersistLatestProjectOrderArgs<T> {
  orderedIds: string[];
  previousOrder: T;
  generation: number;
  getLatestGeneration: () => number;
  persist: (orderedIds: string[]) => ProjectReorderResult | Promise<ProjectReorderResult>;
  rollback: (previousOrder: T) => void;
  onError: (message: string) => void;
}

/**
 * Persists an optimistic drag while protecting newer UI state from an
 * older request that finishes late. Only the latest request may roll
 * the list back or announce an error.
 */
export async function persistLatestProjectOrder<T>({
  orderedIds,
  previousOrder,
  generation,
  getLatestGeneration,
  persist,
  rollback,
  onError,
}: PersistLatestProjectOrderArgs<T>): Promise<void> {
  try {
    const result = await persist(orderedIds);
    if (!result.ok && generation === getLatestGeneration()) {
      rollback(previousOrder);
      onError(result.error);
    }
  } catch {
    if (generation === getLatestGeneration()) {
      rollback(previousOrder);
      onError("Could not save the project order. Try again.");
    }
  }
}
