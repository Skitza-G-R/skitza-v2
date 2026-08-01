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
        totalCents: null,
        verifiedCents: 0,
        purchaseLifecycleStatus: null,
      }),
    ).toBe(true);
  });

  it("blocks a converted request until producer-verified proofs cover the total", () => {
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: "purchase-1",
        totalCents: 10_000,
        verifiedCents: 9_999,
        purchaseLifecycleStatus: "active",
      }),
    ).toBe(true);
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: "purchase-1",
        totalCents: 10_000,
        verifiedCents: 10_000,
        purchaseLifecycleStatus: "active",
      }),
    ).toBe(false);
  });

  it("fails closed for a converted request without its purchase", () => {
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: null,
        totalCents: null,
        verifiedCents: 0,
        purchaseLifecycleStatus: null,
      }),
    ).toBe(true);
  });

  it.each(["declined", "canceled"] as const)("does not block a %s request", (status) => {
    expect(
      isArtistPurchaseGuardBlocking({
        status,
        purchaseId: null,
        totalCents: null,
        verifiedCents: 0,
        purchaseLifecycleStatus: null,
      }),
    ).toBe(false);
  });

  it("releases a canceled purchase even when producer-verified proofs do not cover it", () => {
    expect(
      isArtistPurchaseGuardBlocking({
        status: "converted",
        purchaseId: "purchase-1",
        totalCents: 10_000,
        verifiedCents: 0,
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
    const guardLookup = requestSource.indexOf("const guard = await loadArtistPurchaseGuard");

    expect(selectedContactLookup).toBeGreaterThan(-1);
    expect(existingLookup).toBeGreaterThan(selectedContactLookup);
    expect(guardLookup).toBeGreaterThan(existingLookup);
    expect(requestSource.slice(existingLookup, guardLookup)).toContain("if (!existing)");
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
      guardLookup,
    );

    expect(existingLookup).toBeGreaterThan(-1);
    expect(replayCheck).toBeGreaterThan(existingLookup);
    expect(guardLookup).toBeGreaterThan(replayCheck);
    expect(replayReturn).toBeGreaterThan(guardLookup);
  });

  it("guards every owned contact row while requiring an active new target", () => {
    expect(typeof loadArtistPurchaseGuard).toBe("function");
    expect(guardSource).toContain(
      "eq(clientContacts.clerkUserId, input.clerkUserId)",
    );
    expect(guardSource).toContain(
      "eq(clientContacts.producerId, input.producerId)",
    );
    expect(guardSource).not.toContain("isNull(clientContacts.archivedAt)");

    const targetResolution = requestSource.slice(
      requestSource.indexOf("let contact:"),
      requestSource.indexOf("const [commercialOwner]"),
    );
    expect(
      targetResolution.match(/isNull\(clientContacts\.archivedAt\)/g),
    ).toHaveLength(2);
  });

  it("includes unfinished requestless purchases and releases canceled or fully verified ones", () => {
    expect(guardSource).toContain("sql`${purchases.purchaseRequestId} IS NULL`");
    expect(guardSource).toContain(
      'inArray(purchases.lifecycleStatus, ["waiting_for_payment", "active"])',
    );
    expect(guardSource).toContain(
      "inArray(purchases.clientContactId, contactIds)",
    );
    expect(guardSource).toContain(
      "case when ${paymentProofs.status} = 'confirmed'",
    );
    expect(guardSource).toContain("requestId: null");
    expect(guardSource).toContain(
      "href: `/artist/payments/${purchase.purchaseId}`",
    );
  });
});
