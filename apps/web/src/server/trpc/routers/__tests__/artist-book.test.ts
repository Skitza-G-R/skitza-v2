import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "artist.ts"), "utf8");
const domainSource = readFileSync(
  join(here, "..", "..", "..", "domain", "session-booking", "service.ts"),
  "utf8",
);
const bookingEngineSource = readFileSync(
  join(here, "..", "..", "..", "booking", "availability.ts"),
  "utf8",
);
const repositorySource = readFileSync(
  join(here, "..", "..", "..", "domain", "session-booking", "db.ts"),
  "utf8",
);
const disconnectDomainSource = readFileSync(
  join(here, "..", "..", "..", "artist", "disconnect.ts"),
  "utf8",
);
const availability = source.slice(
  source.indexOf("availability: artistProcedure"),
  source.indexOf("activePackages: artistProcedure"),
);
const activePackages = source.slice(
  source.indexOf("activePackages: artistProcedure"),
  source.indexOf("confirm: artistProcedure", source.indexOf("activePackages: artistProcedure")),
);
const confirm = source.slice(
  source.indexOf("confirm: artistProcedure", source.indexOf("activePackages: artistProcedure")),
  source.indexOf("const storeSubrouter"),
);
const mySessions = source.slice(
  source.indexOf("mySessions: artistProcedure"),
  source.indexOf("session: artistProcedure", source.indexOf("mySessions: artistProcedure")),
);
const loadArtistSessionRows = source.slice(
  source.indexOf("async function loadArtistSessionRows"),
  source.indexOf("type ArtistSessionRow"),
);
const disconnect = source.slice(
  source.indexOf("disconnectProducer: artistProcedure"),
  source.indexOf("  // Nested sub-router"),
);

describe("artist.book purchase-owned session boundary", () => {
  it("lists Home session status through the selected studio and exact artist relationship", () => {
    expect(mySessions).toContain(
      "loadArtistSessionRows(ctx.db, ctx.clerkUserId, undefined, input.producerId)",
    );
    expect(loadArtistSessionRows).toContain("eq(clientContacts.clerkUserId, clerkUserId)");
    expect(loadArtistSessionRows).toContain("eq(clientContacts.producerId, purchases.producerId)");
    expect(loadArtistSessionRows).toContain("isNull(clientContacts.archivedAt)");
  });

  it("blocks calendar slots only for canonical active booking statuses", () => {
    expect(availability).toMatch(
      /inArray\(bookings\.status, \["pending_approval", "confirmed"\]\)/,
    );
    expect(availability).not.toMatch(/pending_payment|depositPaid|finalPaid/);
  });

  it("delegates exact slot generation to the shared server-only booking engine", () => {
    expect(availability).toContain("generateArtistExactSessionSlots({");
    expect(availability).toContain("availabilityWindowDays: 30");
    expect(availability).not.toMatch(/startMin \+= 30|studioLocalDateTimeUtcCandidates/);
    expect(bookingEngineSource).toMatch(/studioStartMin \+= slotIncrementMin/);
    expect(bookingEngineSource).toContain("studioLocalDateTimeUtcCandidates");
    expect(bookingEngineSource).toContain("assertSessionSlotAvailable({");
  });

  it("lists active purchase allowances through stable client-contact ownership", () => {
    expect(activePackages).toMatch(/\.from\(purchases\)/);
    expect(activePackages).toMatch(/\.innerJoin\(\s*projects/);
    expect(activePackages).toMatch(/\.innerJoin\(\s*purchaseSessionAllowances/);
    expect(activePackages).toMatch(/inArray\(purchases\.clientContactId, myContactIds\)/);
    expect(activePackages).toMatch(/eq\(projects\.clientContactId, purchases\.clientContactId\)/);
    expect(activePackages).toMatch(/eq\(purchases\.lifecycleStatus, "active"\)/);
    expect(activePackages).toMatch(/eq\(projects\.lifecycleStatus, "active"\)/);
    expect(activePackages).toMatch(/isNull\(purchaseSessionAllowances\.closedAt\)/);
    expect(activePackages).toMatch(/isNull\(producers\.closedAt\)/);
  });

  it("fails closed for session discovery and new transaction writes after studio closure", () => {
    expect(availability).toMatch(/isNull\(producers\.closedAt\)/);
    expect(mySessions).toContain("producerClosedAt: producers.closedAt");
    expect(mySessions).toMatch(
      /allowance\.producerClosedAt === null[\s\S]*sessionAllowanceCanBook/,
    );

    const createContext = repositorySource.slice(
      repositorySource.indexOf("loadCreateContext: async"),
      repositorySource.indexOf("loadBookingContext: async"),
    );
    const producerState = createContext.indexOf("producerClosedAt: producers.closedAt");
    const rowLock = createContext.indexOf('.for("update")', producerState);
    const replay = domainSource.indexOf("if (replay)");
    const closureGuard = domainSource.indexOf("context.producer.closedAt !== null", replay);
    const insert = domainSource.indexOf("transaction.insertBooking", closureGuard);

    expect(producerState).toBeGreaterThanOrEqual(0);
    expect(rowLock).toBeGreaterThan(producerState);
    expect(closureGuard).toBeGreaterThan(replay);
    expect(insert).toBeGreaterThan(closureGuard);
  });

  it("derives allowance usage from purchase-owned booking outcomes", () => {
    expect(activePackages).toMatch(/eq\(bookings\.purchaseId, allowance\.purchaseId\)/);
    expect(activePackages).toMatch(/eq\(bookings\.sessionAllowanceId, allowance\.allowanceId\)/);
    expect(activePackages).toMatch(
      /sessionUseConsumesAllowance\(row\.outcome, row\.billingTreatment\)/,
    );
    expect(activePackages).toMatch(/durationMin: allowance\.durationMin/);
    expect(activePackages).not.toMatch(/purchaseRequests|packageNameSnapshot|sessionCountSnapshot/);
  });

  it("requires a project and exact purchase allowance identity", () => {
    expect(confirm).toMatch(/projectId: z\.string\(\)\.uuid\(\)/);
    expect(confirm).toMatch(/purchaseId: z\.string\(\)\.uuid\(\)/);
    expect(confirm).toMatch(/sessionAllowanceId: z\.string\(\)\.uuid\(\)/);
    expect(confirm).toMatch(/createSessionBooking\(sessionBookingRepository\(ctx\.db\)/);
    expect(confirm).toMatch(/projectId: input\.projectId/);
    expect(confirm).toMatch(/purchaseId: input\.purchaseId/);
    expect(confirm).toMatch(/sessionAllowanceId: input\.sessionAllowanceId/);
    expect(confirm).toMatch(/actorClerkUserId: ctx\.clerkUserId/);
    expect(confirm).not.toMatch(/\.insert\(bookings\)|\.update\(bookings\)/);
  });

  it("serializes the producer schedule and exact allowance before policy evaluation", () => {
    expect(repositorySource).toContain("sessionBookingScheduleAdvisoryLockKey(anchors.producerId)");
    expect(repositorySource).toContain("session-booking:allowance:${anchors.sessionAllowanceId}");
    expect(repositorySource).toContain("return work(transactionAdapter(tx))");
    expect(domainSource).toMatch(/assertSessionBookingAllowed\(\{/);
    expect(domainSource).toMatch(/distinctConsumingUses\.set\(use\.allowanceUseId, use\)/);
    expect(domainSource).toMatch(
      /existingOutcomes:\s*\[\.\.\.distinctConsumingUses\.values\(\)\]\.map\(\(use\) => use\.outcome\)/,
    );
    expect(domainSource).toMatch(/existingUses:\s*\[\.\.\.distinctConsumingUses\.values\(\)\]/);
    expect(domainSource).toMatch(/requestedDurationMin: context\.allowance\.durationMin/);
  });

  it("locks lifecycle and allowance rows before evaluating capacity", () => {
    const createContext = repositorySource.slice(
      repositorySource.indexOf("loadCreateContext: async"),
      repositorySource.indexOf("loadBookingContext: async"),
    );
    const rowLock = createContext.indexOf('.for("update")');
    const existingUses = domainSource.indexOf("const uses = await transaction.listAllowanceUses");
    const policy = domainSource.indexOf("assertSessionBookingAllowed", existingUses);

    expect(rowLock).toBeGreaterThanOrEqual(0);
    expect(existingUses).toBeGreaterThanOrEqual(0);
    expect(policy).toBeGreaterThan(existingUses);
  });

  it("locks and rechecks the active client relationship inside booking confirmation", () => {
    const createContext = repositorySource.slice(
      repositorySource.indexOf("loadCreateContext: async"),
      repositorySource.indexOf("loadBookingContext: async"),
    );
    const contactJoin = createContext.indexOf("clientContacts");
    const contactActive = createContext.indexOf("isNull(clientContacts.archivedAt)", contactJoin);
    const rowLock = createContext.indexOf('.for("update")', contactActive);
    const insert = domainSource.indexOf("transaction.insertBooking");

    expect(confirm).not.toContain("resolveClientContacts(ctx.db");
    expect(contactJoin).toBeGreaterThanOrEqual(0);
    expect(createContext).toContain("eq(clientContacts.clerkUserId, input.actorClerkUserId)");
    expect(contactActive).toBeGreaterThan(contactJoin);
    expect(rowLock).toBeGreaterThan(contactActive);
    expect(insert).toBeGreaterThanOrEqual(0);
  });

  it("routes the legacy disconnect RPC through the canonical safety boundary exactly once", () => {
    expect(disconnect.match(/commitArtistStudioDisconnect\(/g)).toHaveLength(1);
    expect(disconnect).toContain("clerkUserId: ctx.clerkUserId");
    expect(disconnect).toContain("producerId: input.producerId");
    expect(disconnect).toContain("mapArtistDisconnectDomainError(error)");
    expect(disconnect).not.toMatch(
      /ctx\.db\.transaction|\.update\(clientContacts\)|\.insert\(artistHistoricalAccessGrants\)/,
    );
  });

  it("rechecks every blocker before capturing grants and archiving contacts", () => {
    const commit = disconnectDomainSource.slice(
      disconnectDomainSource.indexOf("export async function commitArtistStudioDisconnect"),
    );
    const quotaLock = commit.indexOf("lockProducerAudioStorageQuota(tx, input.producerId)");
    const disconnectLock = commit.indexOf("artist-disconnect:", quotaLock);
    const relationshipLock = commit.indexOf('.for("update")', disconnectLock);
    const snapshot = commit.indexOf("loadDisconnectSnapshot");
    const blockerPolicy = commit.indexOf("evaluateArtistDisconnectBlockers", snapshot);
    const blocked = commit.indexOf(
      'new ArtistDisconnectError(\n          "BLOCKED"',
      blockerPolicy,
    );
    const grantCapture = commit.indexOf("captureHistoricalGrants", blocked);
    const archive = commit.indexOf(".update(clientContacts)", grantCapture);

    expect(quotaLock).toBeGreaterThanOrEqual(0);
    expect(disconnectLock).toBeGreaterThan(quotaLock);
    expect(relationshipLock).toBeGreaterThan(disconnectLock);
    expect(snapshot).toBeGreaterThan(relationshipLock);
    expect(blockerPolicy).toBeGreaterThan(snapshot);
    expect(blocked).toBeGreaterThan(blockerPolicy);
    expect(grantCapture).toBeGreaterThan(blocked);
    expect(archive).toBeGreaterThan(grantCapture);
    expect(commit.match(/captureHistoricalGrants\(/g)).toHaveLength(1);

    for (const blockerSource of [
      "purchaseRequests",
      "purchases",
      "paymentProofs",
      "bookings",
      "purchaseSessionAllowances",
    ]) {
      expect(disconnectDomainSource).toContain(`.from(${blockerSource})`);
    }
    expect(disconnectDomainSource).toContain(".onConflictDoNothing()");
  });

  it("prevents slot races using only canonical active statuses", () => {
    expect(repositorySource).toMatch(
      /inArray\(bookings\.status, \["pending_approval", "confirmed"\]\)/,
    );
    expect(bookingEngineSource).toContain("existing.startsAt.getTime() < requestedEnd");
    expect(bookingEngineSource).toContain(
      "existing.startsAt.getTime() < requestedEnd + requestedBufferMs",
    );
    expect(confirm).not.toMatch(/pending_payment/);
  });

  it("persists exact ownership and server-derived booking metadata", () => {
    expect(domainSource).toMatch(
      /const status = options\.forceConfirmed[\s\S]*initialSessionBookingStatus/,
    );
    expect(domainSource).toMatch(/projectId: input\.projectId/);
    expect(domainSource).toMatch(/purchaseId: input\.purchaseId/);
    expect(domainSource).toMatch(/sessionAllowanceId: input\.sessionAllowanceId/);
    expect(domainSource).toMatch(/const title = normalizeSessionBookingTitle/);
    expect(domainSource).toMatch(/const origin = options\.origin \?\? "artist_request"/);
    expect(domainSource).toMatch(/\s+title,\s+origin,\s+billingTreatment,/);
    expect(domainSource).toMatch(/billingTreatment,/);
    expect(domainSource).toMatch(/calendarRevision: options\.calendarRevision \?\? 1/);
    expect(domainSource).not.toMatch(/purchaseRequests|depositPaid|finalPaid|packageNameSnapshot/);
  });
});
