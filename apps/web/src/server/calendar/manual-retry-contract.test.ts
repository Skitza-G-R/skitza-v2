import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./manual-retry.ts", import.meta.url)), "utf8");

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("manual calendar retry Postgres contract", () => {
  it("lists only current terminal Google deliveries behind visible producer issues", () => {
    const listing = between(
      "export async function listRetryableTerminalGoogleCalendarJobs(",
      "export function calendarManualRetryRepository(",
    );

    expect(listing).toContain("eq(calendarSyncJobs.producerId, input.producerId)");
    expect(listing).toContain('eq(calendarSyncJobs.deliveryChannel, "google")');
    expect(listing).toContain('eq(calendarSyncJobs.status, "terminal")');
    expect(listing).toContain(
      "eq(calendarSyncJobs.desiredRevision, bookingCalendarLinks.desiredRevision)",
    );
    expect(listing).toContain('["not_synced", "missing", "conflict"]');
    expect(listing).toContain(".limit(input.limit)");
  });

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
