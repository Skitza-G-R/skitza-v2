import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const service = readFileSync(new URL("../service.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../../../trpc/routers/project.ts", import.meta.url), "utf8");

describe("SK-196 hard Song and Version deletion wiring", () => {
  it("persists the immutable manifest before touching exact R2 objects", () => {
    expect(service.indexOf(".insert(songDeletionOperations)")).toBeGreaterThan(-1);
    expect(
      service.indexOf("reconcileExactStoredAudioDeletion(storage.audio, item)"),
    ).toBeGreaterThan(service.indexOf(".insert(songDeletionOperations)"));
    expect(service).toContain("storage.reconcileArtworkDeletion(item)");
    expect(service).toContain("storageVerifiedAt");
    expect(service).toContain("completedAt");
  });

  it("keeps history until every object is authoritatively deleted", () => {
    const reconcile = service.indexOf("reconcileExactStoredAudioDeletion(storage.audio, item)");
    const historyDelete = service.indexOf("async function deleteVersionHistory");
    expect(reconcile).toBeGreaterThan(-1);
    expect(historyDelete).toBeGreaterThan(reconcile);
    expect(service).toContain("set_config('skitza.song_deletion_operation_id'");
  });

  it("returns completed or storage-verified receipts before every R2 reconciliation", () => {
    const verification = service.slice(
      service.indexOf("async function verifyStorageDeletion"),
      service.indexOf("function sameStringSet"),
    );
    const settledReceipt = verification.indexOf(
      "if (operation.completedAt || operation.storageVerifiedAt) return operation",
    );
    const reconciliationCalls = [
      verification.indexOf("reconcileExactStoredAudioDeletion(storage.audio, item)"),
      verification.indexOf("storage.reconcileArtworkDeletion(item)"),
      verification.indexOf("storage.reconcileFirstVersionFinalDeletion(item)"),
      verification.indexOf("storage.reconcileFirstVersionStagingDeletion(item)"),
      verification.indexOf("storage.reconcilePeaksDeletion(item)"),
    ];

    expect(settledReceipt).toBeGreaterThanOrEqual(0);
    for (const reconciliation of reconciliationCalls) {
      expect(reconciliation).toBeGreaterThan(settledReceipt);
    }
  });

  it("receives completed V1 staging only after its durable write-once seal", () => {
    const manifestLoad = service.slice(
      service.indexOf("async function loadFirstVersionManifests"),
      service.indexOf("async function prepareVersionDeletion"),
    );
    const sealedProjection = manifestLoad.indexOf(
      "firstVersionUploadIntents.stagingSealedAt} IS NOT NULL",
    );
    const completedOnly = manifestLoad.indexOf(
      "isNotNull(firstVersionUploadIntents.completedAt)",
      sealedProjection,
    );
    const rowLock = manifestLoad.indexOf('.for("update")', completedOnly);
    const unsafeRejection = manifestLoad.indexOf(
      "intents.some((intent) => !intent.cleanupSafe)",
      rowLock,
    );
    const safeManifest = manifestLoad.indexOf("const staging = intents.map((intent) => ({", unsafeRejection);

    expect(sealedProjection).toBeGreaterThanOrEqual(0);
    expect(completedOnly).toBeGreaterThan(sealedProjection);
    expect(rowLock).toBeGreaterThan(completedOnly);
    expect(unsafeRejection).toBeGreaterThan(rowLock);
    expect(safeManifest).toBeGreaterThan(unsafeRejection);
    expect(manifestLoad).not.toContain("new Date");
  });

  it("uses database now for every deletion receipt state transition", () => {
    const versionPreparation = service.slice(
      service.indexOf("async function prepareVersionDeletion"),
      service.indexOf("async function prepareSongDeletion"),
    );
    const songPreparation = service.slice(
      service.indexOf("async function prepareSongDeletion"),
      service.indexOf("async function verifyStorageDeletion"),
    );
    const verification = service.slice(
      service.indexOf("async function verifyStorageDeletion"),
      service.indexOf("function sameStringSet"),
    );
    const completion = service.slice(
      service.indexOf("async function completeDeletion"),
      service.indexOf("export async function permanentlyDeleteSongVersion"),
    );

    expect(versionPreparation).toContain("const preparedAt = sql<Date>`now()`");
    expect(songPreparation).toContain("const preparedAt = sql<Date>`now()`");
    expect(verification).toContain(".set({ storageVerifiedAt: sql`now()` })");
    expect(completion).toContain(".set({ completedAt: sql`now()` })");
    expect(service).not.toMatch(
      /(?:preparedAt|storageVerifiedAt|completedAt)\s*(?:=|:)\s*new Date\(/,
    );
  });

  it("reconciles receipt-bound first-Version final, staging, and legacy waveform objects", () => {
    const verification = service.slice(
      service.indexOf("async function verifyStorageDeletion"),
      service.indexOf("function sameStringSet"),
    );
    const audio = verification.indexOf("reconcileExactStoredAudioDeletion(storage.audio, item)");
    const artwork = verification.indexOf("storage.reconcileArtworkDeletion(item)");
    const firstVersionFinal = verification.indexOf(
      "storage.reconcileFirstVersionFinalDeletion(item)",
    );
    const firstVersionStaging = verification.indexOf(
      "storage.reconcileFirstVersionStagingDeletion(item)",
    );
    const peaks = verification.indexOf("storage.reconcilePeaksDeletion(item)");
    const verificationReceipt = verification.indexOf(".set({ storageVerifiedAt:", peaks);

    expect(service).toContain("firstVersionStagingManifest:");
    expect(service).toContain("firstVersionFinalManifest:");
    expect(service).toContain("peaksManifest,");
    expect(audio).toBeGreaterThanOrEqual(0);
    expect(artwork).toBeGreaterThan(audio);
    expect(firstVersionFinal).toBeGreaterThan(artwork);
    expect(firstVersionStaging).toBeGreaterThan(firstVersionFinal);
    expect(peaks).toBeGreaterThan(firstVersionStaging);
    expect(verificationReceipt).toBeGreaterThan(peaks);
    expect(router.match(/reconcileFirstVersionStagingDeletion,/g)).toHaveLength(3);
    expect(router.match(/reconcileFirstVersionFinalDeletion,/g)).toHaveLength(3);
    expect(router.match(/reconcilePeaksDeletion: reconcileLegacyPeaksDeletion,/g)).toHaveLength(2);
  });

  it("freezes independently keyed portfolio waveforms before deleting matched portfolio rows", () => {
    const portfolioLoad = service.slice(
      service.indexOf("async function loadMatchingPortfolioTracks"),
      service.indexOf("async function assertPeaksManifestExclusive"),
    );
    const rowLock = portfolioLoad.indexOf('.for("update")');
    const exactEntryDedupe = portfolioLoad.indexOf("seenEntries.has(identity)", rowLock);
    const portfolioPeaks = portfolioLoad.indexOf(
      'append(track.versionId, track.peaksR2Key, "portfolio")',
      exactEntryDedupe,
    );
    const versionPreparation = service.slice(
      service.indexOf("async function prepareVersionDeletion"),
      service.indexOf("async function prepareSongDeletion"),
    );
    const matchingRows = versionPreparation.indexOf(
      "const matchingPortfolioTracks = await loadMatchingPortfolioTracks",
    );
    const frozenManifest = versionPreparation.indexOf(
      "peaksManifestItems([target], matchingPortfolioTracks)",
      matchingRows,
    );
    const exactRowDelete = versionPreparation.indexOf(
      "matchingPortfolioTracks.map((track) => track.id)",
      frozenManifest,
    );
    const operationInsert = versionPreparation.indexOf(
      ".insert(songDeletionOperations)",
      exactRowDelete,
    );

    expect(portfolioLoad).toContain("peaksR2Key: portfolioTracks.peaksR2Key");
    expect(rowLock).toBeGreaterThanOrEqual(0);
    expect(exactEntryDedupe).toBeGreaterThan(rowLock);
    expect(portfolioPeaks).toBeGreaterThan(exactEntryDedupe);
    expect(matchingRows).toBeGreaterThanOrEqual(0);
    expect(frozenManifest).toBeGreaterThan(matchingRows);
    expect(exactRowDelete).toBeGreaterThan(frozenManifest);
    expect(operationInsert).toBeGreaterThan(exactRowDelete);
    expect(service).toContain("const seenEntries = new Set<string>()");
    expect(service).not.toContain("const seenVersions = new Set<string>()");
  });

  it("removes a completed first-Version intent only after its staging receipt is verified", () => {
    const completion = service.slice(
      service.indexOf("async function completeDeletion"),
      service.indexOf("export async function permanentlyDeleteSongVersion"),
    );
    const verifiedReceipt = completion.indexOf("if (!current.storageVerifiedAt)");
    const historyCall = completion.indexOf("await deleteVersionHistory", verifiedReceipt);
    const historyDeletion = service.slice(
      service.indexOf("async function deleteVersionHistory"),
      service.indexOf("async function completeDeletion"),
    );
    const intentDelete = historyDeletion.indexOf(".delete(firstVersionUploadIntents)");
    const producerScope = historyDeletion.indexOf(
      "eq(firstVersionUploadIntents.producerId, input.producerId)",
      intentDelete,
    );
    const trackScope = historyDeletion.indexOf(
      "eq(firstVersionUploadIntents.trackId, input.trackId)",
      producerScope,
    );
    const versionScope = historyDeletion.indexOf(
      "eq(firstVersionUploadIntents.versionId, input.versionId)",
      trackScope,
    );
    const completedOnly = historyDeletion.indexOf(
      "isNotNull(firstVersionUploadIntents.completedAt)",
      versionScope,
    );
    const versionDelete = historyDeletion.indexOf(".delete(trackVersions)", completedOnly);

    expect(verifiedReceipt).toBeGreaterThanOrEqual(0);
    expect(historyCall).toBeGreaterThan(verifiedReceipt);
    expect(intentDelete).toBeGreaterThanOrEqual(0);
    expect(producerScope).toBeGreaterThan(intentDelete);
    expect(trackScope).toBeGreaterThan(producerScope);
    expect(versionScope).toBeGreaterThan(trackScope);
    expect(completedOnly).toBeGreaterThan(versionScope);
    expect(versionDelete).toBeGreaterThan(completedOnly);
  });

  it("captures, erases, and removes a completed first-Version intent from an empty Song", () => {
    const songPreparation = service.slice(
      service.indexOf("async function prepareSongDeletion"),
      service.indexOf("async function verifyStorageDeletion"),
    );
    const finalInvariant = service.slice(
      service.indexOf("async function assertPreparedTargetsUnchanged"),
      service.indexOf("async function deleteVersionHistory"),
    );
    const completion = service.slice(
      service.indexOf("async function completeDeletion"),
      service.indexOf("export async function permanentlyDeleteSongVersion"),
    );
    const songBranch = completion.slice(completion.indexOf("} else {"));
    const targetLoop = songBranch.indexOf("for (const versionId of current.targetVersionIds)");
    const trackIntentDelete = songBranch.indexOf(".delete(firstVersionUploadIntents)", targetLoop);
    const producerScope = songBranch.indexOf(
      "eq(firstVersionUploadIntents.producerId, producerId)",
      trackIntentDelete,
    );
    const trackScope = songBranch.indexOf(
      "eq(firstVersionUploadIntents.trackId, current.trackId)",
      producerScope,
    );

    expect(songPreparation).toMatch(
      /loadFirstVersionManifests\(tx,[\s\S]*?trackId: scope\.trackId,[\s\S]*?versionIds: null,[\s\S]*?audioManifest/,
    );
    expect(songPreparation).toContain(
      "firstVersionFinalManifest: firstVersionManifests.final",
    );
    expect(service).toContain("finalKey: firstVersionUploadIntents.audioR2Key");
    expect(service).toContain("const versionOwner = versionAudioByKey.get(intent.finalKey)");
    expect(service).toContain("storage.reconcileFirstVersionFinalDeletion(item)");
    expect(finalInvariant).toContain("operation.firstVersionFinalManifest.map");
    expect(finalInvariant).toContain("currentFirstVersion.final");
    expect(finalInvariant).toContain(
      'versionIds: operation.kind === "song" ? null : operation.targetVersionIds',
    );
    expect(service).toContain('(kind === "version" && !targetIds.has(row.versionId))');
    expect(targetLoop).toBeGreaterThanOrEqual(0);
    expect(trackIntentDelete).toBeGreaterThan(targetLoop);
    expect(producerScope).toBeGreaterThan(trackIntentDelete);
    expect(trackScope).toBeGreaterThan(producerScope);
  });

  it("disables the public link when deleting the last live stored Version", () => {
    const versionPreparation = service.slice(
      service.indexOf("async function prepareVersionDeletion"),
      service.indexOf("async function prepareSongDeletion"),
    );
    const publicStoredVersions = versionPreparation.indexOf(
      "const publicStoredVersions = selectPublicStoredVersions(versions",
    );
    const remainingPublicStoredVersionCount = versionPreparation.indexOf(
      "const remainingPublicStoredVersionCount",
      publicStoredVersions,
    );
    const removesLastPublicStoredAudio = versionPreparation.indexOf(
      "const removesLastPublicStoredAudio",
      remainingPublicStoredVersionCount,
    );
    const condition = versionPreparation.indexOf(
      "if (removesLastPublicStoredAudio)",
      removesLastPublicStoredAudio,
    );
    const publicLinkUpdate = versionPreparation.indexOf(".update(songPublicLinks)", condition);
    const disable = versionPreparation.indexOf(
      ".set({ disabledAt: preparedAt, updatedAt: preparedAt })",
      publicLinkUpdate,
    );
    const activeLinkGuard = versionPreparation.indexOf(
      "isNull(songPublicLinks.disabledAt)",
      disable,
    );
    const operationInsert = versionPreparation.indexOf(
      ".insert(songDeletionOperations)",
      activeLinkGuard,
    );
    const remainingDerivation = versionPreparation.slice(
      remainingPublicStoredVersionCount,
      removesLastPublicStoredAudio,
    );
    const removalDecision = versionPreparation.slice(
      removesLastPublicStoredAudio,
      versionPreparation.indexOf("const targetAudio", removesLastPublicStoredAudio),
    );

    expect(publicStoredVersions).toBeGreaterThanOrEqual(0);
    expect(remainingPublicStoredVersionCount).toBeGreaterThan(publicStoredVersions);
    expect(remainingDerivation).toContain("publicStoredVersions.filter");
    expect(remainingDerivation).toContain("version.id !== target.id");
    expect(removesLastPublicStoredAudio).toBeGreaterThan(remainingPublicStoredVersionCount);
    expect(removalDecision).toContain("publicStoredVersions.some");
    expect(removalDecision).toContain("version.id === target.id");
    expect(removalDecision).toContain("remainingPublicStoredVersionCount === 0");
    expect(condition).toBeGreaterThan(removesLastPublicStoredAudio);
    expect(publicLinkUpdate).toBeGreaterThan(condition);
    expect(disable).toBeGreaterThan(publicLinkUpdate);
    expect(activeLinkGuard).toBeGreaterThan(disable);
    expect(operationInsert).toBeGreaterThan(activeLinkGuard);
  });

  it("freezes every sibling upload before preparing a Version deletion", () => {
    const versionPreparation = service.slice(
      service.indexOf("async function prepareVersionDeletion"),
      service.indexOf("async function prepareSongDeletion"),
    );
    const lockAllVersions = versionPreparation.indexOf(".from(trackVersions)");
    const pendingGuard = versionPreparation.indexOf(
      "if (versions.some(versionHasPendingUpload))",
      lockAllVersions,
    );
    const operationInsert = versionPreparation.indexOf(
      ".insert(songDeletionOperations)",
      pendingGuard,
    );

    expect(lockAllVersions).toBeGreaterThanOrEqual(0);
    expect(pendingGuard).toBeGreaterThan(lockAllVersions);
    expect(operationInsert).toBeGreaterThan(pendingGuard);
  });

  it("removes only target history while preserving the Project and bookings", () => {
    expect(service).toContain(".delete(trackComments)");
    expect(service).toContain(".delete(versionApprovalEvents)");
    expect(service).toContain(".delete(purchaseDownloadOverrideEvents)");
    expect(service).toContain(".delete(songPublicAccessEvents)");
    expect(service).toContain(".delete(trackVersions)");
    expect(service).toContain(".set({ songId: null })");
    expect(service).toContain(".delete(projectTracks)");
    expect(service).not.toContain(".delete(projects)");
    expect(service).not.toContain(".delete(purchases)");
    expect(service).not.toContain(".delete(bookings)");
  });

  it("exposes separate strong-confirmation endpoints", () => {
    expect(router).toContain("permanentlyDeleteSongVersion: producerProcedure");
    expect(router).toContain('confirmation: z.literal("DELETE_VERSION")');
    expect(router).toContain("permanentlyDeleteSong: producerProcedure");
    expect(router).toContain('confirmation: z.literal("DELETE_SONG")');
  });
});
