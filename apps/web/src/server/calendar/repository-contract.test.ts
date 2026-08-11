import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./repository.ts", import.meta.url)), "utf8");

function repositoryMethodSource(name: string): string {
  const marker = `    ${name}:`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing calendar repository method: ${name}`);
  const afterStart = source.slice(start + marker.length);
  const nextMethodOffset = afterStart.search(/\n {4}[A-Za-z][A-Za-z0-9]*:/u);
  return nextMethodOffset < 0
    ? source.slice(start)
    : source.slice(start, start + marker.length + nextMethodOffset);
}

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

  it("resolves only the exact producer-owned processing lease in every resolution method", () => {
    const resolutionMethods = [
      "completeJob",
      "retryJob",
      "terminalJob",
      "prepareGoogleJob",
      "completeSupersededGoogleJob",
      "markGoogleNotificationAttempt",
      "completeGoogleJob",
      "enqueueIcsFallback",
    ];

    for (const methodName of resolutionMethods) {
      const method = repositoryMethodSource(methodName);
      expect(method, methodName).toContain("eq(calendarSyncJobs.producerId, input.producerId)");
      expect(method, methodName).toContain('eq(calendarSyncJobs.status, "processing")');
      expect(method, methodName).toContain("eq(calendarSyncJobs.leaseToken, input.leaseToken)");
    }

    expect(source).toContain("async function resolveFailedGoogleDelivery(");
    expect(repositoryMethodSource("retryGoogleJob")).toContain("resolveFailedGoogleDelivery");
    expect(repositoryMethodSource("terminalGoogleJob")).toContain("resolveFailedGoogleDelivery");
  });

  it("inserts the linked ICS fallback before switching the ledger without moving its reservation", () => {
    const fallback = repositoryMethodSource("enqueueIcsFallback");
    const jobInsert = fallback.indexOf(".insert(calendarSyncJobs)");
    const channelSwitch = fallback.indexOf(".update(bookingCalendarLinks)", jobInsert);
    expect(jobInsert).toBeGreaterThan(0);
    expect(channelSwitch).toBeGreaterThan(jobInsert);

    const switchSetEnd = fallback.indexOf(".where(", channelSwitch);
    const switchSet = fallback.slice(channelSwitch, switchSetEnd);
    expect(switchSet).toContain('invitationChannel: "ics"');
    expect(switchSet).not.toContain("invitationReservedAt");
    expect(switchSet).not.toContain("invitationDeliveredAt");
    expect(fallback).toContain('existing.status !== "pending"');
    expect(fallback).toContain('existing.status !== "processing"');
  });

  it("durably marks an exact Google notification attempt before delivery can complete", () => {
    const attempt = repositoryMethodSource("markGoogleNotificationAttempt");
    expect(attempt).toContain('mapped.payloadSnapshot.notificationMode !== "all"');
    expect(attempt).toContain('link.invitationChannel !== "google"');
    expect(attempt).toContain("link.invitationAttemptedAt !== null");
    expect(attempt).toContain("invitationAttemptedAt: attemptedAt");

    const completion = repositoryMethodSource("completeGoogleJob");
    expect(completion).toContain("link.invitationAttemptedAt === null");
  });

  it("keeps outbound delivery separate from inbound reconciliation jobs", () => {
    const claim = repositoryMethodSource("claimDueGoogleJobs");
    expect(claim).toContain('"upsert_google_event"');
    expect(claim).toContain('"delete_google_event"');
    expect(claim).not.toContain('"reconcile_google_event"');
    expect(claim).toContain("input.producerId");
    expect(claim).toContain("eq(calendarSyncJobs.producerId, input.producerId)");
    expect(claim).toContain("input.forcePending");

    const reconciliationClaim = repositoryMethodSource("claimDueGoogleReconciliationJobs");
    expect(reconciliationClaim).toContain(
      'eq(calendarSyncJobs.operation, "reconcile_google_event")',
    );
  });

  it("updates safe link health after outbound failure without hiding missing or conflict", () => {
    expect(source).toContain('link.syncState === "missing" || link.syncState === "conflict"');
    expect(source).toContain('const nextSyncState = input.terminal ? "not_synced" : "pending"');
    expect(source).toContain(
      'const nextSyncErrorCode = input.terminal ? "reconciliation_failed" : null',
    );
    expect(source).toContain("link.lastSyncErrorCode !== nextSyncErrorCode");
  });

  it("supersedes stale reconciliation work and guards failure health by the captured revision", () => {
    const preparation = repositoryMethodSource("prepareGoogleReconciliationJob");
    expect(preparation).toContain("job.desiredRevision < link.desiredRevision");
    expect(preparation).toContain("job.bookingId !== link.currentBookingId");
    expect(source).toContain("link.desiredRevision !== job.desiredRevision");
    expect(source).toContain("link.currentBookingId !== job.bookingId");
    expect(source).toContain("eq(bookingCalendarLinks.desiredRevision, job.desiredRevision)");
    expect(source).toContain("eq(bookingCalendarLinks.currentBookingId, job.bookingId)");
    expect(source).toContain("link.lastSyncErrorCode !== input.errorCode");
  });

  it("enqueues bounded future recovery work with a deterministic time bucket", () => {
    const recovery = repositoryMethodSource("enqueueGoogleReconciliationRecovery");
    expect(recovery).toContain('eq(bookingCalendarLinks.providerState, "active")');
    expect(recovery).toContain('eq(bookings.status, "confirmed")');
    expect(recovery).toContain('eq(googleCalendarConnections.status, "connected")');
    expect(recovery).toContain("15 * 60 * 1_000");
    expect(recovery).toContain("google:reconcile:recovery:");
    expect(recovery).toContain("asc nulls first");
    expect(recovery).toContain(".onConflictDoNothing()");
  });
});
