import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "producer-uuid-archive";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000d01";
const FOREIGN_PRODUCT_ID = "00000000-0000-0000-0000-000000000d02";
const MISSING_PRODUCT_ID = "00000000-0000-0000-0000-000000000d03";

type Row = Record<string, unknown>;

const {
  producersMarker,
  productsMarker,
  purchaseRequestsMarker,
  purchasesMarker,
  privateOffersMarker,
  productRows,
  requestRows,
  purchaseRows,
  offerRows,
  selectEvents,
  updateCalls,
  deleteCalls,
  transactionSpy,
  dbMock,
} = vi.hoisted(() => {
  const column = (name: string) => ({ __column: name });
  const producersMarker = {
    __table: "producers",
    id: column("producers.id"),
    clerkUserId: column("producers.clerk_user_id"),
  };
  const productsMarker = {
    __table: "products",
    id: column("products.id"),
    producerId: column("products.producer_id"),
  };
  const purchaseRequestsMarker = {
    __table: "purchase_requests",
    id: column("purchase_requests.id"),
    productId: column("purchase_requests.product_id"),
    producerId: column("purchase_requests.producer_id"),
  };
  const purchasesMarker = {
    __table: "purchases",
    id: column("purchases.id"),
    productId: column("purchases.product_id"),
    producerId: column("purchases.producer_id"),
  };
  const privateOffersMarker = {
    __table: "private_offers",
    id: column("private_offers.id"),
    productId: column("private_offers.product_id"),
    producerId: column("private_offers.producer_id"),
  };

  const productRows: Row[][] = [];
  const requestRows: Row[][] = [];
  const purchaseRows: Row[][] = [];
  const offerRows: Row[][] = [];
  const selectEvents: string[] = [];
  const updateCalls: Array<{ table: unknown; patch: Row }> = [];
  const deleteCalls: Array<{ table: unknown }> = [];

  function tableName(table: unknown): string {
    if (table === producersMarker) return "producers";
    if (table === productsMarker) return "products";
    if (table === purchaseRequestsMarker) return "purchase_requests";
    if (table === purchasesMarker) return "purchases";
    if (table === privateOffersMarker) return "private_offers";
    return "other";
  }

  function rowsFor(table: unknown): Row[] {
    if (table === producersMarker) return [{ id: PRODUCER_ID }];
    if (table === productsMarker) return productRows.shift() ?? [];
    if (table === purchaseRequestsMarker) return requestRows.shift() ?? [];
    if (table === purchasesMarker) return purchaseRows.shift() ?? [];
    if (table === privateOffersMarker) return offerRows.shift() ?? [];
    return [];
  }

  function selectFrom(table: unknown) {
    const name = tableName(table);
    const rows = rowsFor(table);
    selectEvents.push(`select:${name}`);
    const query = {
      where: () => query,
      limit: () => query,
      orderBy: () => query,
      for: (mode: string) => {
        selectEvents.push(`lock:${name}:${mode}`);
        return query;
      },
      then: <TResult1 = Row[], TResult2 = never>(
        onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> =>
        Promise.resolve(rows).then(onfulfilled, onrejected),
    };
    return query;
  }

  const transactionSpy = vi.fn();
  const dbMock: Record<string, unknown> = {
    select: () => ({ from: selectFrom }),
    update: (table: unknown) => ({
      set: (patch: Row) => {
        updateCalls.push({ table, patch });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    delete: (table: unknown) => {
      deleteCalls.push({ table });
      return {
        where: () => ({
          returning: () => Promise.resolve([{ id: PRODUCT_ID }]),
        }),
      };
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionSpy();
      return callback(dbMock);
    },
  };

  return {
    producersMarker,
    productsMarker,
    purchaseRequestsMarker,
    purchasesMarker,
    privateOffersMarker,
    productRows,
    requestRows,
    purchaseRows,
    offerRows,
    selectEvents,
    updateCalls,
    deleteCalls,
    transactionSpy,
    dbMock,
  };
});

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  products: productsMarker,
  purchaseRequests: purchaseRequestsMarker,
  purchases: purchasesMarker,
  privateOffers: privateOffersMarker,
  projects: { __table: "projects" },
  bookings: { __table: "bookings" },
  purchaseSessionAllowances: { __table: "purchase_session_allowances" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  asc: (column: unknown) => ({ asc: column }),
  desc: (column: unknown) => ({ desc: column }),
  isNull: (column: unknown) => ({ isNull: column }),
  gte: (column: unknown, value: unknown) => ({ gte: [column, value] }),
  lte: (column: unknown, value: unknown) => ({ lte: [column, value] }),
  inArray: (column: unknown, values: unknown[]) => ({ inArray: [column, values] }),
  sql: () => ({ sql: true }),
}));

beforeEach(() => {
  productRows.length = 0;
  requestRows.length = 0;
  purchaseRows.length = 0;
  offerRows.length = 0;
  selectEvents.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  transactionSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

async function buildCaller() {
  const { bookingRouter } = await import("../booking");
  return bookingRouter.createCaller({ userId: "user_test_archive" });
}

async function trpcFailure(operation: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await operation;
  } catch (error) {
    const failure = error as { code?: unknown; message?: unknown };
    return {
      code: typeof failure.code === "string" ? failure.code : "",
      message: typeof failure.message === "string" ? failure.message : "",
    };
  }
  throw new Error("Expected the archive mutation to fail");
}

describe("booking products authoritative removal", () => {
  it("hard-deletes an owned product with no commercial history", async () => {
    productRows.push([{ id: PRODUCT_ID }]);
    const caller = await buildCaller();

    await expect(caller.packages.archive({ id: PRODUCT_ID })).resolves.toEqual({
      ok: true,
      outcome: "deleted",
    });

    expect(updateCalls).toEqual([]);
    expect(deleteCalls).toEqual([{ table: productsMarker }]);
    expect(transactionSpy).toHaveBeenCalledOnce();
  });

  it.each([
    ["purchase request", requestRows],
    ["accepted purchase", purchaseRows],
    ["private offer", offerRows],
  ])("archives instead of deleting when %s history exists", async (_label, historyRows) => {
    productRows.push([{ id: PRODUCT_ID }]);
    historyRows.push([{ id: "history-row" }]);
    const caller = await buildCaller();

    await expect(caller.products.archive({ id: PRODUCT_ID })).resolves.toEqual({
      ok: true,
      outcome: "archived",
    });

    expect(deleteCalls).toEqual([]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.table).toBe(productsMarker);
    expect(updateCalls[0]?.patch.active).toBe(false);
    expect(updateCalls[0]?.patch.archivedAt).toBeInstanceOf(Date);
  });

  it("uses the same generic NOT_FOUND response for foreign and missing product ids", async () => {
    productRows.push([], []);
    const caller = await buildCaller();

    const foreign = await trpcFailure(caller.packages.archive({ id: FOREIGN_PRODUCT_ID }));
    const missing = await trpcFailure(caller.packages.archive({ id: MISSING_PRODUCT_ID }));

    expect(foreign).toEqual(missing);
    expect(foreign.code).toBe("NOT_FOUND");
    expect(updateCalls).toEqual([]);
    expect(deleteCalls).toEqual([]);
    expect(selectEvents.filter((event) => event.includes("purchase_"))).toEqual([]);
  });

  it("locks the product before deciding from history and matches request creation's share lock", async () => {
    productRows.push([{ id: PRODUCT_ID }]);
    const caller = await buildCaller();
    await caller.products.archive({ id: PRODUCT_ID });

    expect(selectEvents).toEqual([
      "select:producers",
      "select:products",
      "lock:products:update",
      "select:purchase_requests",
      "select:purchases",
      "select:private_offers",
    ]);

    const purchaseRouter = readFileSync(
      join(process.cwd(), "src/server/trpc/routers/purchase.ts"),
      "utf8",
    );
    const requestTransactionStart = purchaseRouter.indexOf(
      "const result = await ctx.db.transaction(async (tx) =>",
    );
    const requestTransactionEnd = purchaseRouter.indexOf(
      "if (result.created)",
      requestTransactionStart,
    );
    const requestTransaction = purchaseRouter.slice(
      requestTransactionStart,
      requestTransactionEnd,
    );
    expect(requestTransaction).toMatch(
      /\.from\(products\)[\s\S]*?\.for\("share"\)[\s\S]*?\.insert\(purchaseRequests\)/,
    );
  });
});
