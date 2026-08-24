import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isArtistPurchaseGuardBlocking,
  loadArtistPurchaseGuard,
} from "../../../domain/purchase-requests/active-guard";

const purchaseSource = readFileSync(new URL("../purchase.ts", import.meta.url), "utf8");
const guardSource = readFileSync(
  new URL("../../../domain/purchase-requests/active-guard.ts", import.meta.url),
  "utf8",
);
const requestSource = purchaseSource.slice(
  purchaseSource.indexOf("request: artistProcedure"),
  purchaseSource.indexOf("get: artistProcedure"),
);

describe("artist purchase active guard", () => {
  it.each(["pending", "approved"] as const)("blocks a %s request", (status) => {
    expect(
      isArtistPurchaseGuardBlocking({
        status,
        purchaseId: null,
        remainingCents: null,
        purchaseLifecycleStatus: null,
      }),
    ).toBe(true);
  });

  it("blocks a converted request exactly while the ledger says money is still owed", () => {
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: "purchase-1",
        remainingCents: 1,
        purchaseLifecycleStatus: "active",
      }),
    ).toBe(true);
    // SK-267: settled is settled regardless of HOW the money was recorded —
    // confirmed proofs, imported payments, SK-260 manual payments, and
    // waivers all land in the ledger's remaining cents.
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: "purchase-1",
        remainingCents: 0,
        purchaseLifecycleStatus: "active",
      }),
    ).toBe(false);
  });

  it("fails closed for a converted request without its purchase or with unreadable money history", () => {
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: null,
        remainingCents: null,
        purchaseLifecycleStatus: null,
      }),
    ).toBe(true);
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: "purchase-1",
        remainingCents: null,
        purchaseLifecycleStatus: "active",
      }),
    ).toBe(true);
  });

  it.each(["declined", "canceled"] as const)("does not block a %s request", (status) => {
    expect(
      isArtistPurchaseGuardBlocking({
        status,
        purchaseId: null,
        remainingCents: null,
        purchaseLifecycleStatus: null,
      }),
    ).toBe(false);
  });

  it("releases a canceled purchase even when money is still outstanding", () => {
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: "purchase-1",
        remainingCents: 10_000,
        purchaseLifecycleStatus: "canceled",
      }),
    ).toBe(false);
  });
});

describe("purchase.request idempotency and the studio-wide guard", () => {
  it("does not let a key from contact A bypass the guard for a new target on contact B", () => {
    expect(guardSource).not.toContain("ignoredOperationKey");
    expect(guardSource).not.toContain("candidate.operationKey");

    const selectedContactLookup = requestSource.indexOf(
      "eq(purchaseRequests.clientContactId, contact.id)",
    );
    const existingLookup = requestSource.indexOf("const existing = await findExisting()");
    const replayReturn = requestSource.indexOf(
      "return { request: existing, created: false }",
      existingLookup,
    );
    const guardLookup = requestSource.indexOf("const guard = await loadArtistPurchaseGuard");

    expect(selectedContactLookup).toBeGreaterThan(-1);
    expect(existingLookup).toBeGreaterThan(selectedContactLookup);
    expect(replayReturn).toBeGreaterThan(existingLookup);
    expect(guardLookup).toBeGreaterThan(replayReturn);
  });

  it("bypasses the guard only for an exact replay verified on the selected contact", () => {
    const existingLookup = requestSource.indexOf("const existing = await findExisting()");
    const replayCheck = requestSource.indexOf(
      "assertPurchaseRequestOperationReplay(existing, operation)",
      existingLookup,
    );
    const guardLookup = requestSource.indexOf(
      "const guard = await loadArtistPurchaseGuard",
      replayCheck,
    );
    const replayReturn = requestSource.indexOf(
      "return { request: existing, created: false }",
      replayCheck,
    );

    expect(existingLookup).toBeGreaterThan(-1);
    expect(replayCheck).toBeGreaterThan(existingLookup);
    expect(replayReturn).toBeGreaterThan(replayCheck);
    expect(guardLookup).toBeGreaterThan(replayReturn);
  });

  it("guards every owned contact row while requiring an active new target", () => {
    expect(typeof loadArtistPurchaseGuard).toBe("function");
    expect(guardSource).toContain("eq(clientContacts.clerkUserId, input.clerkUserId)");
    expect(guardSource).toContain("eq(clientContacts.producerId, input.producerId)");
    expect(guardSource).not.toContain("isNull(clientContacts.archivedAt)");

    const targetResolution = requestSource.slice(
      requestSource.indexOf("let contact:"),
      requestSource.indexOf("const brief"),
    );
    expect(targetResolution.match(/isNull\(clientContacts\.archivedAt\)/g)).toHaveLength(2);
  });

  it("includes unfinished requestless purchases and releases canceled or settled ones", () => {
    expect(guardSource).toContain("sql`${purchases.purchaseRequestId} IS NULL`");
    expect(guardSource).toContain(
      'inArray(purchases.lifecycleStatus, ["waiting_for_payment", "active"])',
    );
    expect(guardSource).toContain("inArray(purchases.clientContactId, contactIds)");
    expect(guardSource).toContain("requestId: null");
    expect(guardSource).toContain("href: `/artist/payments/${purchase.purchaseId}`");
  });

  it("measures debt with the canonical ledger, never with proof files alone (SK-267)", () => {
    // Imported and SK-260 manual payments have no proof file; waivers settle
    // with no payment at all. A proofs-only sum permanently blocks such
    // clients from the Store even when fully paid.
    expect(guardSource).toContain("projectPurchaseLedger");
    expect(guardSource).toContain("purchasePayments");
    expect(guardSource).toContain("purchasePaymentCorrections");
    expect(guardSource).toContain("purchaseWaivers");
    expect(guardSource).toContain("purchaseInstallments");
    expect(guardSource).not.toContain("paymentProofs");
    // Unreadable money history fails closed, inside and outside the loader.
    expect(guardSource).toContain("remaining.set(row.id, null)");
    expect(guardSource).toMatch(/remainingCents === null \|\| .*remainingCents > 0/);
  });
});
