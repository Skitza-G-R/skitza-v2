import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectRouter = readFileSync(new URL("../trpc/routers/project.ts", import.meta.url), "utf8");
const songDb = readFileSync(new URL("../domain/song-management/db.ts", import.meta.url), "utf8");
const versionApprovalDb = readFileSync(
  new URL("../domain/version-approval/db.ts", import.meta.url),
  "utf8",
);
const uploadPolicy = readFileSync(
  new URL("../domain/version-uploads/service.ts", import.meta.url),
  "utf8",
);
const audioRouter = readFileSync(new URL("../trpc/routers/audio.ts", import.meta.url), "utf8");
const producerRouter = readFileSync(new URL("../trpc/routers/producer.ts", import.meta.url), "utf8");
const artistRouter = readFileSync(new URL("../trpc/routers/artist.ts", import.meta.url), "utf8");
const multipartInitiation = readFileSync(
  new URL("../audio/pending-multipart-initiation.ts", import.meta.url),
  "utf8",
);
const producerMusicActions = readFileSync(
  new URL("../../app/(producer)/dashboard/music/actions.ts", import.meta.url),
  "utf8",
);
const songPage = readFileSync(
  new URL("../../components/music/song-page.tsx", import.meta.url),
  "utf8",
);

describe("SK-8 song management wiring", () => {
  it("serializes every song mutation with the established project then purchase locks", () => {
    const lockSong = songDb.slice(
      songDb.indexOf("async function lockSong"),
      songDb.indexOf("async function touchProject"),
    );
    const projectLock = lockSong.indexOf("input.scope.projectId");
    const purchaseLock = lockSong.indexOf("input.scope.purchaseId", projectLock + 1);
    const projectRow = lockSong.indexOf(".from(projects)", purchaseLock);
    const purchaseRow = lockSong.indexOf(".from(purchases)", projectRow);
    const trackRow = lockSong.indexOf(".from(projectTracks)", purchaseRow);

    expect(projectLock).toBeGreaterThan(-1);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(projectRow).toBeGreaterThan(purchaseLock);
    expect(purchaseRow).toBeGreaterThan(projectRow);
    expect(trackRow).toBeGreaterThan(purchaseRow);

    for (const mutation of [
      "updateSongMetadata",
      "setSongArchiveState",
      "renameSongVersion",
      "setProducerFinalVersion",
      "setSongWorkflowStage",
      "markSongReleased",
      "tombstoneStoredAudioVersion",
    ]) {
      const start = songDb.indexOf(`function ${mutation}`);
      expect(start, mutation).toBeGreaterThan(-1);
      expect(songDb.indexOf("lockSong(tx", start), mutation).toBeGreaterThan(start);
    }
  });

  it("keeps Released separate from Done / Delivered and makes the mark explicit", () => {
    expect(songDb).toContain("const isReleased = track.releasedAt !== null");
    expect(songDb).not.toContain('track.workflowStage === "done"');
    const mutation = projectRouter.slice(
      projectRouter.indexOf("markTrackReleased:"),
      projectRouter.indexOf("updateVersionLabel:"),
    );
    expect(mutation).toContain('confirmation: z.literal("MARK_SONG_RELEASED")');
    expect(mutation).toContain("await markSongReleased(ctx.db");
    for (const musicDetail of [producerRouter, artistRouter]) {
      expect(musicDetail).toContain("trackReleasedAt: projectTracks.releasedAt");
      expect(musicDetail).toContain("releasedAt: head.trackReleasedAt");
    }
  });

  it("commits the tombstone/read revocation before exact R2 reconciliation", () => {
    const mutation = projectRouter.slice(
      projectRouter.indexOf("permanentlyDeleteVersionAudio:"),
      projectRouter.indexOf(
        "resolveComment:",
        projectRouter.indexOf("permanentlyDeleteVersionAudio:"),
      ),
    );
    const tombstone = mutation.indexOf("await tombstoneStoredAudioVersion");
    const reconcile = mutation.indexOf("await reconcileExactStoredAudioDeletion");

    expect(mutation).toContain('confirmation: z.literal("DELETE_STORED_AUDIO")');
    expect(mutation).toContain("operationKey: z.string().uuid()");
    expect(mutation).toContain("actorClerkUserId: ctx.userId");
    expect(mutation).toContain("operationKey: input.operationKey");
    expect(tombstone).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(tombstone);
    expect(mutation).toContain("r2ExactAudioStoragePort()");
  });

  it("refreshes tombstoned history even when storage reconciliation asks for a retry", () => {
    const action = producerMusicActions.slice(
      producerMusicActions.indexOf("function deleteMusicVersionAudio"),
    );
    expect(action).toMatch(/finally\s*\{[\s\S]*revalidateMusic/);
    expect(action).toContain("operationKey: input.operationKey");
    expect(songPage).toContain("const operationKey = crypto.randomUUID()");
    expect(songPage).toMatch(/deleteVersionAudio\(\{[\s\S]*operationKey,[\s\S]*\}\)/);
  });

  it("audits each newly committed audio tombstone once in the same transaction", () => {
    const deletion = songDb.slice(
      songDb.indexOf("function tombstoneStoredAudioVersion"),
      songDb.indexOf("return {", songDb.indexOf("function tombstoneStoredAudioVersion")),
    );
    const tombstone = deletion.indexOf(".update(trackVersions)");
    const publicConsequences = deletion.indexOf(".update(songPublicLinks)");
    const auditInsert = deletion.indexOf(".insert(songPublicAccessEvents)");
    const retryBranch = deletion.indexOf(
      "The policy was already authorized by the committed tombstone",
    );

    expect(deletion).toContain("storedAudioDeletionOperationDigest");
    expect(deletion).toContain("OPERATION_KEY_CONFLICT");
    expect(deletion).toContain("eq(songPublicAccessEvents.operationKey, operationKey)");
    expect(deletion).toContain('action: "audio_deleted"');
    expect(deletion).toContain("changed: true");
    expect(tombstone).toBeGreaterThan(-1);
    expect(publicConsequences).toBeGreaterThan(tombstone);
    expect(auditInsert).toBeGreaterThan(publicConsequences);
    expect(retryBranch).toBeGreaterThan(auditInsert);
  });

  it("uses the public delivery predicate for deletion fallback and last-audio lifecycle", () => {
    const deletion = songDb.slice(
      songDb.indexOf("function tombstoneStoredAudioVersion"),
      songDb.indexOf("return {", songDb.indexOf("function tombstoneStoredAudioVersion")),
    );

    expect(deletion).toContain("isPublicStoredVersionCandidate(target, publicScope)");
    expect(deletion).toContain("isPublicStoredVersionCandidate(version, publicScope)");
    expect(deletion).not.toContain(
      "version.audioDeletedAt === null && version.audioUrl !== null",
    );
  });

  it("keeps stage and producer-ready selection on serialized purchase-owned adapters", () => {
    expect(projectRouter).toContain("await setSongWorkflowStage(ctx.db");
    expect(projectRouter).toContain("await markProducerVersionReady(versionApprovalRepository(ctx.db)");

    const projectLock = versionApprovalDb.indexOf(
      "hashtextextended(${discovery.projectId}",
    );
    const purchaseLock = versionApprovalDb.indexOf(
      "hashtextextended(${discovery.purchaseId}",
    );
    expect(projectLock).toBeGreaterThan(-1);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(versionApprovalDb).toContain('.for("update")');
    expect(versionApprovalDb).toContain("producerMarkedFinalAt: null");
    expect(versionApprovalDb).toContain("isNull(trackVersions.audioDeletedAt)");
  });

  it("threads the locked song archive state through upload initiation and completion", () => {
    expect(uploadPolicy).toContain("trackArchivedAt: Date | null");
    expect(uploadPolicy).toContain("candidate.trackArchivedAt !== null");
    expect(uploadPolicy).toContain("Restore this archived song before changing its audio versions");
    expect(
      audioRouter.match(/trackArchivedAt: projectTracks\.archivedAt/g)?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(audioRouter.match(/trackArchivedAt: .*trackArchivedAt/g)?.length).toBeGreaterThanOrEqual(
      5,
    );
    expect(
      multipartInitiation.match(/trackArchivedAt: projectTracks\.archivedAt/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });
});
