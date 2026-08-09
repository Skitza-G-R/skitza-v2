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
});
