import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "artist.ts"), "utf8");
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
    expect(confirm).toMatch(/eq\(purchases\.id, input\.purchaseId\)/);
    expect(confirm).toMatch(
      /eq\(purchaseSessionAllowances\.id, input\.sessionAllowanceId\)/,
    );
    expect(confirm).toMatch(/if \(candidates\.length > 1\)/);
    expect(confirm).toMatch(/Choose the exact purchased session allowance/);
  });

  it("serializes producer slots and the exact allowance before policy evaluation", () => {
    expect(confirm.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(confirm).toMatch(/hashtextextended\(\$\{input\.producerId\}, 0\)/);
    expect(confirm).toMatch(/hashtextextended\(\$\{candidate\.allowance\.id\}, 0\)/);
    expect(confirm).toMatch(/assertSessionBookingAllowed\(\{/);
    expect(confirm).toMatch(/existingOutcomes: existingUses\.map/);
    expect(confirm).toMatch(/requestedDurationMin: input\.durationMin/);
  });

  it("locks lifecycle and allowance rows before evaluating capacity", () => {
    const candidateRead = confirm.indexOf("const candidates = await tx");
    const rowLock = confirm.indexOf('.for("update")', candidateRead);
    const existingUses = confirm.indexOf("const existingUses", rowLock);
    const policy = confirm.indexOf("assertSessionBookingAllowed", existingUses);

    expect(candidateRead).toBeGreaterThanOrEqual(0);
    expect(rowLock).toBeGreaterThan(candidateRead);
    expect(existingUses).toBeGreaterThan(rowLock);
    expect(policy).toBeGreaterThan(existingUses);
  });

  it("locks and rechecks the active client relationship inside booking confirmation", () => {
    const transaction = confirm.indexOf("ctx.db.transaction");
    const producerLock = confirm.indexOf("pg_advisory_xact_lock", transaction);
    const contactJoin = confirm.indexOf(".innerJoin(\n            clientContacts", producerLock);
    const contactActive = confirm.indexOf("isNull(clientContacts.archivedAt)", contactJoin);
    const rowLock = confirm.indexOf('.for("update")', contactActive);
    const insert = confirm.indexOf(".insert(bookings)", rowLock);

    expect(confirm).not.toContain("resolveClientContacts(ctx.db");
    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(producerLock).toBeGreaterThan(transaction);
    expect(contactJoin).toBeGreaterThan(producerLock);
    expect(confirm).toContain("eq(clientContacts.clerkUserId, ctx.clerkUserId)");
    expect(contactActive).toBeGreaterThan(contactJoin);
    expect(rowLock).toBeGreaterThan(contactActive);
    expect(insert).toBeGreaterThan(rowLock);
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
    expect(confirm).toMatch(/inArray\(bookings\.status, \["pending_approval", "confirmed"\]\)/);
    expect(confirm).toMatch(/bk\.startsAt < endsAt && startsAt < bkEnd/);
    expect(confirm).not.toMatch(/pending_payment/);
  });

  it("persists exact project, purchase, and allowance ownership without legacy credits", () => {
    expect(confirm).toMatch(/status: "pending_approval"/);
    expect(confirm).toMatch(/projectId: candidate\.project\.id/);
    expect(confirm).toMatch(/purchaseId: candidate\.purchase\.id/);
    expect(confirm).toMatch(/sessionAllowanceId: candidate\.allowance\.id/);
    expect(confirm).not.toMatch(
      /purchaseRequests|depositPaid|finalPaid|legacy|packageNameSnapshot/,
    );
  });
});
