import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/server/domain/audio-delivery/producer-download-state-db.ts"),
  "utf8",
);
const realDatabaseSource = readFileSync(
  join(
    process.cwd(),
    "src/server/domain/audio-delivery/__tests__/producer-download-state-real-db.integration.test.ts",
  ),
  "utf8",
);

describe("SK-144 producer download-state batch repository contract", () => {
  it("uses one transaction and the canonical lock order exactly once", () => {
    expect(source.match(/db\.transaction\(/g)).toHaveLength(1);
    expect(source.match(/pg_advisory_xact_lock/g)).toHaveLength(3);
    expect(source).toContain("projectAdvisoryLockKey(scope.projectId)");
    expect(source).toContain("hashtextextended(${scope.purchaseId}, 0)");
    expect(source).toContain("purchaseLedgerAdvisoryLockKey(scope.purchaseId)");
    expect(source.indexOf("projectAdvisoryLockKey(scope.projectId)")).toBeLessThan(
      source.indexOf("hashtextextended(${scope.purchaseId}, 0)"),
    );
    expect(source.indexOf("hashtextextended(${scope.purchaseId}, 0)")).toBeLessThan(
      source.indexOf("purchaseLedgerAdvisoryLockKey(scope.purchaseId)"),
    );
  });

  it("discovers and share-locks all exact tenant-owned versions in batch", () => {
    expect(source.match(/inArray\(trackVersions\.id/g)).toHaveLength(2);
    expect(source.match(/\.for\("share"\)/g)).toHaveLength(1);
    expect(source).toContain("eq(trackVersions.producerId, scope.producerId)");
    expect(source).toContain("eq(trackVersions.trackId, scope.trackId)");
    expect(source).toContain("eq(trackVersions.purchaseId, scope.purchaseId)");
    expect(source).toContain("eq(producers.clerkUserId, scope.actorClerkUserId)");
    expect(source).toContain("rows.length !== scope.versionIds.length");
  });

  it("folds the purchase ledger once and fetches only latest overrides in one query", () => {
    expect(source.match(/readPurchaseLedger\(/g)).toHaveLength(1);
    expect(source.match(/\.selectDistinctOn\(/g)).toHaveLength(1);
    expect(source.match(/\.from\(purchaseDownloadOverrideEvents\)/g)).toHaveLength(1);
    expect(source).toContain("eq(purchaseDownloadOverrideEvents.producerId, scope.producerId)");
    expect(source).toContain("eq(purchaseDownloadOverrideEvents.purchaseId, scope.purchaseId)");
    expect(source).toContain(
      "inArray(purchaseDownloadOverrideEvents.versionId, [...scope.versionIds])",
    );
  });

  it("keeps the executable database test isolated and mandatory in CI", () => {
    expect(realDatabaseSource).toContain("process.env.DATABASE_URL_TEST");
    expect(realDatabaseSource).not.toMatch(/process\.env\.DATABASE_URL\b/);
    expect(realDatabaseSource).toContain('process.env.CI === "true" && !testDatabaseUrl');
    expect(realDatabaseSource).toContain('set local search_path to "${testSchema}"');
    expect(realDatabaseSource).toContain('create schema ${schema}');
    expect(realDatabaseSource).toContain('drop schema "${testSchema}" cascade');
  });
});
