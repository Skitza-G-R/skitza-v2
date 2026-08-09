import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pendingSource = readFileSync(
  new URL("../../../audio/pending-multipart-initiation.ts", import.meta.url),
  "utf8",
);
const firstVersionSource = readFileSync(
  new URL("../../../trpc/routers/first-version-upload.ts", import.meta.url),
  "utf8",
);
const audioRouterSource = readFileSync(
  new URL("../../../trpc/routers/audio.ts", import.meta.url),
  "utf8",
);

describe("producer audio quota wiring", () => {
  it("serializes a new multipart reservation before project/purchase locks", () => {
    const stage = pendingSource.slice(
      pendingSource.indexOf("const staged = await ctx.db.transaction"),
      pendingSource.indexOf("const prepared = await reconcilePendingInitiation"),
    );
    const producerLock = stage.indexOf("lockProducerAudioStorageQuota");
    const firstProjectLock = stage.indexOf("pg_advisory_xact_lock");
    const existingPending = stage.indexOf("if (pending)");
    const capacityCheck = stage.indexOf("assertProducerAudioStorageAvailable");
    const journalUpdate = stage.indexOf(".update(trackVersions)");

    expect(producerLock).toBeGreaterThan(0);
    expect(producerLock).toBeLessThan(firstProjectLock);
    expect(capacityCheck).toBeGreaterThan(existingPending);
    expect(capacityCheck).toBeLessThan(journalUpdate);
  });

  it("serializes and reserves a first-Version intent in the same transaction", () => {
    const prepare = firstVersionSource.slice(
      firstVersionSource.indexOf("  prepare:"),
      firstVersionSource.indexOf("\n\n  finalize:"),
    );
    const transaction = prepare.indexOf("ctx.db.transaction");
    const producerLock = prepare.indexOf("lockProducerAudioStorageQuota", transaction);
    const retryRecheck = prepare.indexOf("const [racedExisting]", producerLock);
    const capacityCheck = prepare.indexOf("assertProducerAudioStorageAvailable", retryRecheck);
    const intentInsert = prepare.indexOf(".insert(firstVersionUploadIntents)", capacityCheck);

    expect(transaction).toBeGreaterThan(0);
    expect(producerLock).toBeGreaterThan(transaction);
    expect(retryRecheck).toBeGreaterThan(producerLock);
    expect(capacityCheck).toBeGreaterThan(retryRecheck);
    expect(intentInsert).toBeGreaterThan(capacityCheck);
  });

  it("holds the producer quota lock while rechecking an intent and issuing its upload URL", () => {
    const prepare = firstVersionSource.slice(
      firstVersionSource.indexOf("  prepare:"),
      firstVersionSource.indexOf("\n\n  finalize:"),
    );
    const presign = prepare.slice(
      prepare.indexOf("presign: () =>"),
      prepare.indexOf("compensate: async"),
    );
    const transaction = presign.indexOf("ctx.db.transaction");
    const producerLock = presign.indexOf("lockProducerAudioStorageQuota", transaction);
    const intentLookup = presign.indexOf(".from(firstVersionUploadIntents)", producerLock);
    const intentRowLock = presign.indexOf('.for("update")', intentLookup);
    const intentRecheck = presign.indexOf("assertIntentCanUpload(lockedIntent", intentRowLock);
    const uploadUrl = presign.indexOf("createFirstVersionUploadUrl", intentRecheck);
    const persistedExpiry = presign.indexOf("latestUploadUrlExpiresAt", uploadUrl);
    const persistedWriteOnce = presign.indexOf("uploadUrlWriteOnceProtectedAt", uploadUrl);

    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(producerLock).toBeGreaterThan(transaction);
    expect(intentLookup).toBeGreaterThan(producerLock);
    expect(intentRowLock).toBeGreaterThan(intentLookup);
    expect(intentRecheck).toBeGreaterThan(intentRowLock);
    expect(uploadUrl).toBeGreaterThan(intentRecheck);
    expect(persistedExpiry).toBeGreaterThan(uploadUrl);
    expect(persistedWriteOnce).toBeGreaterThan(uploadUrl);
  });

  it("holds the producer quota lock from first-Version intent locking through completion", () => {
    const complete = firstVersionSource.slice(
      firstVersionSource.indexOf("  complete:"),
      firstVersionSource.indexOf("\n\n  cancel:"),
    );
    const transaction = complete.indexOf("const completed = await ctx.db.transaction");
    const producerLock = complete.indexOf("lockProducerAudioStorageQuota", transaction);
    const intentLookup = complete.indexOf(".from(firstVersionUploadIntents)", producerLock);
    const intentRowLock = complete.indexOf('.for("update")', intentLookup);
    const projectLock = complete.indexOf(
      "hashtextextended(${lockedIntent.projectId}",
      intentRowLock,
    );
    const purchaseLock = complete.indexOf(
      "hashtextextended(${lockedIntent.purchaseId}",
      projectLock,
    );
    const storageFinalization = complete.indexOf("finalizeFirstVersionUpload", purchaseLock);
    const stagingSeal = complete.indexOf("sealFirstVersionStagingUpload", storageFinalization);
    const versionInsert = complete.indexOf(".insert(trackVersions)", storageFinalization);
    const intentCompletion = complete.indexOf(".update(firstVersionUploadIntents)", versionInsert);

    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(producerLock).toBeGreaterThan(transaction);
    expect(intentLookup).toBeGreaterThan(producerLock);
    expect(intentRowLock).toBeGreaterThan(intentLookup);
    expect(projectLock).toBeGreaterThan(intentRowLock);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(storageFinalization).toBeGreaterThan(purchaseLock);
    expect(stagingSeal).toBeGreaterThan(storageFinalization);
    expect(stagingSeal).toBeLessThan(versionInsert);
    expect(versionInsert).toBeGreaterThan(storageFinalization);
    expect(intentCompletion).toBeGreaterThan(versionInsert);
  });

  it("exposes producer-scoped usage and uses the shared cap at every multipart boundary", () => {
    expect(audioRouterSource).toMatch(
      /storageUsage:\s*producerProcedure\.query\([\s\S]*?readProducerAudioStorageQuota\(ctx\.db, ctx\.producerId\)/,
    );
    expect(audioRouterSource).toMatch(
      /reconcileStorageUsage:\s*producerProcedure\.mutation\([\s\S]*?reconcileProducerFirstVersionUploadReservations\(ctx\.db, ctx\.producerId\)/,
    );
    expect(audioRouterSource.match(/\.max\(AUDIO_UPLOAD_MAX_BYTES\)/g)).toHaveLength(3);
    expect(audioRouterSource).not.toContain("500 * 1024 * 1024");
  });
});
