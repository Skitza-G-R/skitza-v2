import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../reconciliation.ts", import.meta.url), "utf8");
const routerSource = readFileSync(
  new URL("../../../trpc/routers/first-version-upload.ts", import.meta.url),
  "utf8",
);

describe("first-Version reservation reconciliation", () => {
  it("runs under the producer quota lock and re-reads exact usage", () => {
    const lock = source.indexOf("lockProducerAudioStorageQuota");
    const candidates = source.indexOf("const candidates", lock);
    const reread = source.indexOf("readProducerAudioStorageQuota(tx, producerId)", candidates);
    expect(lock).toBeGreaterThan(0);
    expect(candidates).toBeGreaterThan(lock);
    expect(reread).toBeGreaterThan(candidates);
  });

  it("never infers safety for a legacy unconditional capability from time", () => {
    expect(source).toContain("uploadUrlWriteOnceProtectedAt");
    expect(source).toContain("legacyUploadCapabilitiesRevokedAt");
    expect(source).toContain("latestUploadUrlExpiresAt} IS NULL");
    expect(source).not.toMatch(/latestUploadUrlExpiresAt[^\n]*(?:<|<=|now\()/);
    expect(source).not.toMatch(/legacyUploadCapabilitiesRevokedAt\s*:/);
    expect(routerSource).not.toMatch(/legacyUploadCapabilitiesRevokedAt\s*:/);
  });

  it("proves any orphan final key absent before sealing staging and releasing quota", () => {
    const finalCleanup = source.indexOf("await reconcileFirstVersionFinalDeletion");
    const stagingSeal = source.indexOf("await sealFirstVersionStagingUpload", finalCleanup);
    const dbSeal = source.indexOf("stagingSealedAt: sql`now()`", stagingSeal);
    expect(finalCleanup).toBeGreaterThan(0);
    expect(stagingSeal).toBeGreaterThan(finalCleanup);
    expect(dbSeal).toBeGreaterThan(stagingSeal);
  });
});
