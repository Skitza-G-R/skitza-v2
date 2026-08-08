import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(
  join(process.cwd(), "src/server/domain/song-artwork/service.ts"),
  "utf8",
);

describe("song artwork replacement concurrency", () => {
  it("locks and updates with the token's canonical UUID", () => {
    expect(service).toContain("song-artwork:${payload.trackId}");
    expect(service).not.toContain("song-artwork:${input.trackId}");
    expect(service).toContain("eq(projectTracks.id, payload.trackId)");
  });

  it("strictly orders deletion and replacement guards before storage and the row update", () => {
    const transactionStart = service.indexOf("const result = await db.transaction");
    const producerLock = service.indexOf(
      "lockProducerAudioStorageQuota(tx, input.producerId)",
      transactionStart,
    );
    const artworkLock = service.indexOf("song-artwork:${payload.trackId}", producerLock);
    const rowLock = service.indexOf('.for("update")', artworkLock);
    const pendingGuard = service.indexOf("await assertNoPendingSongDeletion(tx", rowLock);
    const revisionCheck = service.indexOf("payload.baseRevision", transactionStart);
    const finalize = service.indexOf("await storage.finalizeUpload(", revisionCheck);
    const rowUpdate = service.indexOf(".update(projectTracks)", finalize);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(producerLock).toBeGreaterThan(transactionStart);
    expect(artworkLock).toBeGreaterThan(producerLock);
    expect(rowLock).toBeGreaterThan(artworkLock);
    expect(pendingGuard).toBeGreaterThan(rowLock);
    expect(revisionCheck).toBeGreaterThan(pendingGuard);
    expect(finalize).toBeGreaterThan(revisionCheck);
    expect(rowUpdate).toBeGreaterThan(finalize);
  });
});
