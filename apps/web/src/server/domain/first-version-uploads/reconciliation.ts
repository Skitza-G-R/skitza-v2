import {
  and,
  eq,
  firstVersionUploadIntents,
  isNull,
  sql,
  type Db,
} from "@skitza/db";

import {
  lockProducerAudioStorageQuota,
  readProducerAudioStorageQuota,
  type ProducerAudioStorageQuota,
} from "~/server/domain/audio-storage/quota";
import {
  reconcileFirstVersionFinalDeletion,
  sealFirstVersionStagingUpload,
} from "./storage";

const RECONCILIATION_BATCH_SIZE = 8;

/**
 * Bounded, lazy cleanup for invisible terminal V1 intents. It is deliberately
 * callable while a producer is full. Legacy unconditional capabilities remain
 * reserved until an operator records credential revocation on the exact row.
 */
export async function reconcileProducerFirstVersionUploadReservations(
  db: Db,
  producerId: string,
): Promise<ProducerAudioStorageQuota> {
  return db.transaction(async (tx) => {
    await lockProducerAudioStorageQuota(tx, producerId);
    const candidates = await tx
      .select()
      .from(firstVersionUploadIntents)
      .where(
        and(
          eq(firstVersionUploadIntents.producerId, producerId),
          isNull(firstVersionUploadIntents.stagingSealedAt),
          sql`(
            ${firstVersionUploadIntents.completedAt} IS NOT NULL
            OR ${firstVersionUploadIntents.canceledAt} IS NOT NULL
            OR ${firstVersionUploadIntents.expiresAt} <= now()
          )`,
          sql`(
            ${firstVersionUploadIntents.uploadUrlWriteOnceProtectedAt} IS NOT NULL
            OR ${firstVersionUploadIntents.legacyUploadCapabilitiesRevokedAt} IS NOT NULL
            OR ${firstVersionUploadIntents.latestUploadUrlExpiresAt} IS NULL
          )`,
        ),
      )
      .limit(RECONCILIATION_BATCH_SIZE)
      .for("update");

    for (const candidate of candidates) {
      const identity = {
        sizeBytes: candidate.audioSizeBytes,
        contentType: candidate.audioContentType,
        completionToken: candidate.completionToken,
      };
      try {
        if (!candidate.completedAt) {
          await reconcileFirstVersionFinalDeletion({
            key: candidate.audioR2Key,
            ...identity,
          });
        }
        await sealFirstVersionStagingUpload({
          key: candidate.stagingAudioR2Key,
          ...identity,
        });
        await tx
          .update(firstVersionUploadIntents)
          .set({
            stagingSealedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(firstVersionUploadIntents.id, candidate.id),
              eq(firstVersionUploadIntents.producerId, producerId),
              isNull(firstVersionUploadIntents.stagingSealedAt),
            ),
          );
      } catch (error) {
        console.warn(
          "[first-version-upload] reservation reconciliation failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return readProducerAudioStorageQuota(tx, producerId);
  });
}
