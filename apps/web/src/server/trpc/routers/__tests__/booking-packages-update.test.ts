import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for booking.packages.update — the mutation the Task 14 Edit
// button dispatches. Verifies the mutation exists on the legacy
// `.packages.*` alias (still used by the dashboard action), accepts
// the full edit-mode input shape the form emits, and enforces the
// same cross-producer FORBIDDEN guard as archive/deactivate.

const PRODUCER_ID = "producer-uuid-1";
const OTHER_PRODUCER_ID = "producer-uuid-2";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000b01";

const producersMarker = { __table: "producers" };
const productsMarker = { __table: "products" };

type Row = Record<string, unknown>;

// Two independent select queues so the producer-procedure lookup and
// the router's own by-id select don't stomp on each other. Calls
// against producers → first queue; calls against products → second.
const producerSelectQueue: Row[][] = [];
const productSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

const updateReturningSpy = vi.fn<() => Promise<Row[]>>(() =>
  Promise.resolve([{ id: PRODUCT_ID, name: "Renamed" }]),
);
const updateSetSpy = vi.fn(() => ({
  where: () => ({ returning: updateReturningSpy }),
}));

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const handler = () => {
        if (table === producersMarker) return shift(producerSelectQueue);
        if (table === productsMarker) return shift(productSelectQueue);
        return [];
      };
      // producer-procedure uses .where().limit(1); the router's
      // ownership check does .where().limit(1) too.
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
  // Tables referenced elsewhere in booking.ts module scope — included
  // so the import resolves cleanly. None are used by the update path.
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
  updateReturningSpy
    .mockReset()
    .mockResolvedValue([{ id: PRODUCT_ID, name: "Renamed" }]);
  updateSetSpy.mockReset().mockReturnValue({
    where: () => ({ returning: updateReturningSpy }),
  });
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_1" });
};

// Full edit-mode payload matching what NewPackageForm emits when
// initialValues is supplied. Kept near the tests so any future
// input-shape change breaks these assertions first.
function fullEditInput() {
  return {
    id: PRODUCT_ID,
    name: "Renamed mix",
    description: "A better description",
    durationMin: 90,
    sessionCount: 2,
    priceCents: 25000,
    currency: "USD" as const,
    depositPct: 50,
    kind: "mixing" as const,
    locationType: "remote" as const,
    bufferMinutes: 15,
    minLeadHours: 24,
    paymentPlans: [
      { kind: "full" as const },
      { kind: "split_50_50" as const },
    ],
  };
}

describe("booking.packages.update", () => {
  it("exists on the legacy packages.* alias and accepts the full edit payload", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    const row = await caller.booking.packages.update(fullEditInput());
    expect(row).toEqual({ id: PRODUCT_ID, name: "Renamed" });
    expect(updateReturningSpy).toHaveBeenCalledOnce();
  });

  it("is identical to booking.products.update (same underlying router)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.booking.products.update(fullEditInput());
    expect(updateReturningSpy).toHaveBeenCalledOnce();
  });

  it("throws FORBIDDEN when the product belongs to a different producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: OTHER_PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.update(fullEditInput()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the product id is unknown", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.update(fullEditInput()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });

  it("accepts a minimal patch (just name) for partial edits", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    const row = await caller.booking.packages.update({
      id: PRODUCT_ID,
      name: "Only name changed",
    });
    expect(row).toEqual({ id: PRODUCT_ID, name: "Renamed" });
  });
});
