import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../purchase-ledger/db", () => ({
  purchaseLedgerRepository: () => ({ kind: "ledger-repository" }),
}));

vi.mock("../../purchase-ledger/service", () => ({
  reconcilePurchaseLedger: (...args: unknown[]) => mocks.reconcile(...args),
  setInstallmentRemindersEnabled: vi.fn(),
}));

vi.mock("../../client-invitations/db", () => ({
  clientInvitationDeliveryRepository: vi.fn(),
  loadCurrentClientInvitationStates: () => Promise.resolve(new Map()),
  reserveActiveWorkImportClientInvitationEmail: vi.fn(),
}));

import { emailHashFor } from "~/server/artist/identity";
import { loadActiveWorkImportSetupScope } from "../setup";

const PRODUCER_ID = "producer-1";
const BATCH_ID = "batch-1";

/** Minimal Drizzle-like chain: every builder call returns the same awaitable node. */
function queryChain(result: readonly unknown[]) {
  const node: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "where", "limit", "orderBy", "for"]) {
    node[method] = () => node;
  }
  node.then = (
    resolve: (value: readonly unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return node;
}

function fakeDb(results: readonly (readonly unknown[])[]): Db {
  const queue = [...results];
  return {
    select: () => {
      const next = queue.shift();
      if (!next) throw new Error("unexpected query");
      return queryChain(next);
    },
  } as unknown as Db;
}

function ledger(purchaseId: string) {
  return {
    snapshot: {
      purchase: { id: purchaseId, lifecycleStatus: "waiting_for_payment" },
      installments: [
        {
          id: `${purchaseId}-installment-1`,
          position: 1,
          amountCents: 5_000,
          currency: "USD",
          dueTrigger: "producer_import",
          dueAt: new Date("2026-08-20T12:00:00.000Z"),
          triggeredAt: new Date("2026-08-20T12:00:00.000Z"),
          remindersEnabled: false,
        },
      ],
    },
    projection: {
      installments: [
        { id: `${purchaseId}-installment-1`, remainingCents: 5_000, status: "not_paid" },
      ],
    },
  };
}

describe("active work import setup scope loading", () => {
  it("reconciles imported purchases in small groups instead of all at once", async () => {
    const purchaseIds = Array.from({ length: 12 }, (_, index) => `purchase-${String(index)}`);
    const materializedRows = purchaseIds.map((purchaseId, index) => ({
      rowId: `row-${String(index)}`,
      clientContactId: "client-1",
      projectId: `project-${String(index)}`,
      purchaseId,
      projectTitle: `Project ${String(index)}`,
      commercialSnapshot: { productOrOfferName: `Agreement ${String(index)}` },
      refNumber: `REF-${String(index)}`,
    }));
    const client = {
      id: "client-1",
      name: "Artist",
      email: "artist@example.com",
      emailHash: emailHashFor("artist@example.com"),
      clerkUserId: null,
      archivedAt: null,
    };
    let inFlight = 0;
    let peakInFlight = 0;
    mocks.reconcile.mockImplementation(async (_repository, input) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return ledger((input as { purchaseId: string }).purchaseId);
    });

    const scope = await loadActiveWorkImportSetupScope(
      fakeDb([[{ id: BATCH_ID }], materializedRows, [client]]),
      { producerId: PRODUCER_ID, batchId: BATCH_ID },
    );

    expect(mocks.reconcile).toHaveBeenCalledTimes(12);
    expect(peakInFlight).toBeLessThanOrEqual(5);
    expect(peakInFlight).toBeGreaterThan(1);
    expect(scope.installments).toHaveLength(12);
    expect(scope.installments.map((installment) => installment.purchaseId).sort()).toEqual(
      [...purchaseIds].sort(),
    );
    expect(scope.clients).toEqual([
      expect.objectContaining({ id: "client-1", invitationState: "available" }),
    ]);
  });
});
