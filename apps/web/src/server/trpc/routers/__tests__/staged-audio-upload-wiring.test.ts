import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(new URL("../first-version-upload.ts", import.meta.url), "utf8");
const actionSource = readFileSync(
  new URL(
    "../../../../app/(producer)/dashboard/clients-projects/upload-actions.ts",
    import.meta.url,
  ),
  "utf8",
);

function procedure(start: string, end: string): string {
  const startIndex = routerSource.indexOf(start);
  const endIndex = routerSource.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return routerSource.slice(startIndex, endIndex);
}

describe("generic staged audio upload wiring", () => {
  it("stages every supported audio file without destination or Song metadata", () => {
    const input = routerSource.slice(
      routerSource.indexOf("const stageInput"),
      routerSource.indexOf("const finalizeInput"),
    );
    expect(input).toContain("operationKey");
    expect(input).toContain("filename");
    expect(input).toContain("sizeBytes");
    expect(input).toContain("contentType");
    expect(input).not.toContain("projectId");
    expect(input).not.toContain("title");
    expect(input).not.toContain("label");

    const stage = procedure("  stage:", "\n\n  prepare:");
    expect(stage).toContain("createStagedAudioRequestDigest");
    expect(stage).toContain("assertFirstVersionAudioFile(input)");
    expect(stage.indexOf("lockProducerAudioStorageQuota")).toBeLessThan(
      stage.indexOf("assertProducerAudioStorageAvailable"),
    );
    expect(stage.indexOf("assertProducerAudioStorageAvailable")).toBeLessThan(
      stage.indexOf(".insert(firstVersionUploadIntents)"),
    );
    expect(stage).not.toContain(".insert(projectTracks)");
    expect(stage).not.toContain(".insert(trackVersions)");
  });

  it("freezes finalization before storage and atomically creates only complete music rows", () => {
    const finalize = procedure("  finalize:", "\n\n  complete:");
    const bindingUpdate = finalize.indexOf("isNull(firstVersionUploadIntents.finalizationDigest)");
    const remoteFinalize = finalize.indexOf("finalizeFirstVersionUpload");
    const versionInsert = finalize.indexOf("tx.insert(trackVersions)");
    const intentCompletion = finalize.indexOf("completedAt: sql`now()`");

    expect(finalize).toContain("createAudioFinalizationDigest");
    expect(bindingUpdate).toBeGreaterThan(0);
    expect(remoteFinalize).toBeGreaterThan(bindingUpdate);
    expect(versionInsert).toBeGreaterThan(remoteFinalize);
    expect(intentCompletion).toBeGreaterThan(versionInsert);
    expect(finalize).toContain("if (lockedIntent.createsTrack)");
    expect(finalize).toContain("await tx.insert(projectTracks)");
    expect(finalize).not.toContain("audioUrl: null");
  });

  it("rechecks existing-Song ownership, lifecycle, approval, and public exposure under locks", () => {
    const finalize = procedure("  finalize:", "\n\n  complete:");
    expect(finalize).toContain("assertActiveVersionUploadLifecycle");
    expect(finalize).toContain("currentTrackArtistApprovalAction");
    expect(finalize).toContain("requireSongUploadPublicExposureAcknowledgement");
    expect(finalize).toMatch(
      /eq\(songPublicLinks\.trackId, lockedIntent\.trackId\)[\s\S]*?eq\(songPublicLinks\.purchaseId, lockedIntent\.purchaseId\)[\s\S]*?eq\(songPublicLinks\.producerId, ctx\.producerId\)[\s\S]*?\.for\("update"\)/,
    );
  });

  it("keeps staged work producer-scoped and reuses exact cancel cleanup", () => {
    const stage = procedure("  stage:", "\n\n  prepare:");
    const finalize = procedure("  finalize:", "\n\n  complete:");
    const cancel = routerSource.slice(routerSource.indexOf("  cancel:"));
    for (const source of [stage, finalize, cancel]) {
      expect(source).toContain("eq(firstVersionUploadIntents.producerId, ctx.producerId)");
    }
    expect(cancel).toContain("reconcileFirstVersionFinalDeletion");
    expect(cancel).toContain("sealFirstVersionIntentStorage");
  });

  it("returns exact new IDs and invalidates producer and artist read surfaces", () => {
    expect(actionSource).toContain("export async function stageAudioUploadAction");
    expect(actionSource).toContain("export async function finalizeAudioUploadAction");
    expect(actionSource).toContain("export async function cancelStagedAudioUploadAction");
    expect(actionSource).toContain("c.caller.firstVersionUpload.stage(input)");
    expect(actionSource).toContain("c.caller.firstVersionUpload.finalize(input)");
    expect(actionSource).toContain("revalidatePath(`${MUSIC_LIBRARY_PATH}/${data.versionId}`)");
    expect(actionSource).toContain('revalidatePath("/dashboard/portfolio")');
    expect(actionSource).toContain('revalidatePath("/artist", "layout")');
    expect(actionSource).toContain("revalidatePath(`/artist/music/song/${data.versionId}`)");
    expect(actionSource).toContain('revalidatePath("/join/[slug]", "page")');
    expect(actionSource).toContain('revalidatePath("/listen/[token]", "page")');

    const finalize = procedure("  finalize:", "\n\n  complete:");
    expect(finalize).toMatch(
      /projectId: completed\.intent\.projectId,[\s\S]*?trackId: completed\.intent\.trackId,[\s\S]*?versionId: completed\.intent\.versionId/,
    );
    expect(finalize.indexOf("scheduleStagedAudioArtistDelivery")).toBeGreaterThan(
      finalize.indexOf("tx.insert(trackVersions)"),
    );
  });

  it("invalidates caches only at the terminal finalization boundary", () => {
    const stageAction = actionSource.slice(
      actionSource.indexOf("export async function stageAudioUploadAction"),
      actionSource.indexOf("export async function finalizeAudioUploadAction"),
    );
    const finalizeAction = actionSource.slice(
      actionSource.indexOf("export async function finalizeAudioUploadAction"),
      actionSource.indexOf("export async function cancelStagedAudioUploadAction"),
    );
    const cancelAction = actionSource.slice(
      actionSource.indexOf("export async function cancelStagedAudioUploadAction"),
      actionSource.indexOf("export type PreparedFirstVersionUpload"),
    );

    expect(stageAction).not.toContain("revalidatePath(");
    expect(cancelAction).not.toContain("revalidatePath(");
    expect(finalizeAction).toContain('revalidatePath("/artist", "layout")');
    expect(finalizeAction).toContain('revalidatePath("/join/[slug]", "page")');
    expect(finalizeAction).toContain('revalidatePath("/listen/[token]", "page")');
  });

  it("lazily upgrades only a fully bound legacy intent under producer and row locks", () => {
    const helper = routerSource.slice(
      routerSource.indexOf("function assertLegacyIntentCanUpgrade"),
      routerSource.indexOf("function normalizedFinalizeInput"),
    );
    const prepare = procedure("  prepare:", "\n\n  finalize:");
    const complete = procedure("  complete:", "\n\n  cancel:");
    const finalize = procedure("  finalize:", "\n\n  complete:");

    expect(helper).toMatch(
      /!intent\.projectId[\s\S]*?!intent\.purchaseId[\s\S]*?!intent\.title[\s\S]*?!intent\.label/,
    );
    expect(helper).toContain("intent.createsTrack === null && intent.finalizationDigest === null");
    expect(helper).toMatch(
      /\.update\(firstVersionUploadIntents\)[\s\S]*createsTrack: true,[\s\S]*finalizationDigest: requestDigest[\s\S]*eq\(firstVersionUploadIntents\.id, intent\.id\)[\s\S]*eq\(firstVersionUploadIntents\.producerId, producerId\)/,
    );
    for (const legacyProcedure of [prepare, complete]) {
      const quotaLock = legacyProcedure.indexOf("lockProducerAudioStorageQuota");
      const rowLock = legacyProcedure.indexOf('.for("update")', quotaLock);
      const upgrade = legacyProcedure.indexOf("upgradeLegacyIntentIfNeeded", rowLock);
      expect(quotaLock).toBeGreaterThan(0);
      expect(rowLock).toBeGreaterThan(quotaLock);
      expect(upgrade).toBeGreaterThan(rowLock);
    }
    expect(finalize).toContain("This legacy upload must be finished from the flow that started it");
  });
});
