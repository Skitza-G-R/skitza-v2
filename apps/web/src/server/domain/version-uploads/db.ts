import { and, desc, eq, trackVersions, versionApprovalEvents, type Db } from "@skitza/db";

export type CurrentArtistApprovalAction = "approved" | "revoked" | null;

/**
 * Reads the newest append-only approval event for one purchase-owned song.
 * Callers that mutate upload state invoke this while holding the same
 * project-then-purchase advisory locks used by exact-version approval.
 */
export async function currentTrackArtistApprovalAction(
  db: Pick<Db, "select">,
  input: Readonly<{ trackId: string; purchaseId: string; producerId: string }>,
): Promise<CurrentArtistApprovalAction> {
  const [event] = await db
    .select({ action: versionApprovalEvents.action })
    .from(versionApprovalEvents)
    .innerJoin(
      trackVersions,
      and(
        eq(trackVersions.id, versionApprovalEvents.versionId),
        eq(trackVersions.purchaseId, versionApprovalEvents.purchaseId),
      ),
    )
    .where(
      and(
        eq(trackVersions.trackId, input.trackId),
        eq(versionApprovalEvents.purchaseId, input.purchaseId),
        eq(versionApprovalEvents.producerId, input.producerId),
      ),
    )
    .orderBy(desc(versionApprovalEvents.createdAt), desc(versionApprovalEvents.id))
    .limit(1);
  return event?.action ?? null;
}
