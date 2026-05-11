import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for booking.packages.restore — the Undo counterpart to
// booking.packages.archive. Restore clears archivedAt AND forces
// active=false so the resurrected product reappears in the dashboard
// list (which filters on archivedAt IS NULL) but stays hidden from
// the storefront until the producer re-publishes it explicitly.

const PRODUCER_ID = "producer-uuid-1";
const OTHER_PRODUCER_ID = "producer-uuid-2";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000c01";

const producersMarker = { __table: "producers" };
const productsMarker = { __table: "products" };

type Row = Record<string, unknown>;

// Two independent select queues so the producer-procedure lookup and
// the router's own by-id select don't stomp on each other.
const producerSelectQueue: Row[][] = [];
const productSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

// Spy on the update().set() chain so we can assert the EXACT patch
// the restore mutation applies (must clear archivedAt + force
// active=false in a single write).
const updateWhereSpy = vi.fn<() => Promise<unknown>>(() => Promise.resolve());
const updateSetSpy = vi.fn(() => ({ where: updateWhereSpy }));

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const handler = () => {
        if (table === producersMarker) return shift(producerSelectQueue);
        if (table === productsMarker) return shift(productSelectQueue);
        return [];
      };
      return {
        where: () => ({
          limit: () => Promise.resolve(handler()),
          orderBy: () => Promise.resolve(handler()),
        }),
      };
    },
  }),
  update: () => ({ set: updateSetSpy }),
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
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_1" });
};

describe("booking.packages.restore", () => {
  it("restores an archived product, clearing archivedAt and forcing active=false", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    const result = await caller.booking.packages.restore({ id: PRODUCT_ID });
    expect(result).toEqual({ ok: true });
    expect(updateSetSpy).toHaveBeenCalledOnce();
    expect(updateSetSpy).toHaveBeenCalledWith({
      archivedAt: null,
      active: false,
    });
    expect(updateWhereSpy).toHaveBeenCalledOnce();
  });

  it("throws NOT_FOUND when the product belongs to a different producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: OTHER_PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.restore({ id: PRODUCT_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the product id is unknown", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.restore({ id: PRODUCT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("is a no-op-safe on a not-yet-archived product (idempotent)", async () => {
    // archivedAt is already null. Restore should still succeed and
    // issue the same set() call — clearing a null is a no-op, but
    // forcing active=false matters for products the producer
    // toggled between hide/show. Idempotent === safe to retry on
    // accidental double-click of the toast Undo button.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID, archivedAt: null }]);
    const caller = await buildCaller();
    const result = await caller.booking.packages.restore({ id: PRODUCT_ID });
    expect(result).toEqual({ ok: true });
    expect(updateSetSpy).toHaveBeenCalledOnce();
    expect(updateSetSpy).toHaveBeenCalledWith({
      archivedAt: null,
      active: false,
    });
  });

  it("is identical on booking.products.restore (same underlying router)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    const result = await caller.booking.products.restore({ id: PRODUCT_ID });
    expect(result).toEqual({ ok: true });
    expect(updateSetSpy).toHaveBeenCalledOnce();
  });
});
