import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./repository-drizzle.ts", import.meta.url)),
  "utf8",
);

describe("Google Calendar Drizzle repository contract", () => {
  it("atomically consumes state once within the producer and expiry boundary", () => {
    expect(source).toContain("eq(googleCalendarOAuthStates.producerId, producerId)");
    expect(source).toContain("eq(googleCalendarOAuthStates.stateTokenDigest, tokenDigest)");
    expect(source).toContain("isNull(googleCalendarOAuthStates.consumedAt)");
    expect(source).toContain("gt(googleCalendarOAuthStates.expiresAt, consumedAt)");
    expect(source).toContain(".returning()");
  });

  it("locks the producer connection and rejects OAuth state older than disconnect", () => {
    expect(source).toContain('.for("update")');
    expect(source).toContain(
      "command.oauthStateCreatedAt.getTime() <= existing.disconnectedAt.getTime()",
    );
    expect(source).toContain('command.intent !== "switch_account"');
  });

  it("prevents late refresh failures and writes from reviving disconnected rows", () => {
    expect(source).toMatch(
      /notInArray\(\s*googleCalendarConnections\.status,\s*\[\s*"reconnect_required",\s*"disconnected",?\s*\]\s*\)/u,
    );
    expect(source).toContain('notInArray(googleCalendarConnections.status, ["disconnected"])');
    expect(source).toContain(".delete(googleCalendarOAuthStates)");
  });

  it("preserves valid flags but downgrades connected when destination access is lost", () => {
    expect(source).toContain("const keepsDestination =");
    expect(source).toContain('candidate.accessRole === "writer"');
    expect(source).toContain('candidate.accessRole === "owner"');
    expect(source).toContain('connection.status === "connected" && !hasValidSelection(rows)');
    expect(source).toContain('status: "needs_selection"');
  });

  it("removes provider handles and all credential envelope fields on disconnect", () => {
    expect(source).toContain(".delete(googleCalendarSelections)");
    expect(source).toContain("accessTokenCiphertext: null");
    expect(source).toContain("refreshTokenCiphertext: null");
    expect(source).toContain('status: "disconnected"');
  });

  it("preserves a completed ICS invitation when silently backfilling Google", () => {
    const initialSyncStart = source.indexOf("async enqueueFutureConfirmedEvents(command)");
    const initialSyncEnd = source.indexOf("async disconnect(command)", initialSyncStart);
    const initialSync = source.slice(initialSyncStart, initialSyncEnd);

    expect(initialSync).toContain('eq(calendarSyncJobs.deliveryChannel, "ics")');
    expect(initialSync).toContain('eq(calendarSyncJobs.operation, "send_ics")');
    expect(initialSync).toContain('eq(calendarSyncJobs.status, "completed")');
    expect(initialSync).toContain("preserveIcsInvitation ? candidate.calendarRevision : 0");
    expect(initialSync).toContain('preserveIcsInvitation ? "ics" : null');
    expect(initialSync).toContain("preserveIcsInvitation ? command.now : null");
    expect(initialSync).toContain("invitationAttemptedAt: sql<Date | null>`null`");
    expect(initialSync).toContain('notificationMode: "none"');
  });

  it("keeps pending holds and confirmed events on old destinations watched", () => {
    const targetStart = source.indexOf("async listRequiredCalendarWatchTargets(command)");
    const targetEnd = source.indexOf("async reserveCalendarWatch(command)", targetStart);
    const targets = source.slice(targetStart, targetEnd);

    expect(targets).toContain("eq(googleCalendarSelections.isDestination, true)");
    expect(targets).toContain("eq(bookingCalendarLinks.producerId, command.producerId)");
    expect(targets).toContain("eq(bookingCalendarLinks.connectionId, command.connectionId)");
    expect(targets).toContain("eq(bookingCalendarLinks.accountVersion, command.accountVersion)");
    expect(targets).toContain('eq(bookingCalendarLinks.providerState, "active")');
    expect(targets).toContain(
      'inArray(bookings.status, ["pending_approval", "confirmed"])',
    );
    expect(targets).toContain("gt(bookings.startsAt, command.now)");
    expect(targets).toContain("fingerprints.has(row.destinationCalendarIdFingerprint)");
  });

  it("does not keep terminal old-destination links watched", () => {
    const targetStart = source.indexOf("async listRequiredCalendarWatchTargets(command)");
    const targetEnd = source.indexOf("async reserveCalendarWatch(command)", targetStart);
    const targets = source.slice(targetStart, targetEnd);
    const repairStart = source.indexOf("async listCalendarWatchRepairProducerIds(command)");
    const repairEnd = source.indexOf("async saveCalendarSelection(command)", repairStart);
    const repair = source.slice(repairStart, repairEnd);

    for (const section of [targets, repair]) {
      expect(section).toContain(
        'inArray(bookings.status, ["pending_approval", "confirmed"])',
      );
      expect(section).not.toMatch(
        /inArray\(bookings\.status, \[[^\]]*(?:rejected|cancelled|completed|no_show)/u,
      );
    }
  });

  it("renews current-account watch snapshots without requiring is_destination", () => {
    const renewalStart = source.indexOf("async listCalendarWatchesDueForRenewal(command)");
    const renewalEnd = source.indexOf("async listCalendarWatchRepairProducerIds(command)");
    const renewal = source.slice(renewalStart, renewalEnd);

    expect(renewal).toContain(
      "eq(googleCalendarConnections.accountVersion, googleCalendarWatches.accountVersion)",
    );
    expect(renewal).toContain('eq(googleCalendarConnections.status, "connected")');
    expect(renewal).not.toContain("googleCalendarSelections.isDestination");
  });
});
