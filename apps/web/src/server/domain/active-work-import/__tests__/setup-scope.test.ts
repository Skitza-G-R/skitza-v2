import type { Db } from "@skitza/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  read: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../purchase-ledger/db", () => ({
  purchaseLedgerRepository: () => ({ kind: "ledger-repository" }),
}));

vi.mock("../../purchase-ledger/service", () => ({
  reconcilePurchaseLedger: (...args: unknown[]) => mocks.reconcile(...args),
  readPurchaseLedger: (...args: unknown[]) => mocks.read(...args),
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
      // SK-268: an imported purchase is created active — the producer's
      // attestation is the activation event.
      purchase: { id: purchaseId, lifecycleStatus: "active" },
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

/** A monthly plan: instalment 2 has no date until the schedule is anchored. */
function monthlyLedger(purchaseId: string) {
  const base = ledger(purchaseId);
  return {
    snapshot: {
      ...base.snapshot,
      purchase: { ...base.snapshot.purchase, plan: "monthly" },
      installments: [
        ...base.snapshot.installments,
        {
          id: `${purchaseId}-installment-2`,
          position: 2,
          amountCents: 5_000,
          currency: "USD",
          dueTrigger: "monthly_anniversary",
          dueAt: null,
          triggeredAt: null,
          remindersEnabled: false,
        },
      ],
    },
    projection: {
      installments: [
        ...base.projection.installments,
        { id: `${purchaseId}-installment-2`, remainingCents: 5_000, status: "not_paid" },
      ],
    },
  };
}

function materializedRow(index: number, purchaseId: string) {
  return {
    rowId: `row-${String(index)}`,
    clientContactId: "client-1",
    projectId: `project-${String(index)}`,
    purchaseId,
    projectTitle: `Project ${String(index)}`,
    commercialSnapshot: { productOrOfferName: `Agreement ${String(index)}` },
    refNumber: `REF-${String(index)}`,
  };
}

const CLIENT = {
  id: "client-1",
  name: "Artist",
  email: "artist@example.com",
  emailHash: emailHashFor("artist@example.com"),
  clerkUserId: null,
  archivedAt: null,
};

describe("active work import setup scope loading", () => {
  beforeEach(() => {
    mocks.reconcile.mockReset();
    mocks.read.mockReset();
  });

  // Loading the review options backs a tRPC query, which React Query may
  // refetch at any time (window focus included). It must never write.
  it("reads imported purchase ledgers in small groups without reconciling them", async () => {
    const purchaseIds = Array.from({ length: 12 }, (_, index) => `purchase-${String(index)}`);
    const materializedRows = purchaseIds.map((purchaseId, index) =>
      materializedRow(index, purchaseId),
    );
    let inFlight = 0;
    let peakInFlight = 0;
    mocks.read.mockImplementation(async (_repository, input) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return ledger((input as { purchaseId: string }).purchaseId);
    });

    const scope = await loadActiveWorkImportSetupScope(
      fakeDb([[{ id: BATCH_ID }], materializedRows, [CLIENT]]),
      { producerId: PRODUCER_ID, batchId: BATCH_ID },
    );

    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(12);
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

  // Monthly instalments 2..N carry no date until the schedule is anchored, and
  // the reminder engine skips every date-less instalment. Offering to arm one
  // promises the producer something that can never fire.
  it("does not call a payment with no due date reminder-eligible", async () => {
    mocks.read.mockImplementation((_repository, input) =>
      Promise.resolve(monthlyLedger((input as { purchaseId: string }).purchaseId)),
    );

    const scope = await loadActiveWorkImportSetupScope(
      fakeDb([[{ id: BATCH_ID }], [materializedRow(0, "purchase-0")], [CLIENT]]),
      { producerId: PRODUCER_ID, batchId: BATCH_ID },
    );

    const dated = scope.installments.find((installment) => installment.position === 1);
    const undated = scope.installments.find((installment) => installment.position === 2);

    expect(dated).toMatchObject({
      dueAt: new Date("2026-08-20T12:00:00.000Z"),
      reminderEligible: true,
      reminderWaitingForDueDate: false,
    });
    expect(undated).toMatchObject({
      dueAt: null,
      reminderEligible: false,
      reminderWaitingForDueDate: true,
    });
  });

  // The sibling wizard change gives many imported instalments a real first
  // payment date. The rule must flip on its own once that date exists.
  it("becomes reminder-eligible on its own once a due date exists", async () => {
    const dueAt = new Date("2026-09-20T12:00:00.000Z");
    mocks.read.mockImplementation((_repository, input) => {
      const base = monthlyLedger((input as { purchaseId: string }).purchaseId);
      return Promise.resolve({
        ...base,
        snapshot: {
          ...base.snapshot,
          installments: base.snapshot.installments.map((installment) =>
            installment.position === 2 ? { ...installment, dueAt } : installment,
          ),
        },
      });
    });

    const scope = await loadActiveWorkImportSetupScope(
      fakeDb([[{ id: BATCH_ID }], [materializedRow(0, "purchase-0")], [CLIENT]]),
      { producerId: PRODUCER_ID, batchId: BATCH_ID },
    );

    expect(scope.installments.find((installment) => installment.position === 2)).toMatchObject({
      dueAt,
      reminderEligible: true,
      reminderWaitingForDueDate: false,
    });
  });

  // A canceled or settled payment needs no reminder at all. It must not be
  // dressed up as "waiting for a date".
  it("does not call a settled payment reminder-eligible or waiting for a date", async () => {
    mocks.read.mockImplementation((_repository, input) => {
      const base = monthlyLedger((input as { purchaseId: string }).purchaseId);
      return Promise.resolve({
        ...base,
        projection: {
          installments: base.projection.installments.map((installment) =>
            installment.id.endsWith("installment-2")
              ? { ...installment, remainingCents: 0, status: "confirmed" }
              : installment,
          ),
        },
      });
    });

    const scope = await loadActiveWorkImportSetupScope(
      fakeDb([[{ id: BATCH_ID }], [materializedRow(0, "purchase-0")], [CLIENT]]),
      { producerId: PRODUCER_ID, batchId: BATCH_ID },
    );

    expect(scope.installments.find((installment) => installment.position === 2)).toMatchObject({
      reminderEligible: false,
      reminderWaitingForDueDate: false,
    });
  });
});
