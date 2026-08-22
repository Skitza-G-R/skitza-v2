import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { producers, type Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarRepository } from "./repository";
import { createGoogleCalendarRepository } from "./repository-drizzle";

const source = readFileSync(
  fileURLToPath(new URL("./repository-drizzle.ts", import.meta.url)),
  "utf8",
);

describe("Google Calendar Drizzle repository contract", () => {
  it("looks up a pending state, then atomically consumes it within its producer boundary", () => {
    expect(source).toContain("async getOAuthState({ tokenDigest, now })");
    expect(source).toContain("gt(googleCalendarOAuthStates.expiresAt, now)");
    expect(source).toContain("eq(googleCalendarOAuthStates.producerId, producerId)");
    expect(source).toContain("eq(googleCalendarOAuthStates.stateTokenDigest, tokenDigest)");
    expect(source).toContain("isNull(googleCalendarOAuthStates.consumedAt)");
    expect(source).toContain("gt(googleCalendarOAuthStates.expiresAt, consumedAt)");
    expect(source).toContain(".returning()");
  });

  it("locks the exact open Producer before any OAuth connection or token write", () => {
    const commitStart = source.indexOf("async commitAuthorization(command)");
    const commitEnd = source.indexOf("async storeRefreshedAccessToken(command)", commitStart);
    const commit = source.slice(commitStart, commitEnd);
    const producerLock = commit.indexOf("lockedProducerAuthorizationState");
    const closedGuard = commit.indexOf("producer.closedAt !== null", producerLock);
    const connectionLock = commit.indexOf("lockedConnection", closedGuard);
    const insert = commit.indexOf(".insert(googleCalendarConnections)", connectionLock);
    const update = commit.indexOf(".update(googleCalendarConnections)", connectionLock);

    expect(producerLock).toBeGreaterThanOrEqual(0);
    expect(closedGuard).toBeGreaterThan(producerLock);
    expect(connectionLock).toBeGreaterThan(closedGuard);
    expect(insert).toBeGreaterThan(connectionLock);
    expect(update).toBeGreaterThan(connectionLock);
    expect(source).toMatch(
      /lockedProducerAuthorizationState[\s\S]*closedAt: producers\.closedAt[\s\S]*eq\(producers\.id, producerId\)[\s\S]*\.for\("update"\)/u,
    );
  });

  it("rejects a consumed callback against a closed Producer without touching credentials", async () => {
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
      for: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit.mockReturnValue(selectChain);
    selectChain.for.mockResolvedValue([
      { id: "11111111-1111-4111-8111-111111111111", closedAt: new Date("2026-08-14T12:00:00Z") },
    ]);
    const tx = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const transaction = vi.fn(
      async (work: (transaction: typeof tx) => Promise<unknown>): Promise<unknown> => work(tx),
    );
    const repository = createGoogleCalendarRepository({ transaction } as unknown as Db);
    const command: Parameters<GoogleCalendarRepository["commitAuthorization"]>[0] = {
      producerId: "11111111-1111-4111-8111-111111111111",
      intent: "connect",
      expectedConnectionId: null,
      expectedAccountVersion: null,
      oauthStateCreatedAt: new Date("2026-08-14T11:55:00Z"),
      targetConnectionId: "22222222-2222-4222-8222-222222222222",
      targetAccountVersion: 1,
      identity: {
        googleSubject: "google-subject",
        googleAccountEmail: "producer@example.test",
      },
      grantedScopes: ["calendar"],
      accessToken: {
        version: 1,
        keyVersion: 1,
        ciphertext: "access-ciphertext",
        iv: "access-iv",
        authTag: "access-tag",
      },
      accessTokenExpiresAt: new Date("2026-08-14T13:00:00Z"),
      refreshToken: {
        version: 1,
        keyVersion: 1,
        ciphertext: "refresh-ciphertext",
        iv: "refresh-iv",
        authTag: "refresh-tag",
      },
      authorizedAt: new Date("2026-08-14T12:01:00Z"),
    };

    await expect(repository.commitAuthorization(command)).resolves.toEqual({ outcome: "stale" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(selectChain.from).toHaveBeenCalledWith(producers);
    expect(selectChain.for).toHaveBeenCalledWith("update");
    expect(tx.select).toHaveBeenCalledOnce();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("keeps disconnect freshness checks after the Producer guard", () => {
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

  it("returns producer-scoped session details for sync issues without provider identifiers", () => {
    const summaryStart = source.indexOf("async getConnectionSyncSummary(command)");
    const summaryEnd = source.indexOf("async listCalendarWatches(command)", summaryStart);
    const summary = source.slice(summaryStart, summaryEnd);

    expect(summary).toContain("eq(bookingCalendarLinks.producerId, command.producerId)");
    expect(summary).toContain("eq(bookings.producerId, bookingCalendarLinks.producerId)");
    expect(summary).toContain("artistName: bookings.artistName");
    expect(summary).toContain("startsAt: bookings.startsAt");
    expect(summary).toContain("syncStateChangedAt: bookingCalendarLinks.syncStateChangedAt");
    expect(summary).toContain("attentionDismissedAt");
    expect(summary).toContain('["not_synced", "missing", "conflict"]');
    expect(summary).toContain(".limit(25)");
    expect(summary).not.toContain("providerEventId:");
    expect(summary).not.toContain("artistEmail:");
  });

  it("dismisses only the producer-scoped warning version the producer saw", () => {
    const dismissalStart = source.indexOf("export async function dismissGoogleCalendarSyncWarning");
    const dismissalEnd = source.indexOf(
      "export function createGoogleCalendarRepository",
      dismissalStart,
    );
    const dismissal = source.slice(dismissalStart, dismissalEnd);

    expect(dismissal).toContain("eq(bookingCalendarLinks.producerId, command.producerId)");
    expect(dismissal).toContain("eq(bookingCalendarLinks.currentBookingId, command.bookingId)");
    expect(dismissal).toContain("eq(bookingCalendarLinks.syncState, command.syncState)");
    expect(dismissal).toContain("bookingCalendarLinks.syncStateChangedAt");
    expect(dismissal).toContain("attentionDismissedAt");
    expect(dismissal).toContain(".returning({ id: bookingCalendarLinks.id })");
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

  it("uses the agreed project, producer, and artist identity during initial Google sync", () => {
    const initialSyncStart = source.indexOf("async enqueueFutureConfirmedEvents(command)");
    const initialSyncEnd = source.indexOf("async disconnect(command)", initialSyncStart);
    const initialSync = source.slice(initialSyncStart, initialSyncEnd);

    expect(initialSync).toContain("projectTitle: projects.title");
    expect(initialSync).toContain("producerName: producers.displayName");
    expect(initialSync).toContain(".innerJoin(\n            projects,");
    expect(initialSync).toContain(".innerJoin(producers,");
    expect(initialSync).toContain("bookingTitle: bookings.title");
    expect(initialSync).toContain("candidate.bookingTitle?.trim()");
    expect(initialSync).toContain("formatSessionIdentityTitle({");
    expect(initialSync).toContain("projectName: candidate.projectTitle");
    expect(initialSync).toContain("artistName: candidate.artistName");
    expect(initialSync).toContain('producerName: candidate.producerName ?? ""');
    expect(initialSync).toContain(
      'attentionDismissedAt: sql<Date | null>`null`.as("attention_dismissed_at")',
    );
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
    expect(targets).toContain('inArray(bookings.status, ["pending_approval", "confirmed"])');
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
      expect(section).toContain('inArray(bookings.status, ["pending_approval", "confirmed"])');
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
