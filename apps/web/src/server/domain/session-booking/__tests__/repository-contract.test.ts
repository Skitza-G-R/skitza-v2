import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sessionBookingScheduleAdvisoryLockKey } from "../db";

const source = readFileSync(join(process.cwd(), "src/server/domain/session-booking/db.ts"), "utf8");
const bookingRouterSource = readFileSync(
  join(process.cwd(), "src/server/trpc/routers/booking.ts"),
  "utf8",
);

function sourceBlock(startToken: string, endToken?: string): string {
  const start = source.indexOf(startToken);
  const end = endToken ? source.indexOf(endToken, start) : source.length;
  expect(start, startToken).toBeGreaterThanOrEqual(0);
  expect(end, endToken ?? "end of source").toBeGreaterThan(start);
  return source.slice(start, end);
}

function bookingSourceBlock(startToken: string, endToken?: string): string {
  const start = bookingRouterSource.indexOf(startToken);
  const end = endToken ? bookingRouterSource.indexOf(endToken, start) : bookingRouterSource.length;
  expect(start, startToken).toBeGreaterThanOrEqual(0);
  expect(end, endToken ?? "end of source").toBeGreaterThan(start);
  return bookingRouterSource.slice(start, end);
}

describe("session booking Postgres repository contract", () => {
  it("serializes every command in one transaction with a stable global lock order", () => {
    const atomic = sourceBlock("export function sessionBookingRepository");
    const scheduleLock = atomic.indexOf("sessionBookingScheduleAdvisoryLockKey(");
    const projectLock = atomic.indexOf("projectAdvisoryLockKey(");
    const purchaseLock = atomic.indexOf("purchaseLedgerAdvisoryLockKey(");
    const allowanceLock = atomic.indexOf("session-booking:allowance:");

    expect(atomic).toContain("db.transaction(async (tx)");
    expect(atomic).toContain("pg_advisory_xact_lock");
    expect(scheduleLock).toBeGreaterThanOrEqual(0);
    expect(projectLock).toBeGreaterThan(scheduleLock);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(allowanceLock).toBeGreaterThan(purchaseLock);
    expect(atomic).toContain("return work(transactionAdapter(tx))");
  });

  it("locks complete purchase and booking context before lifecycle decisions", () => {
    const adapter = sourceBlock(
      "function transactionAdapter",
      "async function discoverBookingScope",
    );
    const createContext = sourceBlock("loadCreateContext: async", "loadBookingContext: async");
    const bookingContext = sourceBlock("loadBookingContext: async", "findBookingByOperationKey:");

    expect(createContext).toContain('.for("update")');
    expect(bookingContext).toContain('.for("update")');
    for (const ownerAnchor of [
      "purchases.producerId",
      "purchases.projectId",
      "purchaseSessionAllowances.purchaseId",
      "purchaseSessionAllowances.producerId",
      "clientContacts.clerkUserId",
    ]) {
      expect(adapter, ownerAnchor).toContain(ownerAnchor);
    }
  });

  it("keeps artist identity checks conditional so producers can transition existing bookings", () => {
    const createContext = sourceBlock("loadCreateContext: async", "loadBookingContext: async");
    const bookingContext = sourceBlock("loadBookingContext: async", "findBookingByOperationKey:");

    expect(createContext).toContain("eq(clientContacts.clerkUserId, input.actorClerkUserId)");
    expect(createContext).toContain("isNull(clientContacts.archivedAt)");
    expect(bookingContext).toContain("input.actorClerkUserId");
    expect(bookingContext).toMatch(
      /input\.actorClerkUserId\s*\?\s*eq\(clientContacts\.clerkUserId, input\.actorClerkUserId\)\s*:\s*undefined/,
    );
    expect(bookingContext).toMatch(
      /input\.actorClerkUserId\s*\?\s*isNull\(clientContacts\.archivedAt\)\s*:\s*undefined/,
    );
    expect(bookingContext).toContain(
      "input.producerId ? eq(bookings.producerId, input.producerId) : undefined",
    );
  });

  it("counts all allowance outcomes but only active holds as schedule conflicts", () => {
    const allowanceUses = sourceBlock("listAllowanceUses:", "listScheduleEntries:");
    const schedule = sourceBlock("listScheduleEntries:", "insertBooking:");

    expect(allowanceUses).toContain("bookings.outcome");
    expect(allowanceUses).toContain("bookings.allowanceUseId");
    expect(allowanceUses).toContain("bookings.sessionAllowanceId");
    expect(schedule).toContain("purchaseSessionAllowances.bufferMinutes");
    expect(schedule).toContain('inArray(bookings.status, ["pending_approval", "confirmed"])');
  });

  it("persists immutable command identity, replacement lineage, and transition history", () => {
    const insertBooking = sourceBlock("insertBooking: async", "updateBooking: async");
    const insertEvent = sourceBlock("insertTransitionEvent: async", "};\n}");

    for (const field of [
      "operationKey",
      "operationDigest",
      "rescheduledFromBookingId",
      "allowanceUseId",
      "cancellationPolicyHoursSnapshot",
      "cancellationPolicySnapshottedAt",
      "heldExpiresAt",
      "startsAt",
      "durationMin",
    ]) {
      expect(insertBooking, field).toContain(field);
    }
    expect(insertEvent).toContain("bookingTransitionEvents");
    expect(insertEvent).toContain("values(input)");
  });

  it("uses one producer schedule lock identity across booking and schedule writers", () => {
    expect(sessionBookingScheduleAdvisoryLockKey("producer-a")).toBe(
      "session-booking:schedule:producer-a",
    );
    expect(sessionBookingScheduleAdvisoryLockKey("producer-a")).not.toBe(
      sessionBookingScheduleAdvisoryLockKey("producer-b"),
    );

    const repository = sourceBlock("export function sessionBookingRepository");
    expect(repository).toContain("sessionBookingScheduleAdvisoryLockKey(anchors.producerId)");

    const blackoutCreate = bookingSourceBlock(
      "create: producerProcedure",
      "remove: producerProcedure",
    );
    const blackoutRemove = bookingSourceBlock(
      "remove: producerProcedure",
      "// ── Availability (producer-only)",
    );
    const setWeek = bookingSourceBlock(
      "setWeek: producerProcedure",
      "// Producer-level booking settings",
    );
    const updateSettings = bookingSourceBlock(
      "updateSettings: producerProcedure",
      "// ── Bookings (producer-only views + status transitions)",
    );

    for (const [label, writer] of [
      ["blackout create", blackoutCreate],
      ["blackout remove", blackoutRemove],
      ["setWeek", setWeek],
      ["updateSettings", updateSettings],
    ] as const) {
      expect(writer, label).toContain("sessionBookingScheduleAdvisoryLockKey(ctx.producerId)");
      expect(writer, label).toContain("pg_advisory_xact_lock");
      expect(writer, label).toContain("ctx.db.transaction(async (tx)");
    }

    expect(setWeek.indexOf(".delete(availabilityBlocks)")).toBeGreaterThan(
      setWeek.indexOf("pg_advisory_xact_lock"),
    );
    expect(setWeek.indexOf("tx.insert(availabilityBlocks)")).toBeGreaterThan(
      setWeek.indexOf("tx.delete(availabilityBlocks)"),
    );
  });
});
