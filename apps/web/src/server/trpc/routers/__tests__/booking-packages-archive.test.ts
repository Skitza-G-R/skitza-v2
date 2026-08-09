import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  agreementPdfContractDocumentsForCleanup,
  appendAgreementPdfRevision,
  markAgreementPdfContractForCleanup,
  type AgreementPdfDocument,
} from "~/server/domain/agreement-pdfs/contract";

const PRODUCER_ID = "producer-uuid-archive";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000d01";
const FOREIGN_PRODUCT_ID = "00000000-0000-0000-0000-000000000d02";
const MISSING_PRODUCT_ID = "00000000-0000-0000-0000-000000000d03";

const agreementDocument: AgreementPdfDocument = {
  storageBucket: "docs",
  storageKey: `agreement-pdfs/${"c".repeat(64)}`,
  originalFileName: "terms.pdf",
  contentType: "application/pdf",
  sizeBytes: 100,
  objectEtag: '"etag"',
  sha256: "d".repeat(64),
};

const agreementContract = appendAgreementPdfRevision(null, {
  revisionId: "00000000-0000-4000-8000-000000000002",
  effectiveAt: "2026-08-09T00:00:00.000Z",
  document: agreementDocument,
});
const cleanupAgreementContract = markAgreementPdfContractForCleanup(agreementContract);

const agreementPdfMocks = vi.hoisted(() => ({
  deleteFinal: vi.fn<(document: AgreementPdfDocument) => Promise<void>>(),
}));

function agreementContractWithUniqueDocuments(count: number): {
  contractUrl: string;
  documents: AgreementPdfDocument[];
} {
  let contractUrl: string | null = null;
  const documents: AgreementPdfDocument[] = [];
  for (let index = 1; index <= count; index += 1) {
    const hex = index.toString(16);
    const document: AgreementPdfDocument = {
      ...agreementDocument,
      storageKey: `agreement-pdfs/${hex.padStart(64, "0")}`,
      objectEtag: `"etag-${hex}"`,
      sha256: hex.padStart(64, "0"),
    };
    documents.push(document);
    contractUrl = appendAgreementPdfRevision(contractUrl, {
      revisionId: `00000000-0000-4000-8000-${hex.padStart(12, "0")}`,
      effectiveAt: "2026-08-09T00:00:00.000Z",
      document,
    });
  }
  if (!contractUrl) throw new Error("Expected at least one agreement document");
  return { contractUrl, documents };
}

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
    contractUrl: column("products.contract_url"),
    active: column("products.active"),
    archivedAt: column("products.archived_at"),
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
      ): PromiseLike<TResult1 | TResult2> => Promise.resolve(rows).then(onfulfilled, onrejected),
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
    execute: () => Promise.resolve(),
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

vi.mock("~/server/domain/agreement-pdfs/storage", () => ({
  agreementPdfFinalCandidate: vi.fn(),
  createPrivateAgreementPdfUpload: vi.fn(),
  deletePrivateAgreementPdfFinalIfExact: agreementPdfMocks.deleteFinal,
  deletePrivateAgreementPdfStaging: vi.fn(),
  finalizePrivateAgreementPdfUpload: vi.fn(),
  resolvePrivateAgreementPdfFinalCandidate: vi.fn(),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  withNeonSessionAdvisoryLock: async (
    _connectionString: string,
    _lockKey: string,
    callback: (db: unknown) => Promise<unknown>,
  ) => callback(dbMock),
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
  agreementPdfMocks.deleteFinal.mockReset().mockResolvedValue();
  process.env.DATABASE_URL = "postgresql://test/test";
});

async function buildCaller() {
  const { bookingRouter } = await import("../booking");
  return bookingRouter.createCaller({ userId: "user_test_archive" });
}

async function trpcFailure(
  operation: Promise<unknown>,
): Promise<{ code: string; message: string }> {
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

  it("commits a terminal tombstone before deleting an unreferenced final agreement", async () => {
    productRows.push(
      [{ id: PRODUCT_ID, contractUrl: agreementContract }],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
    );
    const caller = await buildCaller();

    await expect(caller.packages.archive({ id: PRODUCT_ID })).resolves.toEqual({
      ok: true,
      outcome: "deleted",
    });

    expect(transactionSpy).toHaveBeenCalledTimes(2);
    expect(agreementPdfMocks.deleteFinal).toHaveBeenCalledWith(agreementDocument);
    expect(updateCalls[0]?.patch).toMatchObject({
      active: false,
      contractUrl: cleanupAgreementContract,
    });
    expect(updateCalls[0]?.patch.archivedAt).toBeInstanceOf(Date);
  });

  it("preserves a final agreement still referenced by a duplicated product", async () => {
    productRows.push(
      [{ id: PRODUCT_ID, contractUrl: agreementContract }],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        { id: PRODUCT_ID, contractUrl: cleanupAgreementContract },
        { id: "duplicate-product", contractUrl: agreementContract, archivedAt: new Date() },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
    );
    const caller = await buildCaller();

    await expect(caller.packages.archive({ id: PRODUCT_ID })).resolves.toEqual({
      ok: true,
      outcome: "deleted",
    });

    expect(agreementPdfMocks.deleteFinal).not.toHaveBeenCalled();
  });

  it("bounds max-ledger cleanup concurrency and settles every deletion attempt", async () => {
    const maximumLedger = agreementContractWithUniqueDocuments(512);
    const cleanupContract = markAgreementPdfContractForCleanup(maximumLedger.contractUrl);
    productRows.push(
      [{ id: PRODUCT_ID, contractUrl: maximumLedger.contractUrl }],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupContract,
        },
      ],
    );
    let active = 0;
    let maxActive = 0;
    agreementPdfMocks.deleteFinal.mockImplementation(async (document) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await Promise.resolve();
        if (document.storageKey === maximumLedger.documents[0]?.storageKey) {
          throw new Error("one R2 delete failed");
        }
      } finally {
        active -= 1;
      }
    });
    const caller = await buildCaller();

    await expect(caller.packages.archive({ id: PRODUCT_ID })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });

    expect(agreementPdfMocks.deleteFinal).toHaveBeenCalledTimes(512);
    expect(maxActive).toBe(16);
    expect(agreementPdfMocks.deleteFinal.mock.calls.at(-1)?.[0]).toEqual(
      maximumLedger.documents.at(-1),
    );
    expect(deleteCalls).toEqual([]);
    expect(updateCalls[0]?.patch.contractUrl).toBe(cleanupContract);
    expect(
      agreementPdfContractDocumentsForCleanup(updateCalls[0]?.patch.contractUrl as string),
    ).toHaveLength(512);
  });

  it("retries an already-tombstoned product after a partial cleanup failure", async () => {
    productRows.push(
      [{ id: PRODUCT_ID, contractUrl: agreementContract }],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
      [
        {
          id: PRODUCT_ID,
          active: false,
          archivedAt: new Date(),
          contractUrl: cleanupAgreementContract,
        },
      ],
    );
    agreementPdfMocks.deleteFinal.mockRejectedValueOnce(new Error("temporary R2 failure"));
    const caller = await buildCaller();

    await expect(caller.packages.archive({ id: PRODUCT_ID })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });

    expect(deleteCalls).toEqual([]);
    expect(updateCalls[0]?.patch.contractUrl).toBe(cleanupAgreementContract);
    expect(
      agreementPdfContractDocumentsForCleanup(updateCalls[0]?.patch.contractUrl as string),
    ).toEqual([agreementDocument]);

    await expect(caller.packages.archive({ id: PRODUCT_ID })).resolves.toEqual({
      ok: true,
      outcome: "deleted",
    });
    expect(agreementPdfMocks.deleteFinal).toHaveBeenCalledTimes(2);
    expect(deleteCalls).toEqual([{ table: productsMarker }]);
  });

  it("cannot restore, activate, or duplicate a terminal cleanup tombstone", async () => {
    productRows.push(
      [{ id: PRODUCT_ID, contractUrl: cleanupAgreementContract }],
      [{ id: PRODUCT_ID, contractUrl: cleanupAgreementContract }],
      [{ id: PRODUCT_ID, contractUrl: cleanupAgreementContract }],
    );
    const caller = await buildCaller();

    await expect(caller.products.restore({ id: PRODUCT_ID })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(caller.products.setActive({ id: PRODUCT_ID, active: true })).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    await expect(caller.products.duplicate({ id: PRODUCT_ID })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(deleteCalls).toEqual([]);
  });

  it("keeps a cleanup tombstone hidden if older code cleared archivedAt", async () => {
    productRows.push([
      {
        id: PRODUCT_ID,
        active: false,
        archivedAt: null,
        contractUrl: cleanupAgreementContract,
      },
    ]);
    const caller = await buildCaller();

    await expect(caller.products.list()).resolves.toEqual([]);
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
    const requestTransaction = purchaseRouter.slice(requestTransactionStart, requestTransactionEnd);
    expect(requestTransaction).toMatch(
      /\.from\(products\)[\s\S]*?\.for\("share"\)[\s\S]*?\.insert\(purchaseRequests\)/,
    );
  });
});
