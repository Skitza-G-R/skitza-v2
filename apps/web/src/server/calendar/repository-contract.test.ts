import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./repository.ts", import.meta.url)), "utf8");

describe("calendar delivery Postgres repository contract", () => {
  it("claims due and stale jobs with row locks that skip another worker's lease batch", () => {
    expect(source).toContain('eq(calendarSyncJobs.status, "pending")');
    expect(source).toContain("lte(calendarSyncJobs.nextAttemptAt, input.now)");
    expect(source).toContain('eq(calendarSyncJobs.status, "processing")');
    expect(source).toContain("lte(calendarSyncJobs.leaseExpiresAt, input.now)");
    expect(source).toContain('.for("update", { skipLocked: true })');
  });

  it("uses one monotonic timestamp for the lease and attempt audit", () => {
    expect(source).toContain("attemptCount: sql`${calendarSyncJobs.attemptCount} + 1`");
    expect(source).toContain("leaseAcquiredAt: claimedAt");
    expect(source).toContain("lastAttemptAt: claimedAt");
    expect(source).toContain("firstAttemptAt: candidate.firstAttemptAt ?? claimedAt");
    expect(source).toContain("candidate.providerDedupeExpiresAt ??");
  });

  it("resolves only the exact producer-owned processing lease", () => {
    expect(source.match(/eq\(calendarSyncJobs\.producerId, input\.producerId\)/gu)).toHaveLength(3);
    expect(source.match(/eq\(calendarSyncJobs\.status, "processing"\)/gu)).toHaveLength(4);
    expect(source.match(/eq\(calendarSyncJobs\.leaseToken, input\.leaseToken\)/gu)).toHaveLength(3);
  });
});
