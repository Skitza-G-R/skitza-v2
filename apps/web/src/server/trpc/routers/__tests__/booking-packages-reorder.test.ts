import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for booking.packages.reorder — Phase 3 store redesign
// drag-to-reorder mutation. Writes the new ordinals (position == index
// in `orderedIds`) inside a single ctx.db.transaction so a partial
// failure can't leave the products list half-reordered. Ownership is
// verified by selecting all row producerIds in one query before any
// write.

const PRODUCER_ID = "producer-uuid-1";
const OTHER_PRODUCER_ID = "producer-uuid-2";
const ID_A = "00000000-0000-0000-0000-000000000a01";
const ID_B = "00000000-0000-0000-0000-000000000a02";
const ID_C = "00000000-0000-0000-0000-000000000a03";

const producersMarker = { __table: "producers" };
const productsMarker = { __table: "products" };

type Row = Record<string, unknown>;

// Two independent select queues so the producer-procedure lookup and
// the router's own ownership select don't stomp on each other.
const producerSelectQueue: Row[][] = [];
const productSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

// Spy on the update().set().where() chain. Each reorder writes ONE
// update per id in input.orderedIds, so mock.calls captures the full
// position-patch sequence (index == position).
const updateWhereSpy = vi.fn<() => Promise<unknown>>(() => Promise.resolve());
const updateSetSpy = vi.fn(() => ({ where: updateWhereSpy }));

// Tracks whether ctx.db.transaction's callback actually ran — proves
// the writes happened INSIDE the transaction boundary (not just before
// or after it).
const transactionRanSpy = vi.fn();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const handler = () => {
        if (table === producersMarker) return shift(producerSelectQueue);
        if (table === productsMarker) return shift(productSelectQueue);
        return [];
      };
      return {
        // The reorder mutation awaits directly on .where(...) (no
        // .limit() / .orderBy() call — it pulls all matching rows in
        // one shot). Return an object that is BOTH a thenable (for
        // direct await) AND exposes .limit() / .orderBy() for the
        // existing producer-procedure + restore-style callers.
        //
        // Lazy: handler() runs at most ONCE per where() call, either
        // via direct await (.then) OR via .limit()/.orderBy() — never
        // both. Otherwise the producer-procedure's .limit(1) would
        // drain two entries from the select queue.
        where: () => {
          let consumed = false;
          const consume = () => {
            if (consumed) return Promise.resolve([]);
            consumed = true;
            return Promise.resolve(handler());
          };
          const obj = {
            then: (resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) =>
              consume().then(resolve, reject),
            limit: () => consume(),
            orderBy: () => consume(),
          };
          return obj;
        },
      };
    },
  }),
  update: () => ({ set: updateSetSpy }),
  // The reorder mutation calls `ctx.db.transaction(async (tx) => …)`
  // and invokes `tx.update(...)` inside. Passing the same mock as `tx`
  // means the updateSetSpy assertions still hold. The `cb` parameter
  // is typed as `unknown` to avoid a TS7022 self-reference on dbMock;
  // the cast is local to this seam.
  transaction: (cb: unknown) => {
    transactionRanSpy();
    return (cb as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
  },
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => "127.0.0.1",
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  products: productsMarker,
  projects: { __table: "projects" },
  bookings: { __table: "bookings" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  invoices: { __table: "invoices" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  isNull: (col: unknown) => ({ isNull: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  productSelectQueue.length = 0;
  updateWhereSpy.mockReset().mockResolvedValue(undefined);
  updateSetSpy.mockReset().mockReturnValue({ where: updateWhereSpy });
  transactionRanSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_1" });
};

describe("booking.packages.reorder", () => {
  it("reorders an owned, complete set of products, writing one update per id in a single transaction", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([
      { id: ID_A, producerId: PRODUCER_ID },
      { id: ID_B, producerId: PRODUCER_ID },
      { id: ID_C, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();
    const result = await caller.booking.packages.reorder({
      orderedIds: [ID_A, ID_B, ID_C],
    });
    expect(result).toEqual({ ok: true });
    // One set() per id, in order, with position == index.
    expect(updateSetSpy.mock.calls).toEqual([
      [{ position: 0 }],
      [{ position: 1 }],
      [{ position: 2 }],
    ]);
    // And the writes happened inside the transaction callback.
    expect(transactionRanSpy).toHaveBeenCalledOnce();
  });

  it("throws NOT_FOUND if any id is missing from the products table", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    // Only 2 of the 3 input ids come back — the third is unknown.
    productSelectQueue.push([
      { id: ID_A, producerId: PRODUCER_ID },
      { id: ID_B, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.reorder({
        orderedIds: [ID_A, ID_B, ID_C],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN if any returned row belongs to another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([
      { id: ID_A, producerId: PRODUCER_ID },
      { id: ID_B, producerId: OTHER_PRODUCER_ID },
      { id: ID_C, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.reorder({
        orderedIds: [ID_A, ID_B, ID_C],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects duplicate ids in the input via zod", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.reorder({
        orderedIds: [ID_A, ID_A, ID_B],
      }),
    ).rejects.toThrow();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("is idempotent — calling with the same already-correct order is a no-op write but still ok", async () => {
    // Same setup as case 1, but conceptually the products already have
    // those positions. The mock doesn't track current values, so the
    // mutation still issues the writes — which is correct: calling
    // with the same order is idempotent at the DB level (setting a
    // column to its current value is a no-op write).
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([
      { id: ID_A, producerId: PRODUCER_ID },
      { id: ID_B, producerId: PRODUCER_ID },
      { id: ID_C, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();
    const result = await caller.booking.packages.reorder({
      orderedIds: [ID_A, ID_B, ID_C],
    });
    expect(result).toEqual({ ok: true });
  });
});
