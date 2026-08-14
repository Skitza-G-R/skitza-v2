import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repository = readFileSync(
  join(process.cwd(), "src/server/identity/account-closure-repository.ts"),
  "utf8",
);
const automation = readFileSync(
  join(process.cwd(), "src/server/identity/account-closure-automation.ts"),
  "utf8",
);
const role = readFileSync(join(process.cwd(), "src/server/auth/role.ts"), "utf8");
const publicProfile = readFileSync(
  join(process.cwd(), "src/server/trpc/routers/public-profile.ts"),
  "utf8",
);
const joinContinuation = readFileSync(
  join(process.cwd(), "src/server/contacts/join-continuation.ts"),
  "utf8",
);

describe("account-closure operational wiring", () => {
  it("starts the 30-day clock and hides Producer surfaces without relinking identity", () => {
    expect(repository).toContain("dueDate(verifiedAt)");
    expect(repository).toContain("closureStartedAt: verifiedAt");
    expect(repository).toContain("closedAt: verifiedAt");
    expect(repository).not.toMatch(/set\(\{[\s\S]{0,160}clerkUserId:/);
    expect(publicProfile).toContain("isNull(producers.closedAt)");
    expect(joinContinuation).toContain("isNull(producers.closedAt)");
    expect(role).toContain("isAccountClosureStarted");
  });

  it("starts capability expiry only after closure wins the Producer row lock", () => {
    const verifyStart = repository.indexOf("async verifyAndBeginClosure(input)");
    const getStart = repository.indexOf("async getRequest(requestId)");
    const verify = repository.slice(verifyStart, getStart);
    expect(verify).toContain('.for("update")');
    expect(verify).toContain("databaseWallClockNow(tx)");
    expect(verify.indexOf('.for("update")')).toBeLessThan(
      verify.indexOf("databaseWallClockNow(tx)"),
    );
    expect(repository).toContain("clock_timestamp()");
  });

  it("records full access revocation only from Clerk deletion evidence", () => {
    const successStart = repository.indexOf("async succeedTask(input)");
    const notApplicableStart = repository.indexOf("async markTaskNotApplicable(input)");
    const successBlock = repository.slice(successStart, notApplicableStart);
    expect(successBlock).toContain('input.claim.kind === "clerk_account_delete"');
    expect(successBlock).toContain("accessRevokedAt: completedAt");
    expect(successBlock).toContain('eventType: "access_revoked"');
    expect(repository).toContain("request.accessRevokedAt === null");
  });

  it("prevents terminal task evidence from being recorded while a legal hold is active", () => {
    const successStart = repository.indexOf("async succeedTask(input)");
    const blockStart = repository.indexOf("async blockTask(input)");
    const terminalWrites = repository.slice(successStart, blockStart);
    expect(terminalWrites.match(/isAccountClosureLegalHoldActive\(request\)/g)).toHaveLength(2);
    expect(repository).toContain("evidenceRef: `error:${input.errorCode}`");
  });

  it("never reclaims running work through a normal claim", () => {
    const claimStart = repository.indexOf("async claimTask(input)");
    const successStart = repository.indexOf("async succeedTask(input)");
    const claim = repository.slice(claimStart, successStart);
    expect(claim).toContain('if (task.status === "running") return null');
    expect(claim.indexOf("return null")).toBeLessThan(claim.indexOf("attemptCount + 1"));
  });

  it("requires expired lease evidence before moving a stale claim to blocked", () => {
    const recoveryStart = repository.indexOf("async recoverStaleTask(input)");
    const resolveProducerStart = repository.indexOf("async resolveProducerId(clerkUserId)");
    const recovery = repository.slice(recoveryStart, resolveProducerStart);
    expect(recovery).toContain(
      "isAccountClosureRunningTaskLeaseActive(task.startedAt, recoveredAt)",
    );
    expect(recovery).toContain('lastErrorCode: "stale_claim_recovered"');
    expect(recovery).toContain("evidenceRef: input.evidenceRef");
    expect(repository).toContain("transaction_timestamp()");
    expect(recovery).not.toContain("input.recoveredAt");
  });

  it("keeps the automated personal cleanup narrowly scoped", () => {
    const cleanupStart = repository.indexOf("async deleteDeviceAndArtistPreferences(clerkUserId)");
    const holdStart = repository.indexOf("async applyLegalHold(input)");
    const cleanup = repository.slice(cleanupStart, holdStart);
    expect(cleanup).toContain("delete(pushSubscriptions)");
    expect(cleanup).toContain("delete(artistProfiles)");
    expect(cleanup).toContain("delete(artistNotifications)");
    expect(cleanup).not.toContain("delete(producers)");
    expect(cleanup).not.toContain("delete(clientContacts)");
  });

  it("revokes and verifies every locally controlled public song surface", () => {
    const revokeStart = repository.indexOf("async revokePublicAndCapabilityLinks(producerId)");
    const holdStart = repository.indexOf("async applyLegalHold(input)");
    const revoke = repository.slice(revokeStart, holdStart);
    expect(revoke).toContain(".update(songPublicLinks)");
    expect(revoke).toContain("disabledAt: revokedAt");
    expect(revoke).toContain(".update(projectTracks)");
    expect(revoke).toContain("portfolioPublishedAt: null");
    expect(revoke).toContain("localCapabilitiesAreRevoked");
    expect(repository).toContain("ACCOUNT_CLOSURE_CAPABILITY_EXPIRY_MS");
    expect(repository).toContain("input.closedAt.getTime() +");
    expect(repository).toContain("firstVersionUploadIntents.latestUploadUrlExpiresAt");
    expect(repository).toContain("trackVersions.pendingAudioPartUrlsExpireAt");
  });

  it("rechecks local capabilities immediately before terminal completion", () => {
    const completionStart = repository.indexOf("async completeIfReady(input)");
    const completion = repository.slice(completionStart);
    expect(completion).toContain("localCapabilitiesAreRevoked");
    expect(completion).toContain("return false");
  });

  it("reuses the hardened Google disconnect service", () => {
    expect(automation).toContain("createGoogleCalendarService");
    expect(automation).toContain("await service.disconnect(producerId)");
    expect(automation).not.toContain("delete(googleCalendarConnections)");
    const activeConnectionStart = repository.indexOf(
      "async hasGoogleCalendarConnection(producerId)",
    );
    const cleanupStart = repository.indexOf("async deleteDeviceAndArtistPreferences(clerkUserId)");
    expect(repository.slice(activeConnectionStart, cleanupStart)).toContain(
      "isNull(googleCalendarConnections.disconnectedAt)",
    );
  });
});
