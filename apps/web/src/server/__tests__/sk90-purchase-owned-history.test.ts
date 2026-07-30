import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SK-90 purchase-owned history callers", () => {
  it("recovers pending upload cancellation before soft-deleting incomplete history", () => {
    const projectRouter = source("src/server/trpc/routers/project.ts");
    const deleteVersion = projectRouter.slice(
      projectRouter.indexOf("deleteVersion:"),
      projectRouter.indexOf("setPaid:"),
    );

    expect(deleteVersion).not.toMatch(/\.delete\(trackVersions\)/);
    expect(deleteVersion).toMatch(/\.set\(\{ audioDeletedAt \}\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.audioUrl\)/);
    expect(deleteVersion).toMatch(/row\.pendingAudioR2Key !== null/);
    expect(deleteVersion).toMatch(/row\.pendingAudioUploadId !== null/);
    expect(deleteVersion).toMatch(/row\.pendingAudioCancelRequestedAt !== null/);
    expect(deleteVersion).toContain("await cancelPendingMultipartUpload(ctx");
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioR2Key\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioUploadId\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioInitiationDigest\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioCompletionToken\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioSizeBytes\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioStartedAt\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioCreateAttemptedAt\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioCancelRequestedAt\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioCleanupEtag\)/);

    const softDeleteStart = deleteVersion.indexOf(".set({ audioDeletedAt })");
    const softDeleteCas = deleteVersion.slice(
      softDeleteStart,
      deleteVersion.indexOf(".returning({ id: trackVersions.id })", softDeleteStart),
    );
    expect(softDeleteCas).toContain("eq(trackVersions.producerId, ctx.producerId)");
  });

  it("binds a server-issued identity before cancellation can mutate storage", () => {
    const initiationService = source("src/server/audio/pending-multipart-initiation.ts");
    const cancellationService = source("src/server/audio/pending-multipart-cancellation.ts");
    const journalWrite = initiationService.indexOf("pendingAudioR2Key: proposedKey");
    const preCreateReconciliation = initiationService.indexOf(
      "const prepared = await reconcilePendingInitiation",
    );
    const createAttemptJournal = initiationService.indexOf("pendingAudioCreateAttemptedAt: now");
    const remoteCreate = initiationService.indexOf("new CreateMultipartUploadCommand");
    const uploadIdBinding = initiationService.indexOf("pendingAudioUploadId: uploadId");
    const postCreateReconciliation = initiationService.indexOf(
      "const reconciled = await reconcilePendingInitiation",
      remoteCreate,
    );
    const reconciliation = cancellationService.indexOf(
      "await finishPendingAudioCancellation(ctx, prepared.scope)",
    );

    expect(journalWrite).toBeGreaterThanOrEqual(0);
    expect(preCreateReconciliation).toBeGreaterThan(journalWrite);
    expect(preCreateReconciliation).toBeLessThan(remoteCreate);
    expect(createAttemptJournal).toBeGreaterThan(journalWrite);
    expect(remoteCreate).toBeGreaterThan(journalWrite);
    expect(postCreateReconciliation).toBeGreaterThan(remoteCreate);
    expect(uploadIdBinding).toBeGreaterThan(remoteCreate);
    expect(reconciliation).toBeGreaterThanOrEqual(0);
    expect(cancellationService).toContain(
      "No server-issued multipart identity is pending for this version",
    );
    expect(cancellationService).toContain("abortMultipartUploadAndObserve");
    expect(cancellationService).toContain("pendingAudioCleanupEtag: exact.objectEtag");
    expect(cancellationService).toMatch(
      /pendingAudioCancelRequestedAt: cancellationRequestedAt,[\s\S]*audioDeletedAt: cancellationRequestedAt/,
    );
    expect(cancellationService).toContain(": { audioDeletedAt: input.audioDeletedAt }");
    expect(cancellationService).toContain("canFinalizePendingMultipartCancellation");
    expect(cancellationService).toContain("refreshCancellationObservation");
    expect(cancellationService).toContain("exactObjectIsAbsent");
  });

  it("keeps unfinished or deleted audio out of latest-listening surfaces", () => {
    const libraryRouter = source("src/server/trpc/routers/library.ts");
    const musicReadModel = source("src/server/domain/song-spaces/music-read-model.ts");
    const producerRouter = source("src/server/trpc/routers/producer.ts");

    const sharedMusicRoutes = libraryRouter.slice(
      libraryRouter.indexOf("  music: router"),
      libraryRouter.indexOf("  list: producerProcedure"),
    );
    const versionRead = musicReadModel.slice(
      musicReadModel.indexOf("  const versionRows ="),
      musicReadModel.indexOf("  const commentTargetVersionByTrack"),
    );
    const producerToday = producerRouter.slice(
      producerRouter.indexOf("  today: producerProcedure.query"),
      producerRouter.indexOf("  // ─── Overview sub-router"),
    );

    expect(sharedMusicRoutes).toContain("listMusicSongSpaces");
    expect(sharedMusicRoutes).toContain("getMusicProjectSongSpaces");
    expect(sharedMusicRoutes).toContain('kind: "producer"');
    expect(sharedMusicRoutes).toContain('kind: "artist"');

    // The shared read model intentionally loads tombstones for history, then
    // separates them from the latest playable version. Pure in-flight rows
    // and deleted audio therefore cannot hide an older playable version.
    expect(versionRead).toContain(
      "or(isNotNull(trackVersions.audioUrl), isNotNull(trackVersions.audioDeletedAt))",
    );
    const unfinishedGuard = versionRead.indexOf(
      "if (version.audioUrl === null && version.audioDeletedAt == null) continue;",
    );
    const unplayableGuard = versionRead.indexOf(
      "if (version.audioUrl === null || version.audioDeletedAt != null) continue;",
    );
    const latestPlayableWrite = versionRead.indexOf("latestVersionByTrack.set");
    expect(unfinishedGuard).toBeGreaterThanOrEqual(0);
    expect(unplayableGuard).toBeGreaterThan(unfinishedGuard);
    expect(latestPlayableWrite).toBeGreaterThan(unplayableGuard);

    expect(producerToday).toContain("isNotNull(trackVersions.audioUrl)");
    expect(producerToday).toContain("isNull(trackVersions.audioDeletedAt)");
  });
});
