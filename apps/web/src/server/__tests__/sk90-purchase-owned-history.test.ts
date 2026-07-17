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
    const artistRouter = source("src/server/trpc/routers/artist.ts");
    const producerRouter = source("src/server/trpc/routers/producer.ts");

    const artistProjects = artistRouter.slice(
      artistRouter.indexOf("  projects: artistProcedure.query"),
      artistRouter.indexOf("  list: artistProcedure.query"),
    );
    const artistList = artistRouter.slice(
      artistRouter.indexOf("  list: artistProcedure.query"),
      artistRouter.indexOf("  // Full detail for one project"),
    );
    const artistProject = artistRouter.slice(
      artistRouter.indexOf("  project: artistProcedure"),
      artistRouter.indexOf("  // Timestamped comment"),
    );
    const artistHome = artistRouter.slice(
      artistRouter.indexOf("  home: artistProcedure.query"),
      artistRouter.indexOf("  // Soft-disconnect"),
    );
    const producerMusic = producerRouter.slice(
      producerRouter.indexOf("  music: router"),
      producerRouter.indexOf("  // Full data export"),
    );
    const producerToday = producerRouter.slice(
      producerRouter.indexOf("  today: producerProcedure.query"),
      producerRouter.indexOf("  // ─── Overview sub-router"),
    );

    for (const block of [artistProjects, artistList, artistProject, artistHome]) {
      expect(block).toContain("isNotNull(trackVersions.audioUrl)");
      expect(block).toContain("isNull(trackVersions.audioDeletedAt)");
    }
    expect(
      (artistHome.match(/isNotNull\(trackVersions\.audioUrl\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (artistHome.match(/isNull\(trackVersions\.audioDeletedAt\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);

    expect(
      (producerMusic.match(/isNotNull\(trackVersions\.audioUrl\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (producerMusic.match(/isNull\(trackVersions\.audioDeletedAt\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(producerToday).toContain("isNotNull(trackVersions.audioUrl)");
    expect(producerToday).toContain("isNull(trackVersions.audioDeletedAt)");
  });
});
