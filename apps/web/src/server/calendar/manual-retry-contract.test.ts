import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./manual-retry.ts", import.meta.url)), "utf8");

describe("manual calendar retry Postgres contract", () => {
  it("locks and targets the exact tenant job before inspecting retry state", () => {
    expect(source).toContain("eq(calendarSyncJobs.id, input.jobId)");
    expect(source).toContain("eq(calendarSyncJobs.producerId, input.producerId)");
    expect(source).toContain('.for("update")');
    expect(source).toContain("eq(calendarSyncJobManualRetries.operationKey, input.operationKey)");
  });

  it("writes the immutable prior-cycle audit before the guarded terminal reset", () => {
    const auditInsert = source.indexOf("tx.insert(calendarSyncJobManualRetries)");
    const jobUpdate = source.indexOf(".update(calendarSyncJobs)");
    expect(auditInsert).toBeGreaterThan(0);
    expect(jobUpdate).toBeGreaterThan(auditInsert);
    for (const field of [
      "priorIdempotencyKey: job.idempotencyKey",
      "priorAttemptCount: job.attemptCount",
      "priorFirstAttemptAt: job.firstAttemptAt",
      "priorLastAttemptAt: job.lastAttemptAt",
      "priorProviderDedupeExpiresAt: job.providerDedupeExpiresAt",
      "priorLastError: job.lastError",
      "priorTerminalAt: job.terminalAt",
      "priorTerminalError: job.terminalError",
    ]) {
      expect(source).toContain(field);
    }
  });

  it("resets only delivery-cycle state and guards the terminal generation", () => {
    expect(source).toContain('status: "pending"');
    expect(source).toContain("idempotencyKey,");
    expect(source).toContain("attemptCount: 0");
    expect(source).toContain("firstAttemptAt: null");
    expect(source).toContain("providerDedupeExpiresAt: null");
    expect(source).toContain("terminalAt: null");
    expect(source).toContain("manualRetryCount: retryNumber");
    expect(source).toContain('eq(calendarSyncJobs.status, "terminal")');
    expect(source).toContain("eq(calendarSyncJobs.manualRetryCount, job.manualRetryCount)");
  });
});
