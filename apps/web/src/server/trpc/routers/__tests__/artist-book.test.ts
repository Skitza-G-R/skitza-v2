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
const repositorySource = readFileSync(
  join(here, "..", "..", "..", "domain", "session-booking", "db.ts"),
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
const disconnect = source.slice(
  source.indexOf("disconnectProducer: artistProcedure"),
  source.indexOf("  // Nested sub-router"),
);

describe("artist.book purchase-owned session boundary", () => {
  it("blocks calendar slots only for canonical active booking statuses", () => {
    expect(availability).toMatch(
      /inArray\(bookings\.status, \["pending_approval", "confirmed"\]\)/,
    );
    expect(availability).not.toMatch(/pending_payment|depositPaid|finalPaid/);
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
  });

  it("derives allowance usage from purchase-owned booking outcomes", () => {
    expect(activePackages).toMatch(/eq\(bookings\.purchaseId, allowance\.purchaseId\)/);
    expect(activePackages).toMatch(/eq\(bookings\.sessionAllowanceId, allowance\.allowanceId\)/);
    expect(activePackages).toMatch(/sessionUseConsumesAllowance\(row\.outcome\)/);
    expect(activePackages).toMatch(/durationMin: allowance\.durationMin/);
    expect(activePackages).not.toMatch(/purchaseRequests|packageNameSnapshot|sessionCountSnapshot/);
  });

  it("requires a project and exact purchase allowance identity", () => {
    expect(confirm).toMatch(
      /const targetProjectId = input\.existingProjectId \?\? input\.projectId/,
    );
    expect(confirm).toMatch(/A purchased session allowance is required/);
    expect(confirm).toMatch(/purchaseId: z\.string\(\)\.uuid\(\)/);
    expect(confirm).toMatch(/sessionAllowanceId: z\.string\(\)\.uuid\(\)/);
    expect(confirm).toMatch(/createSessionBooking\(sessionBookingRepository\(ctx\.db\)/);
    expect(confirm).toMatch(/projectId: targetProjectId/);
    expect(confirm).toMatch(/purchaseId: input\.purchaseId/);
    expect(confirm).toMatch(/sessionAllowanceId: input\.sessionAllowanceId/);
    expect(confirm).toMatch(/actorClerkUserId: ctx\.clerkUserId/);
    expect(confirm).not.toMatch(/\.insert\(bookings\)|\.update\(bookings\)/);
  });

  it("serializes producer slots and the exact allowance before policy evaluation", () => {
    expect(repositorySource).toContain("sessionBookingScheduleAdvisoryLockKey(anchors.producerId)");
    expect(repositorySource).toContain("session-booking:allowance:${anchors.sessionAllowanceId}");
    expect(repositorySource).toContain("return work(transactionAdapter(tx))");
    expect(domainSource).toMatch(/assertSessionBookingAllowed\(\{/);
    expect(domainSource).toMatch(/existingOutcomes:\s*uses[\s\S]*\.map\(\(use\) => use\.outcome\)/);
    expect(domainSource).toMatch(/requestedDurationMin: input\.durationMin/);
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

  it("makes disconnect contact locking, active-booking check, and archive one transaction", () => {
    const transaction = disconnect.indexOf("ctx.db.transaction");
    const producerLock = disconnect.indexOf("pg_advisory_xact_lock", transaction);
    const contactRead = disconnect.indexOf(".from(clientContacts)", producerLock);
    const rowLock = disconnect.indexOf('.for("update")', contactRead);
    const activeBookingRead = disconnect.indexOf("const activeBookings", rowLock);
    const archive = disconnect.indexOf(".update(clientContacts)", activeBookingRead);

    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(producerLock).toBeGreaterThan(transaction);
    expect(contactRead).toBeGreaterThan(producerLock);
    expect(rowLock).toBeGreaterThan(contactRead);
    expect(activeBookingRead).toBeGreaterThan(rowLock);
    expect(archive).toBeGreaterThan(activeBookingRead);
  });

  it("prevents slot races using only canonical active statuses", () => {
    expect(repositorySource).toMatch(
      /inArray\(bookings\.status, \["pending_approval", "confirmed"\]\)/,
    );
    expect(domainSource).toMatch(
      /input\.startsAt\.getTime\(\) < existingEnd &&\s*existing\.startsAt\.getTime\(\) < requestedEnd \+ requestedBufferMs/,
    );
    expect(confirm).not.toMatch(/pending_payment/);
  });

  it("persists exact project, purchase, and allowance ownership without legacy credits", () => {
    expect(domainSource).toMatch(/const status = initialSessionBookingStatus/);
    expect(domainSource).toMatch(/projectId: input\.projectId/);
    expect(domainSource).toMatch(/purchaseId: input\.purchaseId/);
    expect(domainSource).toMatch(/sessionAllowanceId: input\.sessionAllowanceId/);
    expect(domainSource).not.toMatch(
      /purchaseRequests|depositPaid|finalPaid|legacy|packageNameSnapshot/,
    );
  });
});
